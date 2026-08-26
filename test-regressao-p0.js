const WebSocket = require('ws');
const assert = require('node:assert/strict');

const URL = process.env.TEST_WS || 'ws://127.0.0.1:8830';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function connect(token = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const messages = [];
    const waiters = [];
    const client = {
      ws,
      messages,
      send(msg) { ws.send(JSON.stringify(msg)); },
      waitFor(predicate, timeout = 3000, label = 'mensagem') {
        const found = messages.find(predicate);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const i = waiters.findIndex(x => x.res === res);
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
    ws.once('open', () => {
      client.send({ t:'hello', token, nome:'Regressão P0' });
      resolve(client);
    });
    ws.once('error', reject);
  });
}

(async () => {
  const a = await connect();
  const sessao = await a.waitFor(m => m.t === 'sessao', 3000, 'sessão');
  const lote = await a.waitFor(m => m.t === 'lote_atribuido' && m.posicao, 3000, 'lote');
  const estadoInicial = await a.waitFor(m => m.t === 'estado', 3000, 'estado inicial');

  for (const k of ['toString', '__proto__', 'constructor']) {
    a.send({ t:'comprar', oq:'adubo', k });
    const recusado = await a.waitFor(m => m.t === 'recusado', 1500, 'catálogo seguro ' + k);
    assert.match(recusado.motivo, /inválido|catálogo|não disponível|não existe/i);
  }
  await sleep(120);
  const ultimoEstadoCatalogo = a.messages.filter(m => m.t === 'estado').at(-1) || estadoInicial;
  assert.equal(ultimoEstadoCatalogo.cash, estadoInicial.cash, 'catálogo inválido não pode alterar o caixa');
  assert.deepEqual(ultimoEstadoCatalogo.fert, estadoInicial.fert, 'catálogo inválido não pode alterar fertilizante');

  a.send({ t:'comprar', oq:'semente', strain:{
    id:987654, nome:'Genética Inventada', cor:0x123456, gen:0, auto:false, rar:'comum',
    t:{ritmo:100,rendimento:100,resistencia:100,aroma:100,brilho:100}
  }});
  const sementeRecusada = await a.waitFor(m => m.t === 'recusado', 1500, 'genética não catalogada');
  assert.match(sementeRecusada.motivo, /semente|catálogo|genética/i);

  a.send({ t:'input', seq:1, x:lote.posicao.x, y:3.5, z:lote.posicao.z, ry:0, arma:0 });
  const correcaoY = await a.waitFor(m => m.t === 'correcao' && m.seq === 1, 1500, 'correção de altura');
  assert.ok(Math.abs(Number(correcaoY.y) || 0) < 0.1, 'correção deve devolver o jogador ao chão');

  a.ws.close();
  await sleep(150);
  const b = await connect(sessao.token);
  const retomada = await b.waitFor(m => m.t === 'lote_atribuido' && m.posicao, 3000, 'retomada');
  assert.ok(Math.abs(Number(retomada.posicao.y) || 0) < 0.1, 'reconexão não pode manter altura de voo');
  b.ws.close();
  console.log('REGRESSAO_P0_OK');
})().catch(err => {
  console.error('REGRESSAO_P0_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
