const WebSocket = require('ws');
const assert = require('node:assert/strict');

const URL = process.env.TEST_WS || 'ws://127.0.0.1:8890';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const messages = [];
    const waiters = [];
    const client = {
      ws, messages,
      send(value) { ws.send(JSON.stringify(value)); },
      waitFor(predicate, timeout = 6000, label = 'mensagem') {
        const found = messages.find(predicate);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const i = waiters.findIndex(w => w.res === res);
            if (i >= 0) waiters.splice(i, 1);
            rej(new Error('timeout esperando ' + label));
          }, timeout);
          waiters.push({ predicate, res: value => { clearTimeout(timer); res(value); }, rej });
        });
      }
    };
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          const waiter = waiters.splice(i, 1)[0];
          waiter.res(msg);
        }
      }
    });
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

async function fechar(c) {
  if (!c || c.ws.readyState > 1) return;
  c.ws.close();
  await sleep(80);
}

(async () => {
  const usuario = `conta_${Date.now().toString(36)}`.slice(0, 24);
  const senha = 'SenhaTeste9!';
  const nome = 'Jogador Conta';

  const primeiro = await connect();
  primeiro.send({ t:'hello', nome:'anônimo temporário' });
  const required = await primeiro.waitFor(m => m.t === 'login_required', 5000, 'login obrigatório');
  assert.match(required.motivo, /conta|sessão/i);
  primeiro.send({ t:'auth_register', usuario, senha, nome, avatarId:'verde', aparelhoId:'teste-conta' });
  const criado = await primeiro.waitFor(m => m.t === 'auth_ok' && m.novo === true, 6000, 'cadastro');
  const sessao1 = await primeiro.waitFor(m => m.t === 'sessao' && m.token, 6000, 'token da conta');
  const lote1 = await primeiro.waitFor(m => m.t === 'lote_atribuido', 6000, 'lote da conta');
  const estado1 = await primeiro.waitFor(m => m.t === 'estado', 6000, 'carteira inicial');
  assert.equal(criado.usuario, usuario);
  assert.equal(criado.nome, nome);
  assert.equal(lote1.loteIndex, 0);
  assert.equal(estado1.cash, 350);
  assert.ok(estado1.bank.some(e => e.s && e.qtd >= 2), 'conta nova deve receber sementes iniciais uma única vez');
  await fechar(primeiro);

  const segundo = await connect();
  segundo.send({ t:'hello', token:sessao1.token, nome:'nome ignorado', avatarId:'roxo' });
  const sessao2 = await segundo.waitFor(m => m.t === 'sessao' && m.token, 6000, 'relogin por token');
  const lote2 = await segundo.waitFor(m => m.t === 'lote_atribuido', 6000, 'mesmo lote');
  const estado2 = await segundo.waitFor(m => m.t === 'estado', 6000, 'mesma carteira');
  assert.equal(lote2.loteIndex, lote1.loteIndex, 'a conta deve recuperar o mesmo lote');
  assert.equal(estado2.cash, estado1.cash, 'a conta deve recuperar o mesmo saldo');
  assert.deepEqual(estado2.bank, estado1.bank, 'a conta deve recuperar o mesmo inventário de sementes');
  await fechar(segundo);

  const errado = await connect();
  errado.send({ t:'hello' });
  await errado.waitFor(m => m.t === 'login_required', 5000, 'login para senha errada');
  errado.send({ t:'auth_login', usuario, senha:'senha-errada' });
  const erroSenha = await errado.waitFor(m => m.t === 'auth_error', 6000, 'senha errada');
  assert.match(erroSenha.motivo, /inválidos|senha/i);
  await fechar(errado);

  const ativo = await connect();
  ativo.send({ t:'hello', token:sessao2.token });
  await ativo.waitFor(m => m.t === 'estado', 6000, 'sessão ativa');
  const duplicado = await connect();
  duplicado.send({ t:'hello' });
  await duplicado.waitFor(m => m.t === 'login_required', 5000, 'login duplicado');
  duplicado.send({ t:'auth_login', usuario, senha });
  const erroDuplicado = await duplicado.waitFor(m => m.t === 'auth_error', 6000, 'conta duplicada');
  assert.match(erroDuplicado.motivo, /conectada/i);
  await fechar(duplicado);
  await fechar(ativo);

  console.log('LOGIN_CONTA_OK', JSON.stringify({ usuario, loteIndex:lote1.loteIndex, tokenRenovado:sessao2.token !== sessao1.token }));
})().catch(err => {
  console.error('LOGIN_CONTA_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
