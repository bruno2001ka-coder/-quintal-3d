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
// ETAPA D — cada propriedade tem os MESMOS ambientes do quintal original:
// 6 canteiros no sol, 4 na estufa de lona e 6 no grow room de alvenaria.
const PLOTS_POR_LOTE    = 16;
const TIPO_PLOT = [
  'sol','sol','sol','sol','sol','sol',
  'estufa','estufa','estufa','estufa',
  'grow','grow','grow','grow','grow','grow'
];
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
    id: null,        // ETAPA C: preenchido logo abaixo, quando o registro existir
    portaoId: null,  // ETAPA C: portão vira entidade de verdade
    portaoAberto: false,
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
  // ETAPA C: dono propaga pras entidades do lote
  const el = entidades.get(livre.id); if (el) el.dono = chave;
  const ep = entidades.get(livre.portaoId); if (ep) ep.dono = chave;
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

function crescer(pl, dt, clockMin, tipo, up) {
  if (!pl || pl.estagio >= 4) return false;
  const s = pl.s;
  const antes = pl.estagio;
  // ETAPA D — o ambiente decide a luz, igual o cliente sempre fez:
  // grow room e estufa têm luz artificial; o sol depende da hora.
  const indoor = tipo === 'grow' || tipo === 'estufa';
  const luzBase = indoor ? ((up && up.led) ? 1.35 : 1.05) : luzEm(clockMin);
  const luz = s.auto ? Math.max(.82, luzBase) : luzBase;
  // irrigação e rega automática, se o jogador comprou a melhoria
  if (up) {
    if (tipo === 'grow' && up.irrig && pl.agua < .5) pl.agua = Math.min(1, pl.agua + dt * .4);
    if (tipo === 'estufa' && up.auto && pl.agua < .45) pl.agua = Math.min(1, pl.agua + dt * .35);
  }
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

/* ═════════ ETAPA C — REGISTRO DE ENTIDADES ═════════
   Até aqui as coisas do mundo eram identificadas por POSIÇÃO: a planta era
   "o canteiro 3 do lote 5". Isso funciona enquanto nada se move e enquanto
   só existe um tipo de coisa. Não escala, e não permite validar dono de
   forma uniforme.

   Agora cada entidade relevante recebe um ID único gerado AQUI. O cliente
   nunca escolhe um ID — ele recebe e representa. Antes de qualquer ação, o
   servidor confere quem é o dono.

   Compatibilidade: as mensagens antigas (plot: N) continuam aceitas. O ID
   é o caminho novo, o índice é o caminho antigo. Os dois convivem até a
   migração terminar. */

const entidades = new Map();   // id -> { id, tipo, dono, ref }
const seqEntidade = { pl: 0, lt: 0, pt: 0 };

function novoId(tipo) {
  if (!(tipo in seqEntidade)) seqEntidade[tipo] = 0;
  return tipo + '_' + (++seqEntidade[tipo]);
}
function registrar(tipo, dono, ref) {
  const id = novoId(tipo);
  const ent = { id, tipo, dono: dono || null, ref, criadaEm: agora() };
  entidades.set(id, ent);
  return ent;
}
function remover(id) { entidades.delete(id); }

/* ETAPA C — cada lote e cada portão recebem ID de entidade. Precisa rodar
   AQUI, depois do registro existir: tentei antes e o servidor nem subiu. */
lotes.forEach(l => {
  l.id = registrar('lt', null, l).id;
  l.portaoId = registrar('pt', null, l).id;
});

/* Validação central de propriedade. Toda ação sobre entidade passa por
   aqui. Retorna a entidade, ou null com o motivo já enviado ao jogador. */
function entidadeDoJogador(j, id, tipo) {
  const ent = entidades.get(String(id || '').slice(0, 24));
  if (!ent) {
    enviar(j, { t: 'recusado', motivo: 'entidade não existe' });
    metricas.rejeitadas++; return null;
  }
  if (tipo && ent.tipo !== tipo) {
    enviar(j, { t: 'recusado', motivo: 'tipo de entidade errado' });
    metricas.rejeitadas++; return null;
  }
  const chave = j.chave || j.id;
  if (ent.dono && ent.dono !== chave) {
    enviar(j, { t: 'recusado', motivo: 'isso não é seu' });
    metricas.rejeitadas++; return null;
  }
  return ent;
}

/* ═════════ ETAPA B — CARTEIRA: dinheiro, sementes e estoque ═════════
   O servidor passa a ser a autoridade destes três estados. O cliente vira
   um espelho: recebe 'estado' e desenha. Nunca decide.

   Escopo acordado: o cronômetro visual da secagem continua no cliente,
   MAS o estágio oficial é daqui. O cliente pede a mudança e o servidor
   confere o tempo mínimo — assim ninguém fabrica produto vendável. */

const CASH_INICIAL = 350;
const TEMPO_SEC  = 55;   // segundos mínimos de secagem
const TEMPO_CURA = 70;   // segundos mínimos de cura
// Travas da colheita local (canteiros ainda não simulados aqui)
const MAX_CANTEIROS_LOCAIS = 14;   // estufa 4 + grow 6 + sol extra 4
const LOCAL_COLHEITA_MS    = 30000;
const JANELA_LOCAL_MS      = 300000;

// catálogos: os preços vivem AQUI. Antes o cliente calculava e mandava.
const CAT_UPG = { vasos:520, led:680, irrig:900, rack:340, auto:980 };
const CAT_ADUBO = { organico:60, crescimento:110, floracao:180 };
const CAT_ARMA = { punho:0, pistola:450, smg:1500, rifle:3600 };
const CUSTO_COLETE = 520;
const CUSTO_CRUZAR = 120;
const TRAIT_KEYS = ['ritmo','rendimento','resistencia','aroma','brilho'];

function precoSemente(s) {
  const soma = TRAIT_KEYS.reduce((a, k) => a + (s.t[k] || 0), 0);
  const mult = RAR_MULT[s.rar] || 1;
  return Math.round((8 + soma * .16 + s.gen * 9) * mult);
}
function traitAvg(s) {
  return TRAIT_KEYS.reduce((a, k) => a + (s.t[k] || 0), 0) / TRAIT_KEYS.length;
}

let proxLoteId = 1;

// Carteiras vivem por CHAVE PERSISTENTE, não por conexão. Se ficassem
// presas ao socket, recarregar a página zeraria tudo — e o jogador ainda
// poderia "recuperar" saldo antigo do cliente, que é justamente o que a
// Etapa B tem que impedir.
const carteiras = new Map();   // chave -> carteira

function carteiraDe(j) {
  const k = j.chave || j.id;
  if (!carteiras.has(k)) {
    carteiras.set(k, { cash: CASH_INICIAL, bank: [], estoque: [], rackMax: 6, up: {}, armas: {}, fert: {} });
  }
  return carteiras.get(k);
}
function enviarEstado(j) {
  const c = carteiraDe(j);
  enviar(j, {
    t: 'estado',
    cash: Math.floor(c.cash),
    bank: c.bank.map(e => ({ s: e.s, qtd: e.qtd })),
    estoque: c.estoque.map(l => ({
      id: l.id, s: l.s, qtd: l.qtd, estagio: l.estagio,
      qual: +l.qual.toFixed(3), desde: l.desde
    })),
    rackMax: c.rackMax,
    up: c.up, armas: c.armas
  });
}
function bankAdd(c, s, n) {
  const e = c.bank.find(x => x.s.id === s.id);
  if (e) e.qtd += n; else c.bank.push({ s, qtd: n });
}
function bankTirar(c, id, n) {
  const i = c.bank.findIndex(x => x.s.id === id);
  if (i < 0 || c.bank[i].qtd < n) return false;
  c.bank[i].qtd -= n;
  if (c.bank[i].qtd <= 0) c.bank.splice(i, 1);
  return true;
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
/* CORREÇÃO — o servidor não conhecia as casas. O bot andava em linha reta
   e atravessava muro, estufa e grow room, porque o cliente só desenha onde
   o servidor mandou. Agora as propriedades existem aqui também.
   Estes números vêm do cliente (LOTE_SPOTS, LOTE_W, LOTE_D) — se mudarem
   lá, precisam mudar aqui. */
const LOTE_W = 20, LOTE_D = 16;
const LOTE_SPOTS = [
  [-34,31],[2,31],[38,31],[-34,63],[2,63],
  [38,63],[-34,95],[2,95],[38,95],[-34,127]
];
// margem: o bot é empurrado pra fora da propriedade inteira, não só do muro
function dentroDePropriedade(x, z) {
  for (let i = 0; i < LOTE_SPOTS.length; i++) {
    const [lx, lz] = LOTE_SPOTS[i];
    if (x > lx - LOTE_W/2 - .6 && x < lx + LOTE_W/2 + .6 &&
        z > lz - LOTE_D/2 - .6 && z < lz + LOTE_D/2 + .6) return i;
  }
  return -1;
}
// empurra pro ponto mais próximo FORA da propriedade
function empurrarPraFora(x, z, i) {
  const [lx, lz] = LOTE_SPOTS[i];
  const dEsq = Math.abs(x - (lx - LOTE_W/2 - .7));
  const dDir = Math.abs(x - (lx + LOTE_W/2 + .7));
  const dCim = Math.abs(z - (lz - LOTE_D/2 - .7));
  const dBai = Math.abs(z - (lz + LOTE_D/2 + .7));
  const min = Math.min(dEsq, dDir, dCim, dBai);
  if (min === dEsq) return { x: lx - LOTE_W/2 - .7, z };
  if (min === dDir) return { x: lx + LOTE_W/2 + .7, z };
  if (min === dCim) return { x, z: lz - LOTE_D/2 - .7 };
  return { x, z: lz + LOTE_D/2 + .7 };
}

const bots = [];
let proxBot = 1;
const BOT_VEL = 2.2, BOT_VIDA = 60;
/* CORREÇÃO — antes o bot enxergava a 16m e perseguia PARA SEMPRE: não
   existia raio de desistência. Dava pra atravessar o mapa inteiro com uma
   fila atrás. Agora ele vê perto, desiste quando você se afasta, e volta
   pro próprio território. */
const BOT_AGRO = 11;        // raio pra começar a perseguir
const BOT_DESISTE = 24;     // se passar disso, larga
const BOT_MAX_LONGE = 30;   // nunca se afasta mais que isso da própria casa

function nascerBots() {
  bots.length = 0;
  TERRITORIOS.forEach((t, ti) => {
    // eram 2 a 4 por ponto = 29 bots no mapa. Demais: viravam fila.
    const n = 1 + (ti % 2);          // 1 a 2 rivais por ponto
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      let bx = t.x + Math.cos(a) * 4, bz = t.z + Math.sin(a) * 4;
      // não deixa nascer dentro da propriedade de alguém
      const li = dentroDePropriedade(bx, bz);
      if (li >= 0) { const f = empurrarPraFora(bx, bz, li); bx = f.x; bz = f.z; }
      bots.push({
        id: 'b' + (proxBot++), tipo: 'rival', terr: ti,
        casaX: bx, casaZ: bz,
        x: bx, z: bz,
        ry: 0, hp: BOT_VIDA, alvo: null, vagarT: 0, vagarX: 0, vagarZ: 0
      });
    }
  });
}
nascerBots();

function passoBot(b, dt) {
  // procura o jogador mais perto dentro do raio de agressão
  // Se já está perseguindo, o raio é maior (só larga em BOT_DESISTE).
  // Se não está, precisa chegar perto (BOT_AGRO) pra começar.
  const raio = b.alvo ? BOT_DESISTE : BOT_AGRO;
  let maisPerto = null, melhor = raio;
  for (const [, j] of jogadores) {
    const d = Math.hypot(j.x - b.x, j.z - b.z);
    if (d < melhor) { melhor = d; maisPerto = j; }
  }
  // não se afasta demais do próprio território, mesmo perseguindo
  if (maisPerto) {
    const dCasa = Math.hypot(b.x - b.casaX, b.z - b.casaZ);
    if (dCasa > BOT_MAX_LONGE) maisPerto = null;
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
    // sub-passos: sem isso um passo grande pula por cima da propriedade
    const passoTotal = BOT_VEL * dt;
    const n = Math.max(1, Math.ceil(passoTotal / .4));
    for (let k = 0; k < n; k++) {
      const nx = b.x + dx / d * (passoTotal / n);
      const nz = b.z + dz / d * (passoTotal / n);
      const li = dentroDePropriedade(nx, nz);
      if (li >= 0) {
        // bateu numa casa: escorrega pela borda em vez de atravessar
        const fora = empurrarPraFora(nx, nz, li);
        b.x = fora.x; b.z = fora.z;
        break;
      }
      b.x = nx; b.z = nz;
    }
    b.ry = Math.atan2(dx, dz);
  }
  // trava na fronteira da cidade
  if (b.z < 12) b.z = 12;
  // rede de segurança: se de algum jeito ficou dentro, sai
  const dentro = dentroDePropriedade(b.x, b.z);
  if (dentro >= 0) {
    const fora = empurrarPraFora(b.x, b.z, dentro);
    b.x = fora.x; b.z = fora.z;
  }
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
  return { index: l.index, id: l.id, portaoId: l.portaoId,
    donoNome: l.donoNome, portaoAberto: l.portaoAberto,
    tipos: TIPO_PLOT, plots: l.plots };
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
        // ETAPA B: entrega a carteira autoritativa assim que o jogador entra
        {
          const c = carteiraDe(j);
          if (!c._iniciado) {
            c._iniciado = true;
            const semBase = limparStrain(m.sementeBase);
            if (semBase) bankAdd(c, semBase, 2);
          }
          enviarEstado(j);
        }
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
        /* BUG GRAVE CORRIGIDO — o jogador nascia em (0,0) aqui, mas o
           cliente o coloca na propriedade dele (ex: -34,31). A primeira
           mensagem de posição parecia um teleporte de 30m e era recusada.
           Como a recusa não movia nada, TODA mensagem seguinte também era
           recusada: o servidor achava que o jogador estava eternamente em
           (0,0). Isso quebrava perseguição de bot, AOI e tudo que depende
           de posição — e explicava as centenas de "rejeitadas" no /metrics.

           Agora a PRIMEIRA posição é sempre aceita (é o nascimento, não há
           o que validar), e depois disso a checagem de velocidade vale. */
        if (!j.posIniciada) {
          j.posIniciada = true;
          j.x = nx; j.y = ny; j.z = nz;
        } else {
          const dtMov = Math.max(.001, (t - j.ultimoMov) / 1000);
          const dist = Math.hypot(nx - j.x, nz - j.z);
          const limite = VEL_MAX * dtMov + 2;   // folga pra lag
          if (dist > limite) {
            metricas.rejeitadas++;
            enviar(j, { t: 'correcao', x: j.x, y: j.y, z: j.z });
          } else {
            j.x = nx; j.y = ny; j.z = nz;
          }
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
        // ETAPA C: a planta vira entidade com ID e dono
        const novaPl = { s, prog: 0, agua: 1, saude: 1, praga: 0, estagio: 0 };
        const entPl = registrar('pl', j.chave || j.id, novaPl);
        novaPl.id = entPl.id;
        novaPl.loteIndex = lote.index;
        novaPl.plotIndex = pi;
        lote.plots[pi] = novaPl;
        const ev = { t: 'lote_update', loteIndex: lote.index, plotIndex: pi, plot: lote.plots[pi] };
        paraTodos(ev); enviar(j, ev);
        break;
      }

      case 'regar': {
        // ETAPA C — caminho novo: id de entidade, com dono validado.
        if (m.id) {
          const ent = entidadeDoJogador(j, m.id, 'pl');
          if (!ent) return;
          const p2 = ent.ref;
          p2.agua = 1; p2.praga = 0;
          const ev2 = { t: 'lote_update', loteIndex: p2.loteIndex, plotIndex: p2.plotIndex, plot: p2 };
          paraTodos(ev2); enviar(j, ev2);
          return;
        }
        // caminho antigo (índice) — mantido pra compatibilidade
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

      /* ═════ ETAPA B — dinheiro, sementes e estoque ═════ */
      case 'comprar': {
        const c = carteiraDe(j);
        const oq = str(m.oq, 16);
        let custo = 0, aplicar = null;

        if (oq === 'semente') {
          const sem = limparStrain(m.strain);
          if (!sem) { metricas.rejeitadas++; return; }
          custo = precoSemente(sem);
          // o fenótipo é sorteado AQUI: o cliente não escolhe a raridade
          const r = Math.random();
          const rar = r < .06 ? 'hibrida' : r < .20 ? 'laranja' : r < .38 ? 'roxa' : 'comum';
          const filho = Object.assign({}, sem, { id: Date.now() % 1e9 + Math.floor(Math.random()*999), rar });
          aplicar = () => bankAdd(c, filho, 1);
        } else if (oq === 'upg') {
          const k = str(m.k, 12);
          if (!(k in CAT_UPG) || c.up[k]) { metricas.rejeitadas++; return; }
          custo = CAT_UPG[k];
          aplicar = () => { c.up[k] = true; if (k === 'rack') c.rackMax = 10; };
        } else if (oq === 'adubo') {
          const k = str(m.k, 12);
          if (!(k in CAT_ADUBO)) { metricas.rejeitadas++; return; }
          custo = CAT_ADUBO[k];
          aplicar = () => { c.fert = c.fert || {}; c.fert[k] = (c.fert[k] || 0) + 1; };
        } else if (oq === 'arma') {
          const k = str(m.k, 12);
          if (!(k in CAT_ARMA) || c.armas[k]) { metricas.rejeitadas++; return; }
          custo = CAT_ARMA[k];
          aplicar = () => { c.armas[k] = true; };
        } else if (oq === 'colete') {
          custo = CUSTO_COLETE;
          aplicar = () => {};
        } else { metricas.rejeitadas++; return; }

        if (c.cash < custo) { enviar(j, { t: 'recusado', motivo: 'sem dinheiro' }); return; }
        c.cash -= custo;
        aplicar();
        enviarEstado(j);
        break;
      }

      case 'cruzar': {
        const c = carteiraDe(j);
        const idA = num(m.a, 0, 1e9, -1), idB = num(m.b, 0, 1e9, -1);
        if (idA < 0 || idB < 0) { metricas.rejeitadas++; return; }
        const ea = c.bank.find(x => x.s.id === idA), eb = c.bank.find(x => x.s.id === idB);
        if (!ea || !eb) { enviar(j, { t: 'recusado', motivo: 'sem essas sementes' }); return; }
        if (c.cash < CUSTO_CRUZAR) { enviar(j, { t: 'recusado', motivo: 'sem dinheiro' }); return; }
        const filho = limparStrain(m.filho);
        if (!filho) { metricas.rejeitadas++; return; }
        c.cash -= CUSTO_CRUZAR;
        bankAdd(c, filho, 2);
        enviarEstado(j);
        break;
      }

      case 'colher_local': {
        /* Colheita de canteiro LOCAL (estufa, grow room, fazenda). Esses
           canteiros ainda não são simulados aqui, então o servidor não pode
           provar que a planta existiu. O que ele PODE fazer, e agora faz:

           1. RECALCULAR a quantidade pela fórmula do jogo. O 'qtd' do
              cliente é ignorado por completo — ele só informa a genética.
           2. Limitar ao número real de canteiros locais que existem (14).
           3. Exigir intervalo mínimo entre colheitas, porque nem a genética
              mais rápida do jogo amadurece em rajada.

           Isso não torna a operação provável, mas tira o "estoque infinito":
           o máximo que se consegue é o que 14 canteiros legítimos dariam. */
        const c = carteiraDe(j);
        const st = limparStrain(m.strain);
        if (!st) { metricas.rejeitadas++; return; }

        // TRAVA 3 — ritmo. O ciclo mais curto do jogo (auto, ritmo 100) leva
        // ~43s. Uso 30s de folga pra não punir jogador legítimo com lag.
        const ultima = c._ultColheitaLocal || 0;
        if (agora() - ultima < LOCAL_COLHEITA_MS) {
          enviar(j, { t: 'recusado', motivo: 'colheita rápida demais' });
          metricas.rejeitadas++; return;
        }

        // TRAVA 2 — não existem mais canteiros locais do que isso no mapa
        c._colheitasLocais = (c._colheitasLocais || 0) + 1;
        if (c._colheitasLocais > MAX_CANTEIROS_LOCAIS && !c._janelaLocal) {
          c._janelaLocal = agora();
        }
        if (c._janelaLocal && agora() - c._janelaLocal < JANELA_LOCAL_MS
            && c._colheitasLocais > MAX_CANTEIROS_LOCAIS) {
          enviar(j, { t: 'recusado', motivo: 'colheitas demais em pouco tempo' });
          metricas.rejeitadas++; return;
        }
        if (c._janelaLocal && agora() - c._janelaLocal >= JANELA_LOCAL_MS) {
          c._janelaLocal = null; c._colheitasLocais = 1;
        }

        if (c.estoque.length >= c.rackMax) {
          enviar(j, { t: 'recusado', motivo: 'bancada cheia' }); return;
        }

        // TRAVA 1 — a quantidade é DAQUI. Mesma fórmula do jogo, com a
        // saúde limitada a 1.0 e o booster no máximo.
        const saude = num(m.saude, 0, 1, 1);
        const autoPen = st.auto ? .72 : 1;
        const qtd = Math.max(2, Math.round(
          (1.3 + st.t.rendimento / 100 * 2.6) * saude * 7 * autoPen * 1.35));
        const qual = Math.min(1, .55 + saude * .45);

        c._ultColheitaLocal = agora();
        c.estoque.push({ id: proxLoteId++, s: st, qtd, estagio: 'sec',
          qual, desde: agora() });
        enviarEstado(j);
        break;
      }

      case 'estoque_add': {
        // Só entra estoque quando o SERVIDOR colheu. Ver caso 'colher':
        // ele chama isto internamente. Pedido direto do cliente é recusado.
        metricas.rejeitadas++;
        return;
      }

      case 'lote_estagio': {
        // O cronômetro visual é do cliente, mas o estágio OFICIAL é daqui.
        // Confere o tempo mínimo real antes de aceitar o avanço.
        const c = carteiraDe(j);
        const id = num(m.id, 0, 1e9, -1);
        const lote = c.estoque.find(l => l.id === id);
        if (!lote) { metricas.rejeitadas++; return; }
        const decorrido = (agora() - lote.desde) / 1000;
        if (lote.estagio === 'sec') {
          if (decorrido < TEMPO_SEC * .85) { metricas.rejeitadas++; return; }
          lote.estagio = 'cura'; lote.desde = agora();
        } else if (lote.estagio === 'cura') {
          if (decorrido < TEMPO_CURA * .85) { metricas.rejeitadas++; return; }
          lote.estagio = 'pronto'; lote.desde = agora();
          lote.qual = Math.min(1.35, lote.qual * 1.28);
        } else { return; }
        enviarEstado(j);
        break;
      }

      case 'vender': {
        const c = carteiraDe(j);
        const id = num(m.id, 0, 1e9, -1);
        const lote = c.estoque.find(l => l.id === id);
        if (!lote) { enviar(j, { t: 'recusado', motivo: 'lote não existe' }); return; }
        // TRAVA CENTRAL: só vende o que o SERVIDOR reconhece como pronto
        if (lote.estagio !== 'pronto') {
          enviar(j, { t: 'recusado', motivo: 'lote ainda não está pronto' });
          metricas.rejeitadas++; return;
        }
        const q = Math.min(num(m.qtd, 1, 999, 1) | 0, lote.qtd);
        if (q <= 0) { metricas.rejeitadas++; return; }
        const rm = RAR_MULT[lote.s.rar] || 1;
        const dem = num(m.demanda, .5, 2.5, 1);
        const base = str(m.onde, 8) === 'ponto'
          ? (22 + traitAvg(lote.s) * .55 + lote.s.gen * 6)
          : (16 + traitAvg(lote.s) * .42 + lote.s.gen * 4);
        const valor = Math.round(base * q * lote.qual * rm * dem);
        lote.qtd -= q;
        if (lote.qtd <= 0) c.estoque.splice(c.estoque.indexOf(lote), 1);
        c.cash += valor;
        enviar(j, { t: 'venda_ok', valor, qtd: q });
        enviarEstado(j);
        break;
      }

      case 'portao': {
        /* ETAPA C — o portão era 100% do cliente: abrir não aparecia pra
           mais ninguém. Agora é entidade com dono e estado no servidor. */
        const ent = entidadeDoJogador(j, m.id, 'pt');
        if (!ent) return;
        const lote = ent.ref;
        lote.portaoAberto = !lote.portaoAberto;
        paraTodos({ t: 'portao_estado', id: ent.id, loteIndex: lote.index,
          aberto: lote.portaoAberto });
        enviar(j, { t: 'portao_estado', id: ent.id, loteIndex: lote.index,
          aberto: lote.portaoAberto });
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
        // ETAPA C — caminho novo por id de entidade
        if (m.id) {
          const ent = entidadeDoJogador(j, m.id, 'pl');
          if (!ent) return;
          const p2 = ent.ref;
          if (p2.estagio !== 4) {
            enviar(j, { t: 'recusado', motivo: 'planta não está pronta' }); return;
          }
          const c2 = carteiraDe(j);
          if (c2.estoque.length >= c2.rackMax) {
            enviar(j, { t: 'recusado', motivo: 'bancada cheia' }); return;
          }
          const ap = p2.s.auto ? .72 : 1;
          const rm2 = RAR_MULT[p2.s.rar] || 1;
          const q2 = Math.max(2, Math.round(
            (1.3 + p2.s.t.rendimento / 100 * 2.6) * p2.saude * 7 * ap * rm2));
          lotes[p2.loteIndex].plots[p2.plotIndex] = null;
          remover(p2.id);
          const ev2 = { t: 'lote_update', loteIndex: p2.loteIndex, plotIndex: p2.plotIndex, plot: null };
          paraTodos(ev2); enviar(j, ev2);
          c2.estoque.push({ id: proxLoteId++, s: p2.s, qtd: q2, estagio: 'sec',
            qual: .55 + p2.saude * .45, desde: agora() });
          enviar(j, { t: 'colheita', plotIndex: p2.plotIndex, qtd: q2, strain: p2.s });
          enviarEstado(j);
          return;
        }
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
      const dono = lote.donoChave ? carteiras.get(lote.donoChave) : null;
      const mudouEstagio = crescer(pl, dt, relogio, TIPO_PLOT[i], dono ? dono.up : null);
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
