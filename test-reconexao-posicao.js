const WebSocket = require('ws');
const assert = require('node:assert/strict');
const URL = process.env.TEST_WS || 'ws://127.0.0.1:8106';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function conectar(token = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL), mensagens = [];
    const timer = setTimeout(() => reject(new Error('timeout no handshake')), 5000);
    ws.on('open', () => ws.send(JSON.stringify({ t:'hello', token, nome:'Retomada', avatarId:'verde' })));
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch (_) { return; }
      mensagens.push(m);
      if (m.t === 'estado') { clearTimeout(timer); resolve({ ws, mensagens }); }
    });
    ws.on('error', reject);
  });
}
(async () => {
  const primeiro = await conectar();
  const sessao = primeiro.mensagens.find(m => m.t === 'sessao');
  const lote = primeiro.mensagens.find(m => m.t === 'lote_atribuido');
  assert.ok(sessao && sessao.token, 'primeira conexão deve entregar token');
  assert.ok(lote && lote.posicao, 'primeira conexão deve entregar posição oficial');
  const destino = { x: lote.posicao.x + 4, z: lote.posicao.z };
  for (let i = 1; i <= 12; i++) {
    primeiro.ws.send(JSON.stringify({ t:'input', x:lote.posicao.x + (destino.x-lote.posicao.x)*i/12, y:0, z:destino.z, ry:0, arma:0 }));
    await sleep(80);
  }
  await sleep(150);
  primeiro.ws.close();
  await sleep(120);
  const segundo = await conectar(sessao.token);
  const retomada = segundo.mensagens.find(m => m.t === 'lote_atribuido');
  assert.equal(retomada.retomada, true, 'reconexão curta deve indicar retomada');
  assert.ok(Math.hypot(retomada.posicao.x-destino.x, retomada.posicao.z-destino.z) < 1.2,
    `posição retomada inesperada: ${JSON.stringify(retomada.posicao)}`);
  segundo.ws.close();
  console.log('RECONNECTION_POSITION_OK', JSON.stringify({ x:retomada.posicao.x, z:retomada.posicao.z }));
})().catch(err => { console.error('RECONNECTION_POSITION_FAILED:', err.stack || err.message); process.exitCode = 1; });
