'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   QUINTAL 3D — servidor autoritativo
   ───────────────────────────────────────────────────────────────────────
   Arquitetura seguindo as práticas padrão de jogo em rede:

   1. TICK FIXO (20Hz). O servidor não reprocessa a cada mensagem que
      chega — ele enfileira os inputs e aplica todos de uma vez por tick.
      Sem isso, N jogadores geram N² mensagens e o servidor derrete.

   2. SNAPSHOTS COM SEQUÊNCIA. Cada tick manda um retrato do mundo com
      número de tick. O cliente interpola entre snapshots pra esconder
      o jitter da rede.

   3. INTEREST MANAGEMENT (AOI). Só manda os jogadores que estão perto.
      Quem está do outro lado do mapa não gasta banda de ninguém.

   4. HEARTBEAT ping/pong. Conexão pode morrer em silêncio (NAT, wifi
      trocando, celular bloqueando). Sem heartbeat vira zumbi ocupando
      memória pra sempre.

   5. RATE LIMIT por socket (token bucket) + limite de tamanho de
      mensagem. Sem isso um cliente malicioso trava o servidor sozinho.

   6. VALIDAÇÃO DE TUDO. Nada que vem do cliente é confiável: posição
      tem checagem de velocidade (anti-teleporte), números são limitados,
      strings são cortadas, JSON quebrado é descartado.

   7. DESLIGAMENTO LIMPO. Ao reiniciar, avisa os clientes com código
      1001 em vez de largar a conexão no vácuo.

   LIMITE CONHECIDO: o estado vive em memória. No plano grátis do Render
   o serviço dorme por inatividade e o mundo volta do zero. Persistência
   de verdade precisa de banco de dados — é o próximo passo, não este.
   ═══════════════════════════════════════════════════════════════════════ */

const { WebSocketServer } = require('ws');
const http = require('http');

/* ───────── configuração ───────── */
const PORT              = process.env.PORT || 8080;
const TICK_HZ           = 20;                    // ticks por segundo
const TICK_MS           = 1000 / TICK_HZ;
const AOI_RAIO          = 70;                    // metros: só vê quem está perto
const HEARTBEAT_MS      = 30000;                 // ping a cada 30s
const HEARTBEAT_TIMEOUT = 10000;                 // 10s pra responder
const MAX_PAYLOAD       = 4 * 1024;              // 4KB por mensagem
const MAX_CONEXOES      = 64;
const RATE_BURST        = 60;                    // balde de tokens
const RATE_RECARGA      = 40;                    // tokens por segundo
const VEL_MAX           = 14;                    // m/s — corrida é ~6, folga pra lag
const NUM_LOTES         = 10;
const PLOTS_POR_LOTE    = 6;
const DAYLEN            = 600;                   // seg reais = 1 dia de jogo (igual o cliente)
const GROW_MS           = 1000;                  // recalcula plantas a cada 1s

