const WebSocket = require('ws');
const assert = require('node:assert/strict');
const URL = process.env.TEST_WS || 'ws://127.0.0.1:8897';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function conectar() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL), mensagens = [];
    const client = {
      ws, mensagens,
      enviar(m) { ws.send(JSON.stringify(m)); },
      esperar(pred, timeout = 5000) {
        const antigo = mensagens.find(pred); if (antigo) return Promise.resolve(antigo);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { ws.off('message', on); rej(new Error('timeout greenhouse')); }, timeout);
          const on = raw => { let m; try { m = JSON.parse(raw); } catch (_) { return; }
            if (!pred(m)) return; clearTimeout(timer); ws.off('message', on); res(m); };
          ws.on('message', on);
        });
      }
    };
    ws.on('message', raw => { try { mensagens.push(JSON.parse(raw)); } catch (_) {} });
    ws.once('open', () => { client.enviar({ t:'hello', token:'', nome:'Greenhouse Access Test' }); resolve(client); });
    ws.once('error', reject);
  });
}

async function moverAte(c, origem, alvo, seqInicial) {
  let x = origem.x, z = origem.z, seq = seqInicial;
  for (let i = 0; i < 30; i++) {
    const dx = alvo.x - x, dz = alvo.z - z, d = Math.hypot(dx, dz);
    if (d < .08) return { x, z, seq };
    const passo = Math.min(.5, d);
    x += dx / d * passo; z += dz / d * passo; seq++;
    c.enviar({ t:'input', seq, x, y:0, z, ry:0, arma:0 });
    await sleep(110);
    const correcao = c.mensagens.slice(-4).find(m => m.t === 'correcao' && m.seq === seq);
    if (correcao) { x = correcao.x; z = correcao.z; }
  }
  return { x, z, seq };
}

(async () => {
  const c = await conectar();
  const lote = await c.esperar(m => m.t === 'lote_atribuido');
  await c.esperar(m => m.t === 'estado');
  const origem = lote.posicao;
  const centroLote = { x: origem.x, z: origem.z - (16 / 2 - 3.2) };
  const porta = { x: centroLote.x + 4.2, z: centroLote.z - 1.7 };
  const alinhado = await moverAte(c, origem, { x: porta.x, z: origem.z }, 0);
  const fora = await moverAte(c, alinhado, { x: porta.x, z: porta.z + 1.0 }, alinhado.seq);
  const dentro = await moverAte(c, fora, { x: porta.x, z: porta.z - 0.8 }, fora.seq);
  assert.ok(Math.abs(dentro.x - porta.x) < .8, `não alinhou à porta: ${JSON.stringify(dentro)}`);
  assert.ok(dentro.z < porta.z - .35, `não entrou pela porta da estufa: ${JSON.stringify({ dentro, porta })}`);
  const tentativaParede = await moverAte(c, dentro, { x:centroLote.x + 1.0, z: dentro.z }, dentro.seq);
  assert.ok(tentativaParede.x > centroLote.x + 2.4, `parede lateral não bloqueou: ${JSON.stringify(tentativaParede)}`);
  c.ws.close();
  console.log('GREENHOUSE_ACCESS_OK', JSON.stringify({ origem, porta, dentro, tentativaParede }));
})().catch(err => {
  console.error('GREENHOUSE_ACCESS_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
