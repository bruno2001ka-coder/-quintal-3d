const WebSocket = require('ws');
const assert = require('node:assert/strict');

const URL = process.env.TEST_WS || 'ws://127.0.0.1:8866';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    ws.once('open', () => { client.send({ t:'hello', nome:'Teste Proteção Casa' }); resolve(client); });
    ws.once('error', reject);
  });
}

let c = null;
(async () => {
  c = await connect();
  const lote = await c.waitFor(m => m.t === 'lote_atribuido' && m.loteIndex !== null, 5000, 'lote próprio');
  await c.waitFor(m => m.t === 'estado', 5000, 'estado inicial');
  assert.ok(lote.lote && lote.lote.portaoId, 'lote deve ter portão authoritative');

  // O jogador nasce dentro da propriedade. O crime cria a PM, mas não pode
  // retirar vida enquanto ele permanece no quintal seguro.
  c.send({ t:'crime', peso:1 });
  await c.waitFor(m => m.t === 'procurado' && m.nivel >= 1, 3000, 'nível de procurado');
  const pmSnap = await c.waitFor(m => m.t === 'snap' && (m.bots || []).some(b => b.tipo === 'pm'), 6000, 'polícia no snapshot');
  const pm = pmSnap.bots.find(b => b.tipo === 'pm');
  assert.ok(pm && pm.id, 'polícia deve aparecer no mundo compartilhado');

  const hpAntes = 100;
  await sleep(3500);
  assert.equal(c.messages.some(m => m.t === 'levou_tiro'), false, 'não pode haver dano dentro da propriedade');
  assert.equal(c.messages.filter(m => m.t === 'snap' && (m.bots || []).some(b => b.id === pm.id)).length > 0, true,
    'a polícia deve continuar sendo enviada enquanto o procurado está ativo');

  // A entrada de clientes continua server-side e vinculada ao mesmo lote.
  c.send({ t:'portao', id:lote.lote.portaoId });
  await c.waitFor(m => m.t === 'portao_estado' && m.aberto === true, 3000, 'portão aberto');
  const clienteSnap = await c.waitFor(m => m.t === 'snap' && (m.clientes || []).some(x => x.loteIndex === lote.loteIndex), 6000, 'cliente da casa');
  const cliente = clienteSnap.clientes.find(x => x.loteIndex === lote.loteIndex);
  assert.ok(cliente && cliente.id, 'cliente deve pertencer ao lote do jogador');
  await sleep(2000);
  assert.equal(c.messages.some(m => m.t === 'snap' && (m.clientes || []).some(x => x.id === cliente.id)), true,
    'cliente deve continuar aparecendo em snapshots sucessivos');

  c.ws.close();
  console.log('PROTECAO_ENTIDADES_OK', JSON.stringify({ pmId:pm.id, clienteId:cliente.id, hp:hpAntes, loteIndex:lote.loteIndex }));
})().catch(err => {
  try { if (c) c.ws.close(); } catch (_) {}
  console.error('PROTECAO_ENTIDADES_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