/* ───────── util ───────── */
const num = (v, min, max, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const agora = () => Date.now();

/* ───────── mundo ───────── */
const lotes = [];
for (let i = 0; i < NUM_LOTES; i++) {
  lotes.push({
    index: i, donoChave: null, donoNome: null,
    plots: Array.from({ length: PLOTS_POR_LOTE }, () => null)
  });
}
const loteDe = new Map();   // chave persistente -> índice do lote

function atribuirLote(chave, nome) {
  if (loteDe.has(chave)) {
    const i = loteDe.get(chave);
    lotes[i].donoNome = nome;
    return i;
  }
  const livre = lotes.find(l => l.donoChave === null);
  if (!livre) return null;
  livre.donoChave = chave;
  livre.donoNome = nome;
  loteDe.set(chave, livre.index);
  return livre.index;
}

/* ───────── simulação das plantas (autoridade do servidor) ───────── */
let relogio = 6 * 60;   // minutos de jogo

function luzEm(clockMin) {
  const h = (clockMin / 60) % 24;
  const dayT = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
  return (h >= 6 && h < 18) ? (.35 + dayT * .85) : 0;
}
const RAR_MULT = { comum: 1, roxa: 1.35, laranja: 1.35, hibrida: 1.8 };

function crescer(pl, dt, clockMin) {
  if (!pl || pl.estagio >= 4) return false;
  const s = pl.s;
  const antes = pl.estagio;
  const luzBase = luzEm(clockMin);
  const luz = s.auto ? Math.max(.82, luzBase) : luzBase;
  const chovendo = Math.random() < dt / 6000;
  const sede = chovendo ? .2 : (.55 + luz * .85);
  pl.agua = Math.max(0, pl.agua - dt * .022 * (.6 + (100 - s.t.resistencia) / 100 * .9) * sede);
  if (Math.random() < dt * .0022 * (1.6 - s.t.resistencia / 100) && pl.estagio > 0 && !pl.praga) pl.praga = 1;
  if (pl.praga) pl.saude = Math.max(.12, pl.saude - dt * .03);
  else if (pl.agua < .12) pl.saude = Math.max(.12, pl.saude - dt * .05 * (1.4 - s.t.resistencia / 100));
  else if (pl.agua > .35) pl.saude = Math.min(1, pl.saude + dt * .013);
  const aguaF = pl.agua < .1 ? 0 : Math.min(1, pl.agua * 1.7);
  const ciclo = (s.auto ? 86 : 150) - s.t.ritmo * (s.auto ? .45 : .95);
  const taxa = (100 / ciclo) * luz * aguaF * (.55 + pl.saude * .45) * (pl.praga ? .45 : 1);
  pl.prog = Math.min(100, pl.prog + taxa * dt);
  // 5 estágios: semente/broto/jovem/adulta/pronta — igual o cliente
  pl.estagio = pl.prog >= 100 ? 4 : pl.prog >= 75 ? 3 : pl.prog >= 50 ? 2 : pl.prog >= 25 ? 1 : 0;
  return pl.estagio !== antes;
}

/* valida uma genética vinda do cliente: nada entra sem passar por aqui */
function limparStrain(raw) {
  if (!raw || typeof raw !== 'object' || !raw.t || typeof raw.t !== 'object') return null;
  const rar = ['comum', 'roxa', 'laranja', 'hibrida'].includes(raw.rar) ? raw.rar : 'comum';
  return {
    id: num(raw.id, 0, 1e9, 0),
    nome: str(raw.nome, 28) || 'Sem nome',
    cor: num(raw.cor, 0, 0xffffff, 0x5f9c46),
    gen: num(raw.gen, 0, 50, 0),
    auto: !!raw.auto,
    rar,
    t: {
      ritmo:       num(raw.t.ritmo, 0, 100, 50),
      rendimento:  num(raw.t.rendimento, 0, 100, 50),
      resistencia: num(raw.t.resistencia, 0, 100, 50),
      aroma:       num(raw.t.aroma, 0, 100, 50),
      brilho:      num(raw.t.brilho, 0, 100, 50)
    }
  };
}

/* ───────── BOTS (rivais e polícia) ─────────
   Antes cada jogador rodava a própria cópia dos bots: dois jogadores lado a
   lado viam inimigos diferentes, e matar um não valia pro outro. Agora quem
   manda neles é o servidor, e todo mundo vê os MESMOS bots nos mesmos
   lugares. */
const TERRITORIOS = [
  { nome:'Beco do Mercado', x:-18, z:23 }, { nome:'Praça da Torre', x:2,  z:31 },
  { nome:'Vila Alta',       x:22,  z:39 }, { nome:'Fundão',        x:2,  z:55 },
  { nome:'Zona Nova',       x:2,   z:71 }, { nome:'Alto da Torre', x:-34,z:55 },
  { nome:'Boca do Rio',     x:38,  z:87 }, { nome:'Jardim Alvorada',x:-50,z:103 },
  { nome:'Beira-Linha',     x:22,  z:119}, { nome:'Saída da BR',   x:-18,z:135 }
];
const bots = [];
let proxBot = 1;
const BOT_VEL = 2.2, BOT_VIDA = 60, BOT_AGRO = 16;

function nascerBots() {
  bots.length = 0;
  TERRITORIOS.forEach((t, ti) => {
    const n = 2 + (ti % 3);          // 2 a 4 rivais por ponto
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      bots.push({
        id: 'b' + (proxBot++), tipo: 'rival', terr: ti,
        casaX: t.x + Math.cos(a) * 4, casaZ: t.z + Math.sin(a) * 4,
        x: t.x + Math.cos(a) * 4, z: t.z + Math.sin(a) * 4,
        ry: 0, hp: BOT_VIDA, alvo: null, vagarT: 0, vagarX: 0, vagarZ: 0
      });
    }
  });
}
nascerBots();

