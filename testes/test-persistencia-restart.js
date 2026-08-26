const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

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
    env: { ...process.env, PORT: String(PORT), DB_PATH, AUTH_SECRET },
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
function connect(token = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const messages = [];
    const timer = setTimeout(() => {
      ws.close(); reject(new Error('timeout no handshake/estado'));
    }, 6000);
    ws.on('open', () => ws.send(JSON.stringify({
      t: 'hello', token, nome: 'Persistência', avatarId: 'verde', sementeBase: BASE
    })));
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch (_) { return; }
      messages.push(m);
      if (m.t === 'estado') { clearTimeout(timer); resolve({ ws, messages }); }
    });
    ws.on('error', err => { clearTimeout(timer); reject(err); });
  });
}
function waitMessage(messages, type, ws, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const found = [...messages].reverse().find(m => m.t === type && predicate(m));
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error(`timeout aguardando ${type}`)), 4000);
    const onMessage = raw => {
      let m; try { m = JSON.parse(raw); } catch (_) { return; }
      if (m.t === type && predicate(m)) { clearTimeout(timer); ws.off('message', onMessage); resolve(m); }
    };
    ws.on('message', onMessage);
  });
}
function totalSeeds(state) {
  return (state.bank || []).reduce((n, e) => n + Number(e.qtd || 0), 0);
}

(async () => {
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + suffix, { force: true });
  let server = startServer();
  try {
    await waitHealth();
    const first = await connect();
    const session = first.messages.find(m => m.t === 'sessao');
    const lote = first.messages.find(m => m.t === 'lote_atribuido');
    const estadoInicial = first.messages.find(m => m.t === 'estado');
    assert.ok(session && session.token, 'primeira sessão deve entregar token');
    assert.ok(lote && lote.posicao, 'primeira sessão deve entregar posição');
    assert.equal(estadoInicial.cash, 350, 'carteira inicial deve ter R$350');
    first.ws.send(JSON.stringify({ t: 'comprar', oq: 'semente', strain: BASE }));
    const comprado = await waitMessage(first.messages, 'estado', first.ws, m => m.cash === 292 && totalSeeds(m) >= 3);
    assert.equal(comprado.cash, 292, 'compra deve persistir saldo R$292 antes do restart');
    assert.ok(totalSeeds(comprado) >= 3, 'compra deve aumentar o total de sementes antes do restart');
    const destino = { x: lote.posicao.x, y: 0, z: lote.posicao.z + 2.7, ry: 0 };
    first.ws.send(JSON.stringify({ t: 'input', seq: 1, ...destino, arma: 0 }));
    await sleep(250);
    first.ws.close();
    await sleep(150);
    await stopServer(server);
    server = startServer();
    await waitHealth();
    const second = await connect(session.token);
    const retomada = second.messages.find(m => m.t === 'lote_atribuido');
    const restaurado = second.messages.find(m => m.t === 'estado');
    assert.ok(retomada, 'segunda sessão deve entregar o lote');
    assert.equal(retomada.retomada, true, 'restart deve indicar retomada da posição persistida');
    assert.ok(Math.hypot(retomada.posicao.x - destino.x, retomada.posicao.z - destino.z) < 1.2,
      `posição não restaurada: ${JSON.stringify(retomada.posicao)}`);
    assert.equal(restaurado.cash, 292, 'saldo deve sobreviver ao restart com SQLite');
    assert.ok(totalSeeds(restaurado) >= 3, 'sementes compradas devem sobreviver ao restart com SQLite');
    second.ws.close();
    console.log('PERSISTENCE_RESTART_OK', JSON.stringify({
      cash: restaurado.cash,
      sementes: totalSeeds(restaurado),
      x: retomada.posicao.x,
      z: retomada.posicao.z
    }));
  } catch (err) {
    console.error('PERSISTENCE_RESTART_FAILED:', err.stack || err.message);
    process.exitCode = 1;
  } finally {
    await stopServer(server);
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + suffix, { force: true });
  }
})();
