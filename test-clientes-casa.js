const WebSocket = require('ws');
const assert = require('node:assert/strict');
const URL = process.env.TEST_WS || 'ws://127.0.0.1:8860';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws = null;
(async () => {
  ws = new WebSocket(URL);
  const mensagens = [];
  ws.on('message', raw => { try { mensagens.push(JSON.parse(raw)); } catch (_) {} });
  await new Promise((resolve, reject) => { ws.once('open', () => { ws.send(JSON.stringify({ t:'hello', nome:'Casa Teste' })); resolve(); }); ws.once('error', reject); });
  const until = async (pred, ms = 6000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { const hit = mensagens.find(pred); if (hit) return hit; await sleep(80); }
    throw new Error('timeout no evento');
  };
  const lote = await until(m => m.t === 'lote_atribuido' && m.loteIndex !== null);
  await until(m => m.t === 'estado');
  assert.ok(lote.lote && lote.lote.portaoId);
  ws.send(JSON.stringify({ t:'portao', id:lote.lote.portaoId }));
  await until(m => m.t === 'portao_estado' && m.aberto === true);
  assert.equal(typeof lote.lote.x, 'number');
  assert.equal(typeof lote.lote.z, 'number');
  const bx = lote.lote.x + 6.8;
  const bz = lote.lote.z + 3.6;
  let chegou = null;
  const fim = Date.now() + 12000;
  while (Date.now() < fim) {
    const snaps = mensagens.filter(m => m.t === 'snap');
    for (const s of snaps) for (const c of (s.clientes || [])) {
      if (c.loteIndex !== lote.loteIndex) continue;
      const d = Math.hypot(c.x - bx, c.z - bz);
      if (c.fase === 'atendendo' && d < .9) { chegou = { id:c.id, fase:c.fase, x:c.x, z:c.z, distancia:d }; break; }
    }
    if (chegou) break;
    await sleep(200);
  }
  assert.ok(chegou, 'cliente não chegou à bancada da casa');
  ws.close();
  console.log('CLIENTE_CASA_OK', JSON.stringify(chegou));
})().catch(err => {
  try { if (ws) ws.close(); } catch (_) {}
  console.error('CLIENTE_CASA_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