function passoBot(b, dt) {
  // procura o jogador mais perto dentro do raio de agressão
  let maisPerto = null, melhor = BOT_AGRO;
  for (const [, j] of jogadores) {
    const d = Math.hypot(j.x - b.x, j.z - b.z);
    if (d < melhor) { melhor = d; maisPerto = j; }
  }
  let tx, tz;
  if (maisPerto) {
    b.alvo = maisPerto.id; tx = maisPerto.x; tz = maisPerto.z;
  } else {
    b.alvo = null;
    // sem ninguém por perto: vagueia em volta do próprio ponto
    b.vagarT -= dt;
    if (b.vagarT <= 0) {
      b.vagarT = 3 + Math.random() * 4;
      b.vagarX = b.casaX + (Math.random() - .5) * 7;
      b.vagarZ = b.casaZ + (Math.random() - .5) * 7;
    }
    tx = b.vagarX; tz = b.vagarZ;
  }
  const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
  if (d > 1.1) {
    const passo = BOT_VEL * dt;
    b.x += dx / d * passo;
    b.z += dz / d * passo;
    b.ry = Math.atan2(dx, dz);
  }
  // nunca entra no quintal de ninguém: trava na fronteira da cidade
  if (b.z < 12) b.z = 12;
}

/* ───────── rede ───────── */
const jogadores = new Map();   // id -> estado
let proxId = 1;
let tickAtual = 0;
const metricas = { msgRecebidas: 0, msgEnviadas: 0, rejeitadas: 0, desdeT: agora() };

const server = http.createServer((req, res) => {
  if (req.url === '/metrics') {
    const dt = (agora() - metricas.desdeT) / 1000;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jogadores: jogadores.size,
      tick: tickAtual,
      tickHz: TICK_HZ,
      msgRecebidasPorSeg: +(metricas.msgRecebidas / dt).toFixed(1),
      msgEnviadasPorSeg: +(metricas.msgEnviadas / dt).toFixed(1),
      rejeitadas: metricas.rejeitadas,
      lotesOcupados: lotes.filter(l => l.donoChave).length,
      uptimeSeg: Math.round(process.uptime()),
      memoriaMB: +(process.memoryUsage().rss / 1048576).toFixed(1)
    }, null, 2));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Quintal 3D — servidor no ar
