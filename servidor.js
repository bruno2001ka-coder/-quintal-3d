// servidor.js — servidor autoritativo do Quintal 3D, agora com ESTADO DE
// JOGO de verdade, não só posição. Cada jogador que entra ganha um lote
// próprio (um "pedaço de terra"), com canteiros que o servidor mesmo
// simula crescendo — e avisa todo mundo quando algo muda.
//
// Importante: no plano grátis do Render isso vive em memória. Se o
// servidor reiniciar (dormiu por inatividade, ou saiu deploy novo), o
// mundo volta do zero. Pra guardar pra sempre precisaria de um banco de
// dados de verdade — não é isso ainda.

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const NUM_LOTES = 10;      // quantos lotes genéricos existem pro mundo
const PLOTS_POR_LOTE = 6;  // canteiros por lote

/* ───────── mundo ───────── */
const lotes = [];
for (let i = 0; i < NUM_LOTES; i++) {
  lotes.push({
    index: i,
    donoId: null,
    donoNome: null,
    plots: Array.from({ length: PLOTS_POR_LOTE }, () => null)
  });
}
const donoParaLote = new Map(); // chave persistente -> loteIndex
const donoAtivo = new Map();    // chave persistente -> id da conexão atual
function chaveDe(id){
  const p = players.get(id);
  return (p && p.persistId) ? p.persistId : id;
}

function atribuirLote(playerId, nome) {
  if (donoParaLote.has(playerId)) {
    const idx = donoParaLote.get(playerId);
    lotes[idx].donoNome = nome; // atualiza nome se mudou
    return idx;
  }
  const livre = lotes.find(l => l.donoId === null);
  if (!livre) return null; // mundo cheio, sem lote pra dar
  livre.donoId = playerId;
  livre.donoNome = nome;
  donoParaLote.set(playerId, livre.index);
  return livre.index;
}

/* ───────── física de crescimento, igual o jogo — mas rodando aqui ─────────
   Simplificado: lotes são só ao ar livre (sem estufa/LED), então a luz
   depende só de dia/noite. Roda em blocos de tempo real, sem precisar
   de ninguém conectado pra continuar contando. */
const DAYLEN = 190; // segundos reais = 1 dia de jogo, igual o cliente
let clockAcumulado = 6 * 60; // começa de manhã, em minutos de jogo

function luzAgora(clockMin) {
  const hour = (clockMin / 60) % 24;
  const dayT = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const isDay = hour >= 6 && hour < 18;
  return isDay ? (.35 + dayT * .85) : 0;
}

function tickPlanta(pl, dtSeg, clockMin) {
  if (!pl || pl.estagio >= 4) return;
  const s = pl.s;
  const luzBase = luzAgora(clockMin);
  const luz = s.auto ? Math.max(.82, luzBase) : luzBase;
  const chovendo = Math.random() < dtSeg / 6000;
  const sedeMul = chovendo ? .2 : (.55 + luz * .85);
  pl.agua = Math.max(0, pl.agua - dtSeg * .022 * (.6 + (100 - s.t.resistencia) / 100 * .9) * sedeMul);
  if (Math.random() < dtSeg * .0022 * (1.6 - s.t.resistencia / 100) && pl.estagio > 0 && !pl.praga) pl.praga = 1;
  if (pl.praga) pl.saude = Math.max(.12, pl.saude - dtSeg * .03);
  else if (pl.agua < .12) pl.saude = Math.max(.12, pl.saude - dtSeg * .05 * (1.4 - s.t.resistencia / 100));
  else if (pl.agua > .35) pl.saude = Math.min(1, pl.saude + dtSeg * .013);
  const aguaF = pl.agua < .1 ? 0 : Math.min(1, pl.agua * 1.7);
  const ciclo = (s.auto ? 86 : 150) - s.t.ritmo * (s.auto ? .45 : .95);
  const taxa = (100 / ciclo) * luz * aguaF * (.55 + pl.saude * .45) * (pl.praga ? .45 : 1);
  pl.prog = Math.min(100, pl.prog + taxa * dtSeg);
  // 5 estágios, idêntico ao cliente: semente/broto/jovem/adulta/pronta
  pl.estagio = pl.prog >= 100 ? 4 : pl.prog >= 75 ? 3 : pl.prog >= 50 ? 2 : pl.prog >= 25 ? 1 : 0;
}

/* ───────── rede ───────── */
const players = new Map(); // id -> {ws, nome, x,y,z,ry, ts}
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Quintal 3D — servidor multiplayer no ar. Jogadores agora: ' + players.size + '\n');
});
const wss = new WebSocketServer({ server });
let nextId = 1;

