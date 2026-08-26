const WebSocket = require('ws');
const assert = require('node:assert/strict');

const URL = process.env.TEST_WS || 'ws://127.0.0.1:8865';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PLOT_OFFSETS = [[-7,-4],[-4.6,-4],[-2.2,-4],[-7,-1.4],[-4.6,-1.4],[-2.2,-1.4]];

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const messages = [];
    const waiters = [];
    const client = {
      ws, messages,
      send(msg) { ws.send(JSON.stringify(msg)); },
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
      let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          const waiter = waiters.splice(i, 1)[0];
          waiter.res(msg);
        }
      }
    });
    ws.once('open', () => { client.send({ t:'hello', nome:'Teste Plantio Próprio' }); resolve(client); });
    ws.once('error', reject);
  });
}

async function moveTo(c, x, z) {
  let current = { x:c.spawnX, z:c.spawnZ };
  while (Math.hypot(x-current.x, z-current.z) > .45) {
    const d = Math.hypot(x-current.x, z-current.z);
    const step = Math.min(2.5, d);
    current = { x:current.x+(x-current.x)/d*step, z:current.z+(z-current.z)/d*step };
    c.send({ t:'input', x:current.x, y:0, z:current.z, ry:0, arma:0 });
    await sleep(650);
  }
  c.spawnX=current.x; c.spawnZ=current.z;
}

let c = null;
(async () => {
  c = await connect();
  const atribuido = await c.waitFor(m => m.t === 'lote_atribuido' && m.loteIndex !== null, 5000, 'lote próprio');
  const estado = await c.waitFor(m => m.t === 'estado', 5000, 'carteira');
  assert.ok(atribuido.lote && Number.isFinite(atribuido.lote.x) && Number.isFinite(atribuido.lote.z));
  assert.ok(estado.bank && estado.bank[0] && estado.bank[0].s && estado.bank[0].s.id !== undefined, 'carteira deve ter semente inicial');

  c.spawnX = atribuido.lote.x;
  c.spawnZ = atribuido.lote.z + 4.8;
  const [ox, oz] = PLOT_OFFSETS[5];
  const plot = 5;
  await moveTo(c, atribuido.lote.x + ox, atribuido.lote.z + oz);
  c.send({ t:'plantar', plot, seedId:estado.bank[0].s.id });

  const resposta = await c.waitFor(m =>
    (m.t === 'lote_update' && m.loteIndex === atribuido.loteIndex && m.plotIndex === plot && m.plot && m.plot.id) ||
    (m.t === 'recusado'), 5000, 'planta no lote próprio');
  if(resposta.t === 'recusado')throw new Error('plantio recusado: '+(resposta.motivo||'sem motivo'));
  const plantado = resposta;
  assert.equal(plantado.plot.loteIndex, atribuido.loteIndex);
  assert.equal(plantado.plot.plotIndex, plot);
  assert.equal(plantado.plot.prog, 0);
  assert.equal(c.messages.some(m => m.t === 'recusado' && /territ[oó]rio/i.test(m.motivo || '')), false, 'plantio não pode disparar captura de território');
  c.ws.close();
  console.log('PLANTIO_PROPRIO_OK', JSON.stringify({ loteIndex:atribuido.loteIndex, plot, plantaId:plantado.plot.id }));
})().catch(err => {
  try { if (c) c.ws.close(); } catch (_) {}
  console.error('PLANTIO_PROPRIO_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
