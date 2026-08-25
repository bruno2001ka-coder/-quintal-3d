const WebSocket = require('ws');
const assert = require('node:assert/strict');

const URL = process.env.TEST_WS || 'ws://127.0.0.1:8800';

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const messages = [];
    const waiters = [];
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          const waiter = waiters.splice(i, 1)[0];
          waiter.resolve(msg);
        }
      }
    });
    ws.once('open', () => resolve({ ws, messages, waitFor(predicate, timeout = 1500, label = 'unknown') {
      const found = messages.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const i = waiters.findIndex(x => x.resolve === res);
          if (i >= 0) waiters.splice(i, 1);
          rej(new Error('timeout waiting for server message: ' + label));
        }, timeout);
        waiters.push({ predicate, resolve: value => { clearTimeout(timer); res(value); }, reject: rej });
      });
    }}));
    ws.once('error', reject);
  });
}
function send(client, msg) { client.ws.send(JSON.stringify(msg)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const a = await connect();
  send(a, { t:'hello', persistId:'CLIENT_CONTROLLED_ID', nome:'Tester A' });
  const sessao = await a.waitFor(m => m.t === 'sessao', 1500, 'session');
  assert.equal(typeof sessao.token, 'string');
  assert.equal(sessao.token.split('.').length, 2);
  const lote = await a.waitFor(m => m.t === 'lote_atribuido', 1500, 'lot');
  assert.notEqual(lote.loteIndex, null);
  await a.waitFor(m => m.t === 'estado', 1500, 'initial state');

  // O portão e os clientes devem existir como estado server-side.
  send(a, { t:'portao', id:lote.lote.portaoId });
  await a.waitFor(m => m.t === 'portao_estado' && m.aberto === true, 1500, 'server gate state');
  const customerSnap = await a.waitFor(m => m.t === 'snap' && Array.isArray(m.clientes) && m.clientes.length > 0, 9000, 'server customer snapshot');
  assert.equal(typeof customerSnap.clientes[0].id, 'string');

  // Ação sem posse de semente deve ser recusada.
  send(a, { t:'plantar', plot:0, seedId:999999, strain:{ nome:'fake', t:{} } });
  const semSemente = await a.waitFor(m => m.t === 'recusado', 1500, 'forged planting rejection');
  assert.ok(semSemente);

  // Teleporte grande deve produzir correção e não alterar a posição.
  send(a, { t:'input', x:2000, y:0, z:2000, ry:0, arma:1 });
  const correcao = await a.waitFor(m => m.t === 'correcao', 1500, 'anti teleport correction');
  assert.ok(Number.isFinite(correcao.x) && Number.isFinite(correcao.z));

  // Reutilização da mesma sessão em outra conexão deve ser recusada.
  const b = await connect();
  send(b, { t:'hello', token:sessao.token, nome:'Tester B' });
  const recusado = await b.waitFor(m => m.t === 'recusado', 1500, 'duplicate session rejection');
  assert.match(recusado.motivo, /conectada/);
  b.ws.close();

  // hello duplicado na mesma conexão deve ser recusado.
  send(a, { t:'hello', token:sessao.token });
  const helloDuplicado = await a.waitFor(m => m.t === 'recusado' && /hello/.test(m.motivo), 1500, 'duplicate hello rejection');
  assert.ok(helloDuplicado);

  a.ws.close();
  await sleep(120);
  console.log('SECURITY_INTEGRATION_OK');
})().catch(err => {
  console.error('SECURITY_INTEGRATION_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});

process.on('uncaughtException', err => {
  console.error('SECURITY_INTEGRATION_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
process.on('unhandledRejection', err => {
  console.error('SECURITY_INTEGRATION_FAILED:', err && (err.stack || err.message) || err);
  process.exitCode = 1;
});