function broadcast(obj, exceptId) {
  const msg = JSON.stringify(obj);
  for (const [id, p] of players) {
    if (id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
}
function enviar(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function loteResumo(l) {
  return { index: l.index, donoId: l.donoId, donoNome: l.donoNome, plots: l.plots };
}

wss.on('connection', (ws) => {
  const id = String(nextId++);
  players.set(id, { ws, nome: 'Jogador' + id, x: 0, y: 0, z: 0, ry: 0, ts: Date.now() });

  enviar(ws, {
    t: 'welcome',
    id,
    players: [...players.entries()].filter(([pid]) => pid !== id)
      .map(([pid, p]) => ({ id: pid, nome: p.nome, x: p.x, y: p.y, z: p.z, ry: p.ry })),
    lotes: lotes.map(loteResumo)
  });
  broadcast({ t: 'join', id, nome: players.get(id).nome }, id);

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    const p = players.get(id);
    if (!p) return;

    if (msg.t === 'pos') {
      p.x = +msg.x || 0; p.y = +msg.y || 0; p.z = +msg.z || 0; p.ry = +msg.ry || 0; p.ts = Date.now();
      broadcast({ t: 'pos', id, x: p.x, y: p.y, z: p.z, ry: p.ry }, id);

    } else if (msg.t === 'nome') {
      p.nome = String(msg.nome || '').trim().slice(0, 18) || p.nome;
      const idx = donoParaLote.get(chaveDe(id));
      if (idx !== undefined) lotes[idx].donoNome = p.nome;
      broadcast({ t: 'nome', id, nome: p.nome }, id);

    } else if (msg.t === 'pedir_lote') {
      // identidade persistente: se o cliente manda um id fixo do aparelho,
      // ele recupera o MESMO lote ao reconectar (fechou a aba, caiu a net,
      // trocou de navegador). Sem isso cada reconexão gastava um lote novo.
      if (msg.persistId) p.persistId = String(msg.persistId).slice(0, 40);
      const chave = p.persistId || id;
      const idx = atribuirLote(chave, p.nome);
      if (idx !== null) donoAtivo.set(chave, id);
      enviar(ws, { t: 'lote_atribuido', loteIndex: idx, lote: idx !== null ? loteResumo(lotes[idx]) : null });

    } else if (msg.t === 'plantar') {
      const idx = donoParaLote.get(chaveDe(id));
      if (idx === undefined) return;
      const lote = lotes[idx];
      const pi = msg.plot | 0;
      if (pi < 0 || pi >= lote.plots.length) return;
      if (lote.plots[pi]) return; // já tem planta ali
      if (!msg.strain || !msg.strain.t) return;
      lote.plots[pi] = {
        s: msg.strain, prog: 0, agua: 1, saude: 1, praga: 0, estagio: 0, plantedAt: Date.now()
      };
      broadcast({ t: 'lote_update', loteIndex: idx, plotIndex: pi, plot: lote.plots[pi] });
      enviar(ws, { t: 'lote_update', loteIndex: idx, plotIndex: pi, plot: lote.plots[pi] });

    } else if (msg.t === 'regar') {
      const idx = donoParaLote.get(chaveDe(id));
      if (idx === undefined) return;
      const lote = lotes[idx];
      const pi = msg.plot | 0;
      const pl = lote.plots[pi];
      if (!pl) return;
      pl.agua = 1; if (pl.praga) pl.praga = 0;
      broadcast({ t: 'lote_update', loteIndex: idx, plotIndex: pi, plot: pl });

    } else if (msg.t === 'colher') {
      const idx = donoParaLote.get(chaveDe(id));
      if (idx === undefined) return;
      const lote = lotes[idx];
      const pi = msg.plot | 0;
      const pl = lote.plots[pi];
      if (!pl || pl.estagio !== 4) return;
      const autoPen = pl.s.auto ? .72 : 1;
      const RAR_MULT = { comum: 1, roxa: 1.35, laranja: 1.35, hibrida: 1.8 };
      const rm = RAR_MULT[pl.s.rar] || 1;
      const q = Math.max(2, Math.round((1.3 + pl.s.t.rendimento / 100 * 2.6) * pl.saude * 7 * autoPen * rm));
      lote.plots[pi] = null;
      broadcast({ t: 'lote_update', loteIndex: idx, plotIndex: pi, plot: null });
      enviar(ws, { t: 'colheita', plotIndex: pi, qtd: q, qual: .55 + pl.saude * .45, strain: pl.s });
    }
  });

  ws.on('close', () => { players.delete(id); broadcast({ t: 'leave', id }); });
  ws.on('error', () => {});
});

/* ───────── relógio do servidor: faz as plantas crescerem sozinhas ───────── */
const PASSO_MS = 15000; // recalcula a cada 15s reais
setInterval(() => {
  const dtSeg = PASSO_MS / 1000;
  clockAcumulado += dtSeg * (1440 / DAYLEN);
  if (clockAcumulado >= 1440) clockAcumulado -= 1440;
  for (const lote of lotes) {
    for (let i = 0; i < lote.plots.length; i++) {
      const pl = lote.plots[i];
      if (!pl || pl.estagio >= 4) continue;
      const estagioAntes = pl.estagio;
      tickPlanta(pl, dtSeg, clockAcumulado);
      if (pl.estagio !== estagioAntes) {
        broadcast({ t: 'lote_update', loteIndex: lote.index, plotIndex: i, plot: pl });
      }
    }
  }
}, PASSO_MS);

// limpa jogador travado sem avisar
setInterval(() => {
  const agora = Date.now();
  for (const [id, p] of players) {
    if (agora - p.ts > 30000 && p.ws.readyState !== p.ws.OPEN) {
      players.delete(id);
      broadcast({ t: 'leave', id });
    }
  }
}, 15000);

server.listen(PORT, () => console.log('Quintal 3D multiplayer (com estado) no ar na porta ' + PORT));
