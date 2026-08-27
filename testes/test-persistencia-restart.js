const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const Database = require('better-sqlite3');

const PORT = Number(process.env.TEST_PERSIST_PORT || 8810);
const DB_PATH = path.join(os.tmpdir(), `quintal-persist-${process.pid}.db`);
const AUTH_SECRET = 'persistencia-regression-secret';
const SERVER = path.join(__dirname, '..', 'servidor-1.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BASE = {
  id: 1, nome: 'Northern Lights', cor: 0x5f9c46, gen: 0, auto: false, rar: 'comum',
  t: { ritmo: 66, rendimento: 58, resistencia: 88, aroma: 52, brilho: 48 }
};

function healthOk() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT}/healthz`, res => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}
async function waitHealth() {
  for (let i = 0; i < 80; i++) {
    if (await healthOk()) return;
    await sleep(50);
  }
  throw new Error('servidor de persistência não subiu');
}
function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), DB_PATH, AUTH_SECRET, ALLOW_ANONYMOUS: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  child._logs = () => logs;
  return child;
}
function stopServer(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const messages = [];
    const timer = setTimeout(() => {
      ws.close(); reject(new Error('timeout abrindo WebSocket de persistência'));
    }, 6000);
    ws.once('open', () => { clearTimeout(timer); resolve({ ws, messages }); });
    ws.once('error', err => { clearTimeout(timer); reject(err); });
    ws.on('message', raw => {
      try { messages.push(JSON.parse(String(raw))); } catch (_) {}
    });
  });
}
function waitFor(client, predicate, label, timeout = 6000) {
  const found = client.messages.find(predicate);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.ws.off('message', onMessage);
      reject(new Error(`timeout aguardando ${label}`));
    }, timeout);
    const onMessage = raw => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch (_) { return; }
      client.messages.push(msg);
      if (predicate(msg)) {
        clearTimeout(timer);
        client.ws.off('message', onMessage);
        resolve(msg);
      }
    };
    client.ws.on('message', onMessage);
  });
}
function fechar(client) {
  if (!client || !client.ws || client.ws.readyState >= WebSocket.CLOSED) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 1000);
    client.ws.once('close', () => { clearTimeout(timer); resolve(); });
    client.ws.close();
  });
}
function totalSeeds(state) {
  return (state.bank || []).reduce((n, e) => n + Number(e.qtd || 0), 0);
}

(async () => {
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + suffix, { force: true });
  const usuario = `conta_${Date.now().toString(36)}`.slice(0, 24);
  const senha = 'SenhaPersist9!';
  let server = startServer();
  let first = null;
  let second = null;
  try {
    await waitHealth();

    first = await connect();
    first.ws.send(JSON.stringify({ t: 'hello', nome: 'antes do cadastro', avatarId: 'verde', sementeBase: BASE }));
    await waitFor(first, m => m.t === 'login_required', 'login obrigatório inicial');
    first.ws.send(JSON.stringify({ t: 'auth_register', usuario, senha, nome: 'Conta Persistente', avatarId: 'verde', aparelhoId: 'teste-restart', sementeBase: BASE }));
    const criado = await waitFor(first, m => m.t === 'auth_ok' && m.novo === true, 'cadastro da conta');
    const sessao = await waitFor(first, m => m.t === 'sessao' && m.token, 'token inicial');
    const lote = await waitFor(first, m => m.t === 'lote_atribuido' && m.posicao, 'lote inicial');
    const estadoInicial = await waitFor(first, m => m.t === 'estado' && Number.isFinite(m.cash), 'carteira inicial');
    assert.equal(criado.usuario, usuario);
    assert.equal(estadoInicial.cash, 350, 'carteira inicial deve ter R$350');
    assert.ok((estadoInicial.bank || []).some(e => e.s && e.qtd >= 2), 'conta nova deve receber sementes iniciais');

    // A conta nova começa no nível 1 e deve ser bloqueada para sementes de
    // nível 10. A promoção abaixo acontece apenas no SQLite descartável da
    // fixture; o servidor continua sendo a autoridade da compra.
    await fechar(first);
    first = null;
    await sleep(150);
    await stopServer(server);
    const dbNivel = new Database(DB_PATH);
    dbNivel.prepare('UPDATE usuarios SET nivel=10 WHERE chave=?').run(sessao.persistId);
    dbNivel.close();
    server = startServer();
    await waitHealth();
    first = await connect();
    first.ws.send(JSON.stringify({ t: 'hello', nome: 'relogin nível 10', avatarId: 'verde', aparelhoId: 'teste-restart-nivel-10' }));
    await waitFor(first, m => m.t === 'login_required', 'login de nível 10');
    first.ws.send(JSON.stringify({ t: 'auth_login', usuario, senha, avatarId: 'verde', aparelhoId: 'teste-restart-nivel-10' }));
    await waitFor(first, m => m.t === 'auth_ok' && m.novo === false, 'conta promovida');
    const loteNivel10 = await waitFor(first, m => m.t === 'lote_atribuido' && m.posicao, 'lote após promoção');
    const estadoNivel10 = await waitFor(first, m => m.t === 'estado' && Number.isFinite(m.cash), 'estado após promoção');
    assert.equal(estadoNivel10.nivel, 10, 'a fixture deve relogar a conta explicitamente no nível 10');
    assert.equal(loteNivel10.loteIndex, lote.loteIndex, 'a promoção local não deve trocar o lote');

    first.ws.send(JSON.stringify({ t: 'comprar', oq: 'semente', strain: BASE }));
    const comprado = await waitFor(first, m => m.t === 'estado' && m.cash === 292 && totalSeeds(m) >= 3, 'compra antes do restart');
    assert.equal(comprado.cash, 292, 'compra deve reduzir o saldo para R$292');
    const destino = { x: lote.posicao.x, y: 0, z: lote.posicao.z + 2.7, ry: 0 };
    first.ws.send(JSON.stringify({ t: 'input', seq: 1, ...destino, arma: 0 }));
    await sleep(250);
    await fechar(first);
    first = null;
    await sleep(120);
    await stopServer(server);
    server = startServer();
    await waitHealth();

    // Depois do restart, a senha deve recuperar a mesma conta sem depender de token em memória.
    second = await connect();
    second.ws.send(JSON.stringify({ t: 'hello', nome: 'nome ignorado', avatarId: 'roxo', sementeBase: BASE }));
    await waitFor(second, m => m.t === 'login_required', 'login após restart');
    second.ws.send(JSON.stringify({ t: 'auth_login', usuario, senha, avatarId: 'verde', aparelhoId: 'teste-restart-2' }));
    const reconhecida = await waitFor(second, m => m.t === 'auth_ok' && m.novo === false, 'conta após restart');
    const retomada = await waitFor(second, m => m.t === 'lote_atribuido' && m.posicao, 'lote após restart');
    const restaurado = await waitFor(second, m => m.t === 'estado' && Number.isFinite(m.cash), 'carteira após restart');
    assert.equal(reconhecida.usuario, usuario);
    assert.equal(retomada.loteIndex, lote.loteIndex, 'a conta deve recuperar o mesmo lote');
    assert.equal(retomada.retomada, true, 'restart deve indicar retomada da posição persistida');
    assert.ok(Math.hypot(retomada.posicao.x - destino.x, retomada.posicao.z - destino.z) < 1.2,
      `posição não restaurada: ${JSON.stringify(retomada.posicao)}`);
    assert.equal(restaurado.cash, 292, 'saldo deve sobreviver ao restart com SQLite');
    assert.ok(totalSeeds(restaurado) >= 3, 'sementes compradas devem sobreviver ao restart com SQLite');
    await fechar(second);
    second = null;
    console.log('PERSISTENCE_RESTART_OK', JSON.stringify({
      usuario, loteIndex: retomada.loteIndex, cash: restaurado.cash,
      sementes: totalSeeds(restaurado), x: retomada.posicao.x, z: retomada.posicao.z
    }));
  } catch (err) {
    console.error('PERSISTENCE_RESTART_FAILED:', err.stack || err.message);
    if (server && server._logs) console.error(server._logs());
    process.exitCode = 1;
  } finally {
    await fechar(first);
    await fechar(second);
    await stopServer(server);
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + suffix, { force: true });
  }
})();

// O token retornado no primeiro login é deliberadamente validado em test-login-conta.js;
// este teste concentra a prova complementar de senha + banco depois do restart.
