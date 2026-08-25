const WebSocket = require('ws');
const assert = require('node:assert/strict');

const WS_URL = process.env.TEST_WS || 'ws://127.0.0.1:8095';
const HTTP_URL = process.env.TEST_HTTP || WS_URL.replace(/^ws/, 'http');
const TOTAL = Number(process.env.CLIENTES_CARGA || 24);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function abrir(i) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let snaps = 0;
    let abriu = false;
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('timeout no cliente ' + i)); }, 5000);
    ws.on('open', () => {
      abriu = true;
      ws.send(JSON.stringify({ t:'hello', nome:'Carga ' + i, avatarId: i % 2 ? 'azul' : 'verde' }));
    });
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg.t === 'snap') snaps++;
      if (msg.t === 'estado') {
        clearTimeout(timer);
        resolve({ ws, get snaps() { return snaps; }, abriu });
      }
    });
    ws.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

(async () => {
  const clientes = await Promise.all(Array.from({ length: TOTAL }, (_, i) => abrir(i)));
  await sleep(2500);
  for (let rodada = 0; rodada < 8; rodada++) {
    for (let i = 0; i < clientes.length; i++) {
      const x = -34 + (i % 3) * 36;
      const z = 35.8 + Math.sin(rodada / 2) * 1.5;
      clientes[i].ws.send(JSON.stringify({ t:'input', x, y:0, z, ry:0, arma:0 }));
    }
    await sleep(250);
  }
  const response = await fetch(HTTP_URL + '/metrics');
  assert.equal(response.ok, true, 'endpoint /metrics deve responder');
  const metrics = await response.json();
  assert.ok(metrics.jogadores >= TOTAL, `servidor deve manter ${TOTAL} jogadores, recebeu ${metrics.jogadores}`);
  assert.ok(metrics.snapshots > 0, 'servidor deve produzir snapshots');
  assert.ok(Number.isFinite(metrics.tickMaxMs), 'tickMaxMs deve ser numérico');
  for (const c of clientes) c.ws.close();
  console.log('LOAD_24_OK', JSON.stringify({ jogadores:metrics.jogadores, snapshots:metrics.snapshots, tickMaxMs:metrics.tickMaxMs, descartadas:metrics.descartadasPorBackpressure }));
})().catch(err => {
  console.error('LOAD_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
