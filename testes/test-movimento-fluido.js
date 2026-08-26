const assert = require('node:assert/strict');
const URL = process.env.TEST_WS || 'ws://127.0.0.1:8807';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function conectar(token = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const mensagens = [];
    let terminou = false;
    const timer = setTimeout(() => {
      if (!terminou) reject(new Error('timeout no handshake/movimento'));
    }, 7000);
    const finalizar = value => {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      resolve(value);
    };
    ws.onopen = () => ws.send(JSON.stringify({
      t: 'hello', token, nome: 'Movimento Fluido', avatarId: 'verde'
    }));
    ws.onmessage = raw => {
      let m;
      try { m = JSON.parse(raw.data || raw); } catch (_) { return; }
      mensagens.push(m);
      if (m.t === 'estado' && mensagens.some(x => x.t === 'lote_atribuido')) {
        finalizar({ ws, mensagens });
      }
    };
    ws.onerror = reject;
  });
}

(async () => {
  const primeiro = await conectar();
  const sessao = primeiro.mensagens.find(m => m.t === 'sessao');
  const lote = primeiro.mensagens.find(m => m.t === 'lote_atribuido');
  assert.ok(sessao && sessao.token, 'o servidor deve entregar sessão');
  assert.ok(lote && lote.posicao, 'o servidor deve entregar spawn authoritative');

  const origem = lote.posicao;
  const destino = { x: origem.x + 2.4, z: origem.z };
  const antes = primeiro.mensagens.length;
  for (let i = 1; i <= 40; i++) {
    const f = i / 40;
    primeiro.ws.send(JSON.stringify({
      t: 'input', seq: i, x: origem.x + (destino.x - origem.x) * f,
      y: 0, z: origem.z, ry: 0, arma: 0
    }));
    await sleep(60);
  }
  await sleep(180);
  const correcoes = primeiro.mensagens.slice(antes).filter(m => m.t === 'correcao');
  assert.equal(correcoes.length, 0, `movimento normal foi corrigido: ${JSON.stringify(correcoes.slice(0, 2))}`);
  primeiro.ws.close();
  await sleep(120);

  const segundo = await conectar(sessao.token);
  const retomada = segundo.mensagens.find(m => m.t === 'lote_atribuido');
  assert.ok(retomada && retomada.posicao, 'a reconexão deve devolver posição');
  assert.ok(Math.hypot(retomada.posicao.x - destino.x, retomada.posicao.z - destino.z) < 1.1,
    `posição não avançou: ${JSON.stringify(retomada.posicao)}`);
  segundo.ws.close();
  console.log('MOVIMENTO_FLUIDO_OK', JSON.stringify({
    origem: { x: origem.x, z: origem.z },
    destino: { x: destino.x, z: destino.z },
    retomada: { x: retomada.posicao.x, z: retomada.posicao.z },
    inputs: 40
  }));
})().catch(err => {
  console.error('MOVIMENTO_FLUIDO_FAILED:', err.stack || err.message);
  process.exitCode = 1;
});