jogadores: ${jogadores.size}
tick: ${tickAtual} (${TICK_HZ}Hz)
lotes ocupados: ${lotes.filter(l => l.donoChave).length}/${NUM_LOTES}
uptime: ${Math.round(process.uptime())}s
`);
});

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

function enviar(j, obj) {
  if (j.ws.readyState !== 1) return;
  try { j.ws.send(JSON.stringify(obj)); metricas.msgEnviadas++; } catch (e) {}
}
function paraTodos(obj, exceto) {
  for (const [id, j] of jogadores) {
    if (id === exceto) continue;
    enviar(j, obj);
  }
}
function resumoLote(l) {
  return { index: l.index, donoNome: l.donoNome, plots: l.plots };
}

wss.on('connection', (ws, req) => {
  if (jogadores.size >= MAX_CONEXOES) {
    ws.close(1013, 'servidor cheio');
    return;
  }
  const id = String(proxId++);
  const j = {
    id, ws,
    nome: 'Jogador' + id,
    chave: null,
    x: 0, y: 0, z: 0, ry: 0, arma: 0,
    ultimoMov: agora(),
    vivo: true, ultimoPong: agora(),
    tokens: RATE_BURST, ultimaRecarga: agora(),
    entrouEm: agora()
  };
  jogadores.set(id, j);

  enviar(j, {
    t: 'welcome', id, tick: tickAtual, tickHz: TICK_HZ,
    lotes: lotes.map(resumoLote)
  });
  paraTodos({ t: 'join', id, nome: j.nome }, id);

  ws.on('pong', () => { j.ultimoPong = agora(); j.vivo = true; });

  ws.on('message', (raw) => {
    metricas.msgRecebidas++;

    // rate limit: balde de tokens por socket
    const t = agora();
    j.tokens = Math.min(RATE_BURST, j.tokens + (t - j.ultimaRecarga) / 1000 * RATE_RECARGA);
    j.ultimaRecarga = t;
    if (j.tokens < 1) { metricas.rejeitadas++; return; }
    j.tokens--;

    let m;
    try { m = JSON.parse(raw); } catch (e) { metricas.rejeitadas++; return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') { metricas.rejeitadas++; return; }

    switch (m.t) {
      case 'pong':
        j.ultimoPong = t; j.vivo = true;
        break;

      case 'hello': {
        j.chave = str(m.persistId, 40) || id;
        if (m.nome) j.nome = str(m.nome, 18).trim() || j.nome;
        const idx = atribuirLote(j.chave, j.nome);
        enviar(j, {
          t: 'lote_atribuido',
          loteIndex: idx,
          lote: idx !== null ? resumoLote(lotes[idx]) : null
        });
        paraTodos({ t: 'nome', id, nome: j.nome }, id);
        break;
      }

      case 'nome': {
        j.nome = str(m.nome, 18).trim() || j.nome;
        if (j.chave && loteDe.has(j.chave)) lotes[loteDe.get(j.chave)].donoNome = j.nome;
        paraTodos({ t: 'nome', id, nome: j.nome }, id);
        break;
      }

      case 'input': {
        // movimento com checagem de velocidade — anti-teleporte
        const nx = num(m.x, -2000, 2000, j.x);
        const ny = num(m.y, -400, 400, j.y);
        const nz = num(m.z, -2000, 2000, j.z);
        const dtMov = Math.max(.001, (t - j.ultimoMov) / 1000);
        const dist = Math.hypot(nx - j.x, nz - j.z);
        const limite = VEL_MAX * dtMov + 2;   // folga pra lag
        if (dist > limite) {
          // rejeita e corrige o cliente
          metricas.rejeitadas++;
          enviar(j, { t: 'correcao', x: j.x, y: j.y, z: j.z });
        } else {
          j.x = nx; j.y = ny; j.z = nz;
        }
        j.ry = num(m.ry, -Math.PI * 4, Math.PI * 4, j.ry);
        j.arma = num(m.arma, 0, 3, j.arma) | 0;   // qual arma está na mão
        j.ultimoMov = t;
        break;
      }

      case 'plantar': {
        if (!j.chave || !loteDe.has(j.chave)) return;
        const lote = lotes[loteDe.get(j.chave)];
        const pi = num(m.plot, 0, PLOTS_POR_LOTE - 1, -1) | 0;
        if (pi < 0 || lote.plots[pi]) return;
        const s = limparStrain(m.strain);
        if (!s) { metricas.rejeitadas++; return; }
        lote.plots[pi] = { s, prog: 0, agua: 1, saude: 1, praga: 0, estagio: 0 };
        const ev = { t: 'lote_update', loteIndex: lote.index, plotIndex: pi, plot: lote.plots[pi] };
        paraTodos(ev); enviar(j, ev);
        break;
      }

      case 'regar': {
        if (!j.chave || !loteDe.has(j.chave)) return;
        const lote = lotes[loteDe.get(j.chave)];
        const pi = num(m.plot, 0, PLOTS_POR_LOTE - 1, -1) | 0;
        const pl = lote.plots[pi];
        if (!pl) return;
        pl.agua = 1; pl.praga = 0;
        const ev = { t: 'lote_update', loteIndex: lote.index, plotIndex: pi, plot: pl };
        paraTodos(ev); enviar(j, ev);
        break;
      }

      case 'tiro_bot': {
        // O SERVIDOR decide se o tiro valeu. O cliente só avisa em quem
        // acertou — dano, morte e renascimento são decididos aqui, senão
        // cada jogador mataria o bot na própria tela e ninguém concordaria.
        const b = bots.find(x => x.id === String(m.bot).slice(0, 12));
        if (!b || b.hp <= 0) return;
        if (Math.hypot(b.x - j.x, b.z - j.z) > 60) { metricas.rejeitadas++; return; }
        const dano = num(m.dano, 1, 60, 10);
        b.hp -= dano;
        if (b.hp <= 0) {
          b.hp = 0;
          paraTodos({ t: 'bot_morreu', id: b.id, porQuem: j.nome });
          // renasce depois de um tempo, no próprio ponto
          setTimeout(() => {
            b.x = b.casaX; b.z = b.casaZ; b.hp = BOT_VIDA; b.alvo = null;
            paraTodos({ t: 'bot_nasceu', id: b.id });
          }, 25000);
        } else {
          paraTodos({ t: 'bot_dano', id: b.id, hp: b.hp });
        }
        break;
      }
      case 'colher': {
        if (!j.chave || !loteDe.has(j.chave)) return;
        const lote = lotes[loteDe.get(j.chave)];
        const pi = num(m.plot, 0, PLOTS_POR_LOTE - 1, -1) | 0;
        const pl = lote.plots[pi];
        if (!pl || pl.estagio !== 4) return;
        const autoPen = pl.s.auto ? .72 : 1;
        const rm = RAR_MULT[pl.s.rar] || 1;
        const q = Math.max(2, Math.round(
          (1.3 + pl.s.t.rendimento / 100 * 2.6) * pl.saude * 7 * autoPen * rm));
        lote.plots[pi] = null;
        const ev = { t: 'lote_update', loteIndex: lote.index, plotIndex: pi, plot: null };
        paraTodos(ev); enviar(j, ev);
        enviar(j, { t: 'colheita', plotIndex: pi, qtd: q, qual: .55 + pl.saude * .45, strain: pl.s });
        break;
      }

      default:
        metricas.rejeitadas++;
    }
  });

  ws.on('close', () => { jogadores.delete(id); paraTodos({ t: 'leave', id }); });
  ws.on('error', () => {});
});

/* ───────── tick fixo: um snapshot por tick, só de quem está perto ───────── */
setInterval(() => {
  tickAtual++;
  const dtTick = TICK_MS / 1000;
  if (jogadores.size) for (const b of bots) if (b.hp > 0) passoBot(b, dtTick);
  for (const [id, j] of jogadores) {
    const perto = [];
    for (const [oid, o] of jogadores) {
      if (oid === id) continue;
      if (Math.hypot(o.x - j.x, o.z - j.z) > AOI_RAIO) continue;
      perto.push({
        id: oid, nome: o.nome,
        x: +o.x.toFixed(2), y: +o.y.toFixed(2),
        z: +o.z.toFixed(2), ry: +o.ry.toFixed(3), arma: o.arma
      });
    }
    const botsPerto = [];
    for (const b of bots) {
      if (b.hp <= 0) continue;
      if (Math.hypot(b.x - j.x, b.z - j.z) > AOI_RAIO) continue;
      botsPerto.push({ id: b.id, tipo: b.tipo, x: +b.x.toFixed(2),
        z: +b.z.toFixed(2), ry: +b.ry.toFixed(3), hp: b.hp, agro: !!b.alvo });
    }
    enviar(j, { t: 'snap', tick: tickAtual, players: perto, bots: botsPerto });
  }
}, TICK_MS);

/* ───────── crescimento das plantas ─────────
   O crescimento é o coração do jogo, então ele precisa aparecer ANDANDO,
   não pulando de estágio em estágio. Antes eu só avisava quando o estágio
   mudava (a cada 25%) — o jogador via a planta congelada e depois um salto.
   Agora mando o progresso contínuo, mas com duas economias pra não
   inundar a rede: só avisa se mudou o bastante pra ser visível, e sempre
   avisa na hora que muda de estágio. */
setInterval(() => {
  const dt = GROW_MS / 1000;
  relogio = (relogio + dt * (1440 / DAYLEN)) % 1440;
  for (const lote of lotes) {
    for (let i = 0; i < lote.plots.length; i++) {
      const pl = lote.plots[i];
      if (!pl) continue;
      const progAntes = pl.prog;
      const aguaAntes = pl.agua;
      const mudouEstagio = crescer(pl, dt, relogio);
      const mudouProg = Math.abs(pl.prog - (pl._ultProg ?? -99)) >= 0.7;
      const mudouAgua = Math.abs(pl.agua - (pl._ultAgua ?? -99)) >= 0.05;
      if (mudouEstagio || mudouProg || mudouAgua) {
        pl._ultProg = pl.prog;
        pl._ultAgua = pl.agua;
        paraTodos({ t: 'lote_update', loteIndex: lote.index, plotIndex: i, plot: pl });
      }
    }
  }
}, GROW_MS);

/* ───────── heartbeat: mata conexão zumbi ───────── */
setInterval(() => {
  const t = agora();
  for (const [id, j] of jogadores) {
    if (t - j.ultimoPong > HEARTBEAT_MS + HEARTBEAT_TIMEOUT) {
      try { j.ws.terminate(); } catch (e) {}
      jogadores.delete(id);
      paraTodos({ t: 'leave', id });
      continue;
    }
    if (j.ws.readyState === 1) {
      try { j.ws.ping(); } catch (e) {}
      enviar(j, { t: 'ping', ts: t });   // navegador não responde ping de protocolo
    }
  }
}, HEARTBEAT_MS);

/* ───────── desligamento limpo ───────── */
function desligar() {
  console.log('desligando: avisando os clientes...');
  for (const [, j] of jogadores) {
    try { j.ws.close(1001, 'servidor reiniciando'); } catch (e) {}
  }
  wss.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', desligar);
process.on('SIGINT', desligar);
process.on('uncaughtException', e => {
  console.error('erro não tratado (servidor continua):', e && e.message);
});

server.listen(PORT, () => {
  console.log(`Quintal 3D — servidor autoritativo na porta ${PORT} · tick ${TICK_HZ}Hz · AOI ${AOI_RAIO}m`);
});
