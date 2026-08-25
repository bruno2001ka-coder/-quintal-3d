const WebSocket = require('ws');
const assert = require('node:assert/strict');

const URL = process.env.TEST_WS || 'ws://127.0.0.1:8090';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function connect(nome) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const messages = [];
    const waiters = [];
    const client = {
      ws, messages,
      send(msg) { ws.send(JSON.stringify(msg)); },
      waitFor(predicate, timeout = 5000, label = 'mensagem') {
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
          const waiter = waiters.splice(i, 1)[0]; waiter.res(msg);
        }
      }
    });
    ws.once('open', () => { client.send({ t:'hello', nome, avatarId:'azul' }); resolve(client); });
    ws.once('error', reject);
  });
}
async function ready(c) {
  const sessao = await c.waitFor(m => m.t === 'sessao', 3000, 'sessão');
  const lote = await c.waitFor(m => m.t === 'lote_atribuido' && m.loteIndex !== null, 3000, 'lote atribuído');
  const estado = await c.waitFor(m => m.t === 'estado', 3000, 'estado');
  const welcome = c.messages.find(m => m.t === 'welcome');
  assert.ok(welcome && welcome.id, 'welcome deve conter o id do jogador');
  return { welcome, sessao, lote, estado };
}
async function moveTo(c, x, z, step = 7, delay = 650) {
  let current = { x: c.spawnX, z: c.spawnZ };
  while (Math.hypot(x - current.x, z - current.z) > .5) {
    const d = Math.hypot(x - current.x, z - current.z);
    const f = Math.min(step, d);
    current = { x: current.x + (x - current.x) / d * f, z: current.z + (z - current.z) / d * f };
    c.send({ t:'input', x:current.x, y:0, z:current.z, ry:0, arma:0 });
    await sleep(delay);
  }
  c.spawnX = current.x; c.spawnZ = current.z;
}

(async () => {
  const a = await connect('AOI A');
  const ai = await ready(a);
  const b = await connect('AOI B');
  const bi = await ready(b);
  assert.equal(ai.lote.loteIndex, 0, 'A deve receber o primeiro lote no banco isolado');
  assert.equal(bi.lote.loteIndex, 1, 'B deve receber o segundo lote no banco isolado');
  a.spawnX = -34; a.spawnZ = 35.8;
  b.spawnX = 2; b.spawnZ = 35.8;

  const seenAByB = await b.waitFor(m => m.t === 'snap' && (m.players || []).some(p => p.id === ai.welcome.id), 5000, 'A no snapshot de B');
  const jogadorA = seenAByB.players.find(p => p.id === ai.welcome.id);
  assert.equal(jogadorA.avatarId, 'azul', 'B deve receber o avatar escolhido por A');
  a.send({ t:'avatar', avatarId:'roxo' });
  const avatarAtualizado = await b.waitFor(m => m.t === 'nome' && m.id === ai.welcome.id && m.avatarId === 'roxo', 3000, 'atualização de avatar');
  assert.equal(avatarAtualizado.avatarId, 'roxo');

  const plotIndex = 5;
  await moveTo(a, -36.2, 29.6, 3, 650);
  const seedId = ai.estado.bank[0].s.id;
  a.send({ t:'plantar', plot:plotIndex, seedId });
  const plantEventB = await b.waitFor(m => m.t === 'lote_update' && m.loteIndex === 0 && m.plotIndex === plotIndex && m.plot && m.plot.id, 5000, 'planta de A no B');
  assert.equal(plantEventB.plot.loteIndex, 0);
  const idPlanta = plantEventB.plot.id;
  const mensagensBAntes = b.messages.length;
  const estadosDaPlanta = b.messages.filter(m =>
    (m.t === 'lote_update' && m.loteIndex === 0 && m.plotIndex === plotIndex && m.plot && m.plot.id === idPlanta) ||
    (m.t === 'lotes_update' && m.loteIndex === 0 && (m.updates || []).some(u => u.plotIndex === plotIndex && u.plot && u.plot.id === idPlanta)) ||
    (m.t === 'snap' && (m.lotes || []).some(L => L.index === 0 && L.plots && L.plots[plotIndex] && L.plots[plotIndex].id === idPlanta))
  );
  assert.equal(estadosDaPlanta.length, 1, 'B deve receber uma única representação do plantio de A até aqui');

  // Libera o portão de B e leva B para longe de A.
  b.send({ t:'portao', id:bi.lote.lote.portaoId });
  await b.waitFor(m => m.t === 'portao_estado' && m.aberto === true, 3000, 'portão B');
  await moveTo(b, 2, 42, 5, 500);
  await moveTo(b, 50, 42, 7, 650);
  const mensagensDepoisDoMovimento = b.messages.length;
  await sleep(3500);
  const novas = b.messages.slice(mensagensDepoisDoMovimento);
  assert.equal(novas.filter(m => (m.t === 'lote_update' || m.t === 'lotes_update') && m.loteIndex === 0).length, 0,
    'B fora do AOI não deve receber novo crescimento do lote de A');
  assert.ok(b.messages.length >= mensagensBAntes);
  a.ws.close(); b.ws.close();
  console.log('MULTIPLAYER_AOI_OK');
})().catch(err => {
  console.error('MULTIPLAYER_AOI_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
