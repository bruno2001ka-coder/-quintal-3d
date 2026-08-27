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

      PERSISTÊNCIA: carteira, lotes e última posição são gravados quando um
   banco está configurado. No plano grátis do Render, SQLite local continua
   efêmero; DATABASE_URL deve apontar para Postgres para evitar reset após
   restart ou spin-down. Sem banco, o modo memória é explicitamente volátil.
   ═══════════════════════════════════════════════════════════════════════ */

const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ───────── configuração ───────── */
const PORT              = Number(process.env.PORT) || 8080;
const TICK_HZ           = 20;                    // ticks por segundo
const TICK_MS           = 1000 / TICK_HZ;
const AOI_RAIO          = 70;                    // metros: só vê quem está perto
const HEARTBEAT_MS      = 30000;                 // ping a cada 30s
const HEARTBEAT_TIMEOUT = 10000;                 // 10s pra responder
const MAX_PAYLOAD       = 4 * 1024;              // 4KB por mensagem
const MAX_CONEXOES      = 64;
const WS_BUFFER_LIMITE  = 256 * 1024;              // não acumula mais que 256KB por cliente
const GRADE_CELULA      = AOI_RAIO;                // índice espacial simples para snapshots
const SESSION_SECRET_PATH = process.env.AUTH_SECRET_PATH || path.join(process.cwd(), '.quintal-session-secret');
function carregarAuthSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  try {
    if (fs.existsSync(SESSION_SECRET_PATH)) return fs.readFileSync(SESSION_SECRET_PATH, 'utf8').trim();
    const novo = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SESSION_SECRET_PATH, novo + '\n', { mode: 0o600, flag: 'wx' });
    console.warn('AUTH_SECRET não definido; usando segredo local persistido em ' + SESSION_SECRET_PATH);
    return novo;
  } catch (e) {
    console.error('não foi possível persistir o segredo de sessão:', e.message);
    return crypto.randomBytes(32).toString('hex');
  }
}
const AUTH_SECRET       = carregarAuthSecret();
const AUTH_TTL_MS       = 1000 * 60 * 60 * 24 * 30;
const AUTH_USER_MAX     = 24;
const AUTH_PASS_MAX     = 128;
const AUTH_PASS_MIN     = 8;
const ALLOW_ANONYMOUS   = process.env.ALLOW_ANONYMOUS === '1';
const RATE_BURST        = 60;                    // balde de tokens
const RATE_RECARGA      = 40;                    // tokens por segundo
const VEL_MAX           = 14;                    // m/s — corrida é ~6, folga pra lag
const RETOMADA_POS_MS    = 15000;                 // reconexão curta retoma o último ponto
const NUM_LOTES         = 10;
// ETAPA D — cada propriedade tem os MESMOS ambientes do quintal original:
// 6 canteiros no sol, 4 na estufa de lona e 6 no grow room de alvenaria.
const PLOTS_POR_LOTE    = 16;
const TIPO_PLOT = [
  'sol','sol','sol','sol','sol','sol',
  'estufa','estufa','estufa','estufa',
  'grow','grow','grow','grow','grow','grow'
];
// Fazenda multiplayer: cada conta pode ter um setor persistente com 12
// canteiros. O limite de seis é da fazenda, não do servidor inteiro.
const FARM_MAX_PLAYERS = 6;
const FARM_PLOTS_PER_PLAYER = 12;
const FARM_LOT_PRICES = Object.freeze([26000, 28000, 30000, 32000, 34000, 36000]);
const FARM_SLOT_SPOTS = [
  [-30,194],[0,194],[30,194],[-30,230],[0,230],[30,230]
];
const FARM_PLOT_OFFSETS = [
  [-7,-10],[-2.3,-10],[2.4,-10],
  [-7,-4],[-2.3,-4],[2.4,-4],
  [-7,2],[-2.3,2],[2.4,2],
  [-7,8],[-2.3,8],[2.4,8]
];
const FARM_BARN = Object.freeze({ x:0, z:252, w:26, d:12, doorW:3.2 });
const FARM_GATE_W = 10;
const FARM_TABLE_SPOTS = [
  [-8,-2],[0,-2],[8,-2],[-8,2],[0,2],[8,2]
];
const FARM_AREA = Object.freeze({ x0:-46, x1:46, z0:172, z1:268 });
const DAYLEN            = 600;                   // seg reais = 1 dia de jogo (igual o cliente)
const GROW_MS           = 1000;                  // recalcula plantas a cada 1s
// Crescimento agrícola: a água deve exigir atenção, não congelar a colheita.
// O valor anterior esvaziava o reservatório em cerca de 50s e travava prog.
const PLANTA_DRENO_AGUA = 0.0045;
const PLANTA_AGUA_SECA = 0.35;                    // cresce devagar mesmo sem rega
const PLANTA_CRESCIMENTO_MULT = 1.35;            // ciclo jogável sem esperar horas
/* ───────── util ───────── */
const num = (v, min, max, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const FARM_STAGE_TIMES = Object.freeze({
  secagem: num(process.env.FARM_SEC_S, .1, 3600, 55),
  cura: num(process.env.FARM_CURA_S, .1, 3600, 70),
  embalagem: num(process.env.FARM_EMBALAGEM_S, .1, 3600, 35)
});
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const CLIENTE_FIRST_S   = num(process.env.CLIENTE_FIRST_S, 1, 60, 5);
const CLIENTE_MIN_S     = num(process.env.CLIENTE_MIN_S, 1, 120, 12);
const CLIENTE_MAX_S     = num(process.env.CLIENTE_MAX_S, CLIENTE_MIN_S, 180, 24);
const nomeSeguro = v => str(v, 18).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Jogador';
const agora = () => Date.now();
const b64url = v => Buffer.from(v).toString('base64url');
function emitirToken(sub) {
  const payload = b64url(JSON.stringify({ sub, exp: agora() + AUTH_TTL_MS }));
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function validarToken(token) {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const esperado = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!p.sub || typeof p.sub !== 'string' || p.sub.length > 80 || p.exp < agora()) return null;
    return p.sub;
  } catch (_) { return null; }
}
function novaIdentidade() {
  return 'u_' + crypto.randomUUID();
}

/* ───────── mundo ───────── */
const lotes = [];
for (let i = 0; i < NUM_LOTES; i++) {
  lotes.push({
    index: i, donoChave: null, donoNome: null,
    // BUG CORRIGIDO: o lote não guardava as próprias coordenadas. O cálculo
    // de colisão usava l.x/l.z e recebia undefined, então TODOS os colisores
    // das casas viravam NaN e não bloqueavam nada. Preenchido no boot.
    x: 0, z: 0,
    id: null,        // ETAPA C: preenchido logo abaixo, quando o registro existir
    portaoId: null,  // ETAPA C: portão vira entidade de verdade
    portaoAberto: false,
    plots: Array.from({ length: PLOTS_POR_LOTE }, () => null)
  });
}
const loteDe = new Map();   // chave persistente -> índice do lote

// Setores privados da fazenda. O slot continua reservado após desconexão:
// reconectar recupera os mesmos 12 canteiros e nunca recebe o setor de outro.
const farmSlots = FARM_SLOT_SPOTS.map(([x, z], slotIndex) => ({
  slotIndex, ownerKey: null, ownerName: null, unlockedAt: 0, updatedAt: 0,
  portaoId: null, portaoAberto: false,
  x, z,
  plots: Array.from({ length: FARM_PLOTS_PER_PLAYER }, (_, localIndex) => ({
    id: `farm_${slotIndex}_${localIndex}`, ownerKey: null, slotIndex, localIndex,
    x: x + FARM_PLOT_OFFSETS[localIndex][0],
    z: z + FARM_PLOT_OFFSETS[localIndex][1],
    plant: null
  }))
}));
const farmSlotDe = new Map();
const farmTables = FARM_TABLE_SPOTS.map(([x, z], stationId) => ({
  stationId, farmSlotIndex: stationId, x: FARM_BARN.x + x, z: FARM_BARN.z + z,
  job: null, queue: []
}));

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
  pl.agua = Math.max(0, pl.agua - dt * PLANTA_DRENO_AGUA * (.6 + (100 - s.t.resistencia) / 100 * .9) * sede);
  if (Math.random() < dt * .0022 * (1.6 - s.t.resistencia / 100) && pl.estagio > 0 && !pl.praga) pl.praga = 1;
  if (pl.praga) pl.saude = Math.max(.12, pl.saude - dt * .03);
  else if (pl.agua < .12) pl.saude = Math.max(.12, pl.saude - dt * .05 * (1.4 - s.t.resistencia / 100));
  else if (pl.agua > .35) pl.saude = Math.min(1, pl.saude + dt * .013);
  const aguaF = PLANTA_AGUA_SECA + Math.min(1 - PLANTA_AGUA_SECA, Math.max(0, pl.agua) * 1.7);
  const ciclo = (s.auto ? 86 : 150) - s.t.ritmo * (s.auto ? .45 : .95);
  const taxa = (100 / ciclo) * PLANTA_CRESCIMENTO_MULT * luz * aguaF * (.55 + pl.saude * .45) * (pl.praga ? .45 : 1);
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
const CATALOGO_SEMENTES = [
  ['Northern Lights',0x5f9c46,66,58,88,52,48,false],
  ['White Widow',0xc9d8bc,58,62,74,60,92,false],
  ['Skunk #1',0x6fae44,70,70,80,78,40,false],
  ['Hindu Kush',0x4f7a3c,62,54,90,56,44,false],
  ['Amnesia Haze',0x86c65a,30,76,46,82,58,false],
  ['Sour Diesel',0x7fbf6a,44,66,56,90,50,false],
  ['Blue Dream',0x7fa8c4,52,84,62,70,66,false],
  ['OG Kush',0x5e8f42,46,60,58,86,62,false],
  ['Purple Haze',0x9a7ec4,34,58,52,76,94,false],
  ['Jack Herer',0x8fc257,56,68,66,74,70,false],
  ['Critical',0x6aa84f,78,88,60,54,46,false],
  ['Gorilla Glue',0x4a7c38,48,80,70,80,84,false],
  ['LSD 25 Auto',0x8f7fc4,88,62,78,72,80,true],
  ['Auto 69',0xa8c452,94,69,70,58,54,true],
  ['Critical Auto',0x74b04c,90,74,66,52,44,true],
  ['Northern Auto',0x63a05a,86,60,86,50,50,true]
].map((x, i) => ({ id:i + 1, nome:x[0], cor:x[1], gen:0, auto:x[7], rar:'comum',
  t:{ritmo:x[2], rendimento:x[3], resistencia:x[4], aroma:x[5], brilho:x[6]} }));
const CATALOGO_SEMENTES_MAP = new Map(CATALOGO_SEMENTES.map(s => [s.nome, s]));
function sementeCatalogada(raw) {
  const s = limparStrain(raw);
  const base = s && CATALOGO_SEMENTES_MAP.get(s.nome);
  if (!base || s.gen !== 0 || s.auto !== base.auto || s.cor !== base.cor) return null;
  for (const k of TRAIT_KEYS) if (s.t[k] !== base.t[k]) return null;
  return { ...base, t: { ...base.t } };
}

/* ═════════ PERSISTÊNCIA ═════════
   O estado vivia só na memória e sumia a cada reinício.

   AVISO IMPORTANTE sobre a hospedagem: no plano grátis do Render o sistema
   de arquivos é EFÊMERO — a documentação deles diz textualmente que bancos
   SQLite locais são perdidos a cada deploy, restart ou spin-down. Como o
   serviço dorme após 15 min de inatividade, SQLite sozinho NÃO resolve lá.

   Por isso esta camada aceita dois motores:
     - SQLite (arquivo local): funciona em qualquer lugar com disco de
       verdade — PC, VPS, ou Render pago com disco montado.
     - Postgres: se existir DATABASE_URL, usa ele. É o caminho que
       funciona no Render grátis, porque o banco fica FORA do container.

   Sem nenhum dos dois, o servidor continua rodando em memória (como antes),
   só que avisando no log. Nunca deixa de subir por causa do banco. */

const DB_PATH = process.env.DB_PATH || './quintal.db';
const DATABASE_URL = process.env.DATABASE_URL || null;

/* ═════════ FUNDADOR ═════════
   Quem é o fundador NÃO vem do cliente. Vem de uma variável de ambiente
   configurada na hospedagem, comparada com o aparelho que se conectou.
   Um cliente modificado pode mandar qualquer aparelhoId, mas só terá
   privilégio se coincidir com o valor guardado aqui — que ele não conhece.

   Como configurar no Render: Environment > Add Environment Variable
     FUNDADOR_CHAVE = (a chave que aparece no MUNDO > DIAGNÓSTICO)

   Sem a variável definida, ninguém é fundador. É o padrão seguro. */
const FUNDADOR_CHAVE = process.env.FUNDADOR_CHAVE || null;
function ehFundador(j) {
  return !!(FUNDADOR_CHAVE && j && j.aparelho && j.aparelho === FUNDADOR_CHAVE);
}
let db = null, dbTipo = 'memoria', pg = null;
let bancoPronto = false;

function iniciarBanco() {
  if (DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pg = new Pool({ connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
      dbTipo = 'postgres';
      pg.query(`CREATE TABLE IF NOT EXISTS contas (
        usuario TEXT PRIMARY KEY, chave TEXT UNIQUE NOT NULL, nome TEXT,
        senha_salt TEXT NOT NULL, senha_hash TEXT NOT NULL,
        criado BIGINT, atualizado BIGINT);
      CREATE TABLE IF NOT EXISTS usuarios (
        chave TEXT PRIMARY KEY, nome TEXT, cash INTEGER DEFAULT 0,
        bank TEXT DEFAULT '[]', estoque TEXT DEFAULT '[]',
        up TEXT DEFAULT '{}', armas TEXT DEFAULT '{}', fert TEXT DEFAULT '{}',
        rack_max INTEGER DEFAULT 6, armor REAL DEFAULT 0, municao TEXT DEFAULT '{}', funcs TEXT DEFAULT '[]', imoveis TEXT DEFAULT '[]', nivel INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, territorios TEXT DEFAULT '{}', atualizado BIGINT)`)
        .then(() => pg.query(`CREATE TABLE IF NOT EXISTS lotes (
          idx INTEGER PRIMARY KEY, dono_chave TEXT, dono_nome TEXT,
          plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0);
          CREATE TABLE IF NOT EXISTS farm_slots (
            slot_index INTEGER PRIMARY KEY, owner_key TEXT UNIQUE, owner_name TEXT,
            plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0,
            unlocked_at BIGINT DEFAULT 0, updated_at BIGINT DEFAULT 0);
          CREATE TABLE IF NOT EXISTS farm_jobs (
            job_id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, station_id INTEGER NOT NULL,
            operation TEXT NOT NULL, stock_id BIGINT NOT NULL, quantity INTEGER NOT NULL,
            started_at BIGINT NOT NULL, completes_at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', source_json TEXT DEFAULT '{}')`))
        .then(() => pg.query('ALTER TABLE farm_slots ADD COLUMN IF NOT EXISTS portao_aberto INTEGER DEFAULT 0'))
        .then(() => pg.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS armor REAL DEFAULT 0'))
        .then(() => pg.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS municao TEXT DEFAULT '{}'"))
        .then(() => pg.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS funcs TEXT DEFAULT '[]'"))
        .then(() => pg.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS imoveis TEXT DEFAULT '[]'"))
        .then(() => pg.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nivel INTEGER DEFAULT 1"))
        .then(() => pg.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0"))
        .then(() => pg.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS territorios TEXT DEFAULT '{}'"))
        .then(() => pg.query("ALTER TABLE farm_jobs ADD COLUMN IF NOT EXISTS source_json TEXT DEFAULT '{}'"))
        .then(() => { console.log('banco: Postgres pronto'); return carregarLotes(); })
        .then(() => carregarFarmState())
        .then(() => carregarTerritoriosPersistidos())
        .then(() => { bancoPronto = true; })
        .catch(e => { console.error('Postgres falhou:', e.message); pg = null; dbTipo = 'indisponivel'; bancoPronto = false; });
      return;
    } catch (e) {
      console.error('pg indisponível:', e.message);
      pg = null;
    }
  }
  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS contas (
      usuario TEXT PRIMARY KEY, chave TEXT UNIQUE NOT NULL, nome TEXT,
      senha_salt TEXT NOT NULL, senha_hash TEXT NOT NULL,
      criado INTEGER, atualizado INTEGER);
    CREATE TABLE IF NOT EXISTS usuarios (
      chave TEXT PRIMARY KEY, nome TEXT, cash INTEGER DEFAULT 0,
      bank TEXT DEFAULT '[]', estoque TEXT DEFAULT '[]',
      up TEXT DEFAULT '{}', armas TEXT DEFAULT '{}', fert TEXT DEFAULT '{}',
      rack_max INTEGER DEFAULT 6, armor REAL DEFAULT 0, municao TEXT DEFAULT '{}', funcs TEXT DEFAULT '[]', imoveis TEXT DEFAULT '[]', nivel INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, territorios TEXT DEFAULT '{}', atualizado INTEGER)`);
    db.exec(`CREATE TABLE IF NOT EXISTS lotes (
      idx INTEGER PRIMARY KEY, dono_chave TEXT, dono_nome TEXT,
      plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS farm_slots (
      slot_index INTEGER PRIMARY KEY, owner_key TEXT UNIQUE, owner_name TEXT,
      plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0,
      unlocked_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS farm_jobs (
      job_id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, station_id INTEGER NOT NULL,
      operation TEXT NOT NULL, stock_id INTEGER NOT NULL, quantity INTEGER NOT NULL,
      started_at INTEGER NOT NULL, completes_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', source_json TEXT DEFAULT '{}')`);
    try { db.exec('ALTER TABLE farm_slots ADD COLUMN portao_aberto INTEGER DEFAULT 0'); } catch (_) {}
    try { db.exec('ALTER TABLE usuarios ADD COLUMN armor REAL DEFAULT 0'); } catch (_) {}
    try { db.exec("ALTER TABLE usuarios ADD COLUMN municao TEXT DEFAULT '{}'"); } catch (_) {}
    try { db.exec("ALTER TABLE usuarios ADD COLUMN funcs TEXT DEFAULT '[]'"); } catch (_) {}
    try { db.exec("ALTER TABLE usuarios ADD COLUMN imoveis TEXT DEFAULT '[]'"); } catch (_) {}
    try { db.exec("ALTER TABLE usuarios ADD COLUMN nivel INTEGER DEFAULT 1"); } catch (_) {}
    try { db.exec("ALTER TABLE usuarios ADD COLUMN xp INTEGER DEFAULT 0"); } catch (_) {}
    try { db.exec("ALTER TABLE usuarios ADD COLUMN territorios TEXT DEFAULT '{}'"); } catch (_) {}
    try { db.exec("ALTER TABLE farm_jobs ADD COLUMN source_json TEXT DEFAULT '{}'" ); } catch (_) {}
    dbTipo = 'sqlite';
      console.log('banco: SQLite em ' + DB_PATH);
    carregarLotes();
    carregarFarmState();
    carregarTerritoriosPersistidos();
    bancoPronto = true;
  } catch (e) {
    console.error('SQLite indisponível (' + e.message + ') — rodando só em memória');
    db = null; dbTipo = 'memoria'; bancoPronto = true;
  }
}

/* ── carteiras ── */
function carregarCarteira(chave) {
  if (dbTipo === 'sqlite' && db) {
    try {
      const r = db.prepare('SELECT * FROM usuarios WHERE chave = ?').get(chave);
      if (!r) return null;
      const up = JSON.parse(r.up || '{}');
      return {
        cash: r.cash, bank: JSON.parse(r.bank || '[]'),
        estoque: JSON.parse(r.estoque || '[]'), up,
        avatarId: avatarCatalogado(up._avatarId),
        armas: JSON.parse(r.armas || '{}'),         fert: JSON.parse(r.fert || '{}'),
        rackMax: r.rack_max || 6, armor: Number(r.armor) || 0,
        municao: JSON.parse(r.municao || '{}'), funcs: JSON.parse(r.funcs || '[]'),
        imoveis: JSON.parse(r.imoveis || '[]'), nivel: Number(r.nivel) || 1, xp: Number(r.xp) || 0,
        territorios: JSON.parse(r.territorios || '{}'), _iniciado: true
      };
    } catch (e) { console.error('erro ao ler carteira:', e.message); }
  }
  return null;   // postgres carrega de forma assíncrona, em carregarCarteiraAsync
}
async function carregarCarteiraAsync(chave) {
  if (dbTipo !== 'postgres' || !pg) return null;
  try {
    const r = await pg.query('SELECT * FROM usuarios WHERE chave = $1', [chave]);
    if (!r.rows.length) return null;
    const x = r.rows[0];
    const up = JSON.parse(x.up || '{}');
    return {
      cash: x.cash, bank: JSON.parse(x.bank || '[]'),
      estoque: JSON.parse(x.estoque || '[]'), up,
      avatarId: avatarCatalogado(up._avatarId),
      armas: JSON.parse(x.armas || '{}'),       fert: JSON.parse(x.fert || '{}'),
      rackMax: x.rack_max || 6, armor: Number(x.armor) || 0,
      municao: JSON.parse(x.municao || '{}'), funcs: JSON.parse(x.funcs || '[]'),
      imoveis: JSON.parse(x.imoveis || '[]'), nivel: Number(x.nivel) || 1, xp: Number(x.xp) || 0,
      territorios: JSON.parse(x.territorios || '{}'), _iniciado: true
    };
  } catch (e) { console.error('erro ao ler carteira (pg):', e.message); return null; }
}
function salvarCarteira(chave) {
  const c = carteiras.get(chave);
  if (!c) return;
  const upSalvo = Object.assign({}, c.up || {}, { _avatarId: avatarCatalogado(c.avatarId) });
  const dados = [chave, c._nome || '', Math.floor(c.cash),
    JSON.stringify(c.bank || []), JSON.stringify(c.estoque || []),
    JSON.stringify(upSalvo), JSON.stringify(c.armas || {}),
    JSON.stringify(c.fert || {}), c.rackMax || 6, Number(c.armor) || 0,
    JSON.stringify(c.municao || {}), JSON.stringify(c.funcs || []), JSON.stringify(c.imoveis || []),
    Number(c.nivel) || 1, Number(c.xp) || 0, JSON.stringify(c.territorios || {}), Date.now()];
  if (dbTipo === 'sqlite' && db) {
    try {
      db.prepare(`INSERT INTO usuarios
        (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,armor,municao,funcs,imoveis,nivel,xp,territorios,atualizado)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(chave) DO UPDATE SET nome=excluded.nome, cash=excluded.cash,
          bank=excluded.bank, estoque=excluded.estoque, up=excluded.up,
          armas=excluded.armas, fert=excluded.fert, rack_max=excluded.rack_max,
          armor=excluded.armor, municao=excluded.municao, funcs=excluded.funcs,
          imoveis=excluded.imoveis, nivel=excluded.nivel, xp=excluded.xp,
          territorios=excluded.territorios, atualizado=excluded.atualizado`).run(...dados);
    } catch (e) { console.error('erro ao salvar carteira:', e.message); }
  } else if (dbTipo === 'postgres' && pg) {
    pg.query(`INSERT INTO usuarios
      (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,armor,municao,funcs,imoveis,nivel,xp,territorios,atualizado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT(chave) DO UPDATE SET nome=EXCLUDED.nome, cash=EXCLUDED.cash,
        bank=EXCLUDED.bank, estoque=EXCLUDED.estoque, up=EXCLUDED.up,
        armas=EXCLUDED.armas, fert=EXCLUDED.fert, rack_max=EXCLUDED.rack_max,
        armor=EXCLUDED.armor, municao=EXCLUDED.municao, funcs=EXCLUDED.funcs,
        imoveis=EXCLUDED.imoveis, nivel=EXCLUDED.nivel, xp=EXCLUDED.xp,
        territorios=EXCLUDED.territorios, atualizado=EXCLUDED.atualizado`, dados)
      .catch(e => console.error('erro ao salvar carteira (pg):', e.message));
  }
}

/* ── lotes ── */
function salvarLotes() {
  if (dbTipo === 'sqlite' && db) {
    try {
      const st = db.prepare(`INSERT INTO lotes (idx,dono_chave,dono_nome,plots,portao_aberto)
        VALUES (?,?,?,?,?)
        ON CONFLICT(idx) DO UPDATE SET dono_chave=excluded.dono_chave,
          dono_nome=excluded.dono_nome, plots=excluded.plots,
          portao_aberto=excluded.portao_aberto`);
      const tx = db.transaction(() => {
        for (const l of lotes)
          st.run(l.index, l.donoChave, l.donoNome, JSON.stringify(l.plots), l.portaoAberto ? 1 : 0);
      });
      tx();
    } catch (e) { console.error('erro ao salvar lotes:', e.message); }
  } else if (dbTipo === 'postgres' && pg) {
    for (const l of lotes) {
      pg.query(`INSERT INTO lotes (idx,dono_chave,dono_nome,plots,portao_aberto)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(idx) DO UPDATE SET dono_chave=EXCLUDED.dono_chave,
          dono_nome=EXCLUDED.dono_nome, plots=EXCLUDED.plots,
          portao_aberto=EXCLUDED.portao_aberto`,
        [l.index, l.donoChave, l.donoNome, JSON.stringify(l.plots), l.portaoAberto ? 1 : 0])
        .catch(e => console.error('erro ao salvar lote (pg):', e.message));
    }
  }
}
function aplicarLoteSalvo(l, r) {
  if (!r) return;
  l.donoChave = r.dono_chave || null;
  l.donoNome  = r.dono_nome || null;
  l.portaoAberto = !!r.portao_aberto;
  try {
    const ps = JSON.parse(r.plots || '[]');
    for (let i = 0; i < PLOTS_POR_LOTE; i++) {
      const pl = ps[i];
      if (!pl || !pl.s) { l.plots[i] = null; continue; }
      // a planta volta como entidade nova: o ID é sempre do servidor
      const ent = registrar('pl', l.donoChave, pl);
      pl.id = ent.id; pl.loteIndex = l.index; pl.plotIndex = i;
      l.plots[i] = pl;
    }
  } catch (e) { console.error('plots corrompidos no lote ' + l.index); }
  if (l.donoChave) {
    loteDe.set(l.donoChave, l.index);
    const el = entidades.get(l.id); if (el) el.dono = l.donoChave;
    const ep = entidades.get(l.portaoId); if (ep) ep.dono = l.donoChave;
  }
}
function carregarLotes() {
  if (dbTipo === 'sqlite' && db) {
    try {
      const rs = db.prepare('SELECT * FROM lotes').all();
      rs.forEach(r => { const l = lotes[r.idx]; if (l) aplicarLoteSalvo(l, r); });
      console.log('lotes carregados do banco: ' + rs.length);
    } catch (e) { console.error('erro ao carregar lotes:', e.message); }
  } else if (dbTipo === 'postgres' && pg) {
    return pg.query('SELECT * FROM lotes')
      .then(r => { r.rows.forEach(x => { const l = lotes[x.idx]; if (l) aplicarLoteSalvo(l, x); });
        console.log('lotes carregados do banco: ' + r.rows.length); })
      .catch(e => { console.error('erro ao carregar lotes (pg):', e.message); throw e; });
  }
  return Promise.resolve();
}
function farmPlantPublic(pl) {
  if (!pl || !pl.s) return null;
  return { id: pl.id || null, s: pl.s, prog: num(pl.prog, 0, 100, 0), agua: num(pl.agua, 0, 1, 0),
    saude: num(pl.saude, 0, 1, 0), praga: num(pl.praga, 0, 1, 0), estagio: num(pl.estagio, 0, 4, 0) | 0,
    adubOrg: num(pl.adubOrg, 0, 1000, 0), adubCres: num(pl.adubCres, 0, 1000, 0), adubFlor: !!pl.adubFlor };
}
function farmPlotPublic(p, includePlant = true) {
  return { id: p.id, slotIndex: p.slotIndex, localIndex: p.localIndex, x: p.x, z: p.z,
    plant: includePlant ? farmPlantPublic(p.plant) : null };
}
function farmSlotPublic(slot, includePlots = false) {
  return { slotIndex: slot.slotIndex, x: slot.x, z: slot.z,
    preco: FARM_LOT_PRICES[slot.slotIndex], disponivel: !slot.ownerKey,
    portaoId: slot.portaoId, portaoAberto: !!slot.portaoAberto,
    donoNome: slot.ownerName || null, donoId: slot.ownerKey || null,
    plots: includePlots ? slot.plots.map(p => farmPlotPublic(p, true)) : [] };
}
function farmTablePublic(table) {
  const j = table.job;
  return { stationId: table.stationId, farmSlotIndex: table.farmSlotIndex, x: table.x, z: table.z,
    status: j ? 'working' : (table.queue.length ? 'queued' : 'idle'),
    jobId: j ? j.jobId : null, operation: j ? j.operation : null,
    ownerKey: j ? j.ownerKey : null, quantity: j ? j.quantity : 0,
    completesAt: j ? j.completesAt : 0, queueLength: table.queue.length };
}
function farmStateFor(j) {
  const slot = j && j.chave && farmSlotDe.has(j.chave) ? farmSlots[farmSlotDe.get(j.chave)] : null;
  const tables = slot ? farmTables.filter(t => t.farmSlotIndex === slot.slotIndex) : [];
  return { unlocked: !!slot, slot: slot ? farmSlotPublic(slot, true) : null,
    slots: farmSlots.map(s => farmSlotPublic(s, false)),
    tables: tables.map(farmTablePublic) };
}
function aplicarFarmJobRows(rows) {
  for (const table of farmTables) { table.job = null; table.queue = []; }
  for (const r of rows || []) {
    const stationId = Number(r.station_id), table = farmTables[stationId];
    if (!table || !r.owner_key) continue;
    let sourceRaw = {};
    try { sourceRaw = JSON.parse(r.source_json || '{}'); } catch (_) { sourceRaw = {}; }
    const source = { s: limparStrain(sourceRaw.s), qual: num(sourceRaw.qual, 0, 1.35, .55), desde: num(sourceRaw.desde, 0, Number.MAX_SAFE_INTEGER, agora()) };
    if (!source.s) { console.error('job de fazenda ignorado: genética de origem inválida'); continue; }
    const job = { jobId: String(r.job_id), ownerKey: String(r.owner_key), stationId,
      operation: String(r.operation), stockId: Number(r.stock_id), quantity: Number(r.quantity),
      startedAt: Number(r.started_at), completesAt: Number(r.completes_at), status: String(r.status || 'queued'), source };
    if (job.status === 'running' && !table.job) table.job = job;
    else { job.status = 'queued'; table.queue.push(job); }
  }
}
function aplicarFarmSlotRows(rows) {
  for (const r of rows || []) {
    const slot = farmSlots[Number(r.slot_index)]; if (!slot) continue;
    slot.ownerKey = r.owner_key || null; slot.ownerName = nomeSeguro(r.owner_name) || null;
    slot.portaoAberto = !!r.portao_aberto;
    slot.unlockedAt = Number(r.unlocked_at) || 0; slot.updatedAt = Number(r.updated_at) || 0;
    const ep = entidades.get(slot.portaoId); if (ep) ep.dono = slot.ownerKey;
    if (slot.ownerKey) farmSlotDe.set(slot.ownerKey, slot.slotIndex);
    let ps = []; try { ps = JSON.parse(r.plots || '[]'); } catch (_) { ps = []; }
    for (let i = 0; i < FARM_PLOTS_PER_PLAYER; i++) {
      const p = slot.plots[i], raw = ps[i];
      p.ownerKey = slot.ownerKey;
      if (!raw) { p.plant = null; continue; }
      p.id = String(raw.id || `farm_${slot.slotIndex}_${i}`);
      p.plant = farmPlantPublic(raw.plant || raw);
      if (!p.plant || !p.plant.s) p.plant = null;
    }
  }
}
function carregarFarmState() {
  if (dbTipo === 'sqlite' && db) {
    try {
      aplicarFarmSlotRows(db.prepare('SELECT * FROM farm_slots ORDER BY slot_index').all());
      aplicarFarmJobRows(db.prepare("SELECT * FROM farm_jobs WHERE status IN ('queued','running') ORDER BY started_at").all());
    } catch (e) { console.error('erro ao carregar fazenda:', e.message); }
    return Promise.resolve();
  }
  if (dbTipo === 'postgres' && pg) {
    return Promise.all([
      pg.query('SELECT * FROM farm_slots ORDER BY slot_index'),
      pg.query("SELECT * FROM farm_jobs WHERE status IN ('queued','running') ORDER BY started_at")
    ]).then(([slots, jobs]) => { aplicarFarmSlotRows(slots.rows); aplicarFarmJobRows(jobs.rows); })
      .catch(e => { console.error('erro ao carregar fazenda (pg):', e.message); throw e; });
  }
  return Promise.resolve();
}
function salvarFarmState() {
  const rows = farmSlots.map(s => [s.slotIndex, s.ownerKey, s.ownerName || '', JSON.stringify(s.plots.map(p => ({
    id:p.id, plant:farmPlantPublic(p.plant)
  }))), s.portaoAberto ? 1 : 0, s.unlockedAt || 0, s.updatedAt || agora()]);
  if (dbTipo === 'sqlite' && db) {
    try {
      const st = db.prepare(`INSERT INTO farm_slots (slot_index,owner_key,owner_name,plots,portao_aberto,unlocked_at,updated_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(slot_index) DO UPDATE SET owner_key=excluded.owner_key,
        owner_name=excluded.owner_name, plots=excluded.plots, portao_aberto=excluded.portao_aberto,
        unlocked_at=excluded.unlocked_at, updated_at=excluded.updated_at`);
      db.transaction(() => rows.forEach(r => st.run(...r)))();
    } catch (e) { console.error('erro ao salvar fazenda:', e.message); }
  } else if (dbTipo === 'postgres' && pg) {
    for (const r of rows) pg.query(`INSERT INTO farm_slots (slot_index,owner_key,owner_name,plots,portao_aberto,unlocked_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(slot_index) DO UPDATE SET owner_key=EXCLUDED.owner_key,
      owner_name=EXCLUDED.owner_name, plots=EXCLUDED.plots, portao_aberto=EXCLUDED.portao_aberto,
      unlocked_at=EXCLUDED.unlocked_at, updated_at=EXCLUDED.updated_at`, r)
      .catch(e => console.error('erro ao salvar fazenda (pg):', e.message));
  }
  salvarFarmJobs();
}
function listarFarmJobs() { return farmTables.flatMap(t => [t.job, ...t.queue]).filter(Boolean); }
let farmJobsSaveChain = Promise.resolve();
function salvarFarmJobs() {
  const jobs = listarFarmJobs();
  if (dbTipo === 'sqlite' && db) {
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM farm_jobs').run();
        const st = db.prepare(`INSERT INTO farm_jobs (job_id,owner_key,station_id,operation,stock_id,quantity,started_at,completes_at,status,source_json)
          VALUES (?,?,?,?,?,?,?,?,?,?)`);
        jobs.forEach(j => st.run(j.jobId,j.ownerKey,j.stationId,j.operation,j.stockId,j.quantity,j.startedAt,j.completesAt,j.status,JSON.stringify(j.source || {})));
      })();
    } catch (e) { console.error('erro ao salvar mesas:', e.message); }
  } else if (dbTipo === 'postgres' && pg) {
    // Pool.query em DELETE + INSERT separados permitia que dois saves se
    // cruzassem e apagassem o snapshot mais novo. Uma conexão dedicada e
    // transação tornam cada snapshot indivisível; a fila preserva a ordem.
    farmJobsSaveChain = farmJobsSaveChain.catch(() => {}).then(async () => {
      const client = await pg.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM farm_jobs');
        for (const j of jobs) await client.query(`INSERT INTO farm_jobs
          (job_id,owner_key,station_id,operation,stock_id,quantity,started_at,completes_at,status,source_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [j.jobId,j.ownerKey,j.stationId,j.operation,j.stockId,j.quantity,j.startedAt,j.completesAt,j.status,JSON.stringify(j.source || {})]);
        await client.query('COMMIT');
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('erro ao salvar mesas (pg):', e.message);
      } finally { client.release(); }
    });
  }
}
function farmSlotDoJogador(j) {
  if (!j || !j.chave || !farmSlotDe.has(j.chave)) return null;
  const slot = farmSlots[farmSlotDe.get(j.chave)];
  if (!slot || !slot.ownerKey || slot.ownerKey !== j.chave) return null;
  return slot;
}
function atribuirFarmSlot(j, c) {
  if (!j || !j.chave || !c || Number(c.nivel) < 10) return null;
  if (farmSlotDe.has(j.chave)) {
    const slot = farmSlots[farmSlotDe.get(j.chave)];
    if (slot) { slot.ownerName = j.nome; slot.updatedAt = agora(); }
    return slot || null;
  }
  const slot = farmSlots.find(s => !s.ownerKey);
  if (!slot) return null;
  slot.ownerKey = j.chave; slot.ownerName = j.nome; slot.unlockedAt = agora(); slot.updatedAt = slot.unlockedAt;
  const ep = entidades.get(slot.portaoId); if (ep) ep.dono = j.chave;
  slot.plots.forEach(p => { p.ownerKey = j.chave; });
  farmSlotDe.set(j.chave, slot.slotIndex);
  salvarFarmState();
  farmEnviarSlots();
  return slot;
}
function farmSetorEm(x, z) {
  return farmSlots.find(s => x >= s.x - 12 && x <= s.x + 12 && z >= s.z - 14 && z <= s.z + 14) || null;
}
function farmPlotDoJogador(j, id) {
  const slot = farmSlotDoJogador(j);
  if (!slot) { enviar(j, { t:'recusado', motivo:'compre um lote da fazenda a partir do nível 10' }); return null; }
  const plot = slot.plots.find(p => p.id === String(id || '').slice(0, 32));
  if (!plot) { enviar(j, { t:'recusado', motivo:'canteiro da fazenda não pertence ao jogador' }); metricas.rejeitadas++; return null; }
  return plot;
}
function farmLocalPlotDoJogador(j, index) {
  const slot = farmSlotDoJogador(j);
  if (!slot) { enviar(j, { t:'recusado', motivo:'compre um lote da fazenda a partir do nível 10' }); return null; }
  const i = num(index, 0, FARM_PLOTS_PER_PLAYER - 1, -1) | 0;
  const plot = slot.plots[i];
  if (!plot) { metricas.rejeitadas++; return null; }
  return plot;
}
function farmDistanciaMesa(j, stationId) {
  const table = farmTables[num(stationId, 0, farmTables.length - 1, -1) | 0];
  const slot = farmSlotDoJogador(j);
  return table && slot && table.farmSlotIndex === slot.slotIndex &&
    Math.hypot(j.x - table.x, j.z - table.z) <= 3.4 ? table : null;
}
function farmTemAcessoAoGalpao(j) {
  const slot = farmSlotDoJogador(j);
  if (!slot) return false;
  return j.x >= FARM_BARN.x - FARM_BARN.w / 2 - 1 && j.x <= FARM_BARN.x + FARM_BARN.w / 2 + 1 &&
    j.z >= FARM_BARN.z - FARM_BARN.d / 2 - 1 && j.z <= FARM_BARN.z + FARM_BARN.d / 2 + 1;
}
function farmEnviarSlots() {
  const ev = { t:'farm_slots', slots:farmSlots.map(s => farmSlotPublic(s, false)) };
  for (const j of jogadores.values()) if (j.autenticado) enviar(j, ev);
}
function farmEnviarTabelas() {
  for (const j of jogadores.values()) {
    if (!j.autenticado || !j.carteiraPronta) continue;
    if (Math.hypot(j.x - FARM_BARN.x, j.z - FARM_BARN.z) > AOI_RAIO && !farmSlotDe.has(j.chave)) continue;
    const tables = farmTables.filter(t => t.farmSlotIndex === farmSlotDe.get(j.chave)).map(farmTablePublic);
    enviar(j, { t:'farm_tables', tables });
  }
}
function farmEnviarPlotUpdates(slot, updates) {
  const ev = { t:'farm_plots_update', slotIndex:slot.slotIndex, updates };
  for (const j of jogadores.values()) {
    if (!j.autenticado || !j.carteiraPronta) continue;
    if (j.chave === slot.ownerKey || Math.hypot(j.x - slot.x, j.z - slot.z) <= AOI_RAIO) enviar(j, ev);
  }
}
function farmIniciarProximo(table, now) {
  if (table.job || !table.queue.length) return;
  const job = table.queue.shift(); job.status = 'running'; job.startedAt = now;
  job.completesAt = now + FARM_STAGE_TIMES[job.operation] * 1000;
  table.job = job;
}
function farmConcluirJob(table, now) {
  const job = table.job; if (!job || now < job.completesAt) return false;
  const c = carteiras.get(job.ownerKey);
  if (!c) { job.completesAt = now + 5000; return false; }
  if (c.estoque.length >= c.rackMax) { job.completesAt = now + 5000; return false; }
  const source = job.source || {};
  const stage = job.operation === 'secagem' ? 'cura' : job.operation === 'cura' ? 'embalagem' : 'pronto';
  const qualMult = job.operation === 'cura' ? 1.12 : job.operation === 'embalagem' ? 1.04 : 1;
  c.estoque.push({ id:job.stockId, s:source.s, qtd:job.quantity, estagio:stage,
    qual:Math.min(1.35, Number(source.qual) * qualMult || .55), desde:now });
  marcarSuja({ chave:job.ownerKey });
  const dono = [...jogadores.values()].find(j => j.chave === job.ownerKey && j.autenticado);
  if (dono) {
    enviar(dono, { t:'farm_job_ok', jobId:job.jobId, stationId:job.stationId, operation:job.operation,
      stockId:job.stockId, estagio:stage, qtd:job.quantity });
    enviarEstado(dono);
  }
  table.job = null; farmIniciarProximo(table, now); salvarFarmState(); farmEnviarTabelas(); return true;
}
function farmProcessarMesas() {
  const now = agora(); let mudou = false;
  for (const table of farmTables) mudou = farmConcluirJob(table, now) || mudou;
  if (mudou) farmEnviarTabelas();
}
function farmPlantar(j, m) {
  if (!exigirJogadorVivo(j)) return;
  const plot = m.plotId ? farmPlotDoJogador(j, m.plotId) : farmLocalPlotDoJogador(j, m.plot);
  if (!plot || plot.plant) { if (plot && plot.plant) enviar(j, { t:'recusado', motivo:'canteiro já ocupado' }); return; }
  if (!exigirDistancia(j, plot.x, plot.z, 4.5, 'longe do canteiro da fazenda')) return;
  const c = carteiras.get(j.chave), seedId = num(m.seedId, 0, 1e9, -1) | 0;
  const entry = c && c.bank.find(e => e.s && e.s.id === seedId);
  if (!entry || entry.qtd < 1) { enviar(j, { t:'recusado', motivo:'semente não pertence ao jogador' }); metricas.rejeitadas++; return; }
  const s = limparStrain(entry.s); if (!s || !bankTirar(c, s.id, 1)) { metricas.rejeitadas++; return; }
  plot.plant = { id:novoId('fp'), s, prog:0, agua:1, saude:1, praga:0, estagio:0,
    adubOrg:0, adubCres:0, adubFlor:false };
  plot.updatedAt = agora(); const slot = farmSlotDoJogador(j); slot.updatedAt = plot.updatedAt;
  marcarSuja(j); enviar(j, { t:'farm_plot_update', slotIndex:slot.slotIndex, localIndex:plot.localIndex, plot:farmPlotPublic(plot) });
  enviarEstado(j); salvarFarmState();
}
function farmRegar(j, m) {
  if (!exigirJogadorVivo(j)) return;
  const plot = m.plotId ? farmPlotDoJogador(j, m.plotId) : farmLocalPlotDoJogador(j, m.plot);
  if (!plot || !plot.plant) { if (plot) enviar(j, { t:'recusado', motivo:'canteiro vazio' }); return; }
  if (!exigirDistancia(j, plot.x, plot.z, 4.5, 'longe do canteiro da fazenda')) return;
  plot.plant.agua = 1; plot.plant.praga = 0; plot.updatedAt = agora();
  const slot = farmSlotDoJogador(j); slot.updatedAt = agora();
  marcarSuja(j); farmEnviarPlotUpdates(slot, [{ localIndex:plot.localIndex, plot:farmPlotPublic(plot) }]);
  enviarEstado(j); salvarFarmState();
}
function farmColher(j, m) {
  if (!exigirJogadorVivo(j)) return;
  const plot = m.plotId ? farmPlotDoJogador(j, m.plotId) : farmLocalPlotDoJogador(j, m.plot);
  if (!plot || !plot.plant) { if (plot) enviar(j, { t:'recusado', motivo:'canteiro vazio' }); return; }
  if (!exigirDistancia(j, plot.x, plot.z, 4.5, 'longe do canteiro da fazenda')) return;
  const p = plot.plant, c = carteiras.get(j.chave);
  if (p.estagio !== 4) { enviar(j, { t:'recusado', motivo:'planta ainda não está pronta' }); return; }
  if (c.estoque.length >= c.rackMax) { enviar(j, { t:'recusado', motivo:'bancada cheia' }); return; }
  const q = Math.max(2, Math.round((1.3 + p.s.t.rendimento / 100 * 2.6) * p.saude * 7 * (p.s.auto ? .72 : 1) * (RAR_MULT[p.s.rar] || 1)));
  plot.plant = null; plot.updatedAt = agora();
  c.estoque.push({ id:proxLoteId++, s:p.s, qtd:q, estagio:'sec', qual:.55 + p.saude * .45, desde:agora() });
  const slot = farmSlotDoJogador(j); slot.updatedAt = agora(); marcarSuja(j);
  enviar(j, { t:'farm_plot_update', slotIndex:slot.slotIndex, localIndex:plot.localIndex, plot:farmPlotPublic(plot) });
  enviar(j, { t:'colheita', plotIndex:plot.localIndex, qtd:q, strain:p.s, fazenda:true }); enviarEstado(j); salvarFarmState();
}
function farmIniciarJob(j, m) {
  if (!exigirJogadorVivo(j)) return;
  const slot = farmSlotDoJogador(j); if (!slot || !farmTemAcessoAoGalpao(j)) { enviar(j, { t:'recusado', motivo:'entre no galpão da fazenda' }); return; }
  const table = farmDistanciaMesa(j, m.stationId); if (!table) { enviar(j, { t:'recusado', motivo:'aproxime-se de uma mesa da fazenda' }); return; }
  const operation = str(m.operation, 16); if (!Object.prototype.hasOwnProperty.call(FARM_STAGE_TIMES, operation)) { enviar(j, { t:'recusado', motivo:'etapa de produção inválida' }); metricas.rejeitadas++; return; }
  if (table.queue.length >= 4 || table.job && table.job.ownerKey === j.chave && table.job.stockId === Number(m.stockId)) { enviar(j, { t:'recusado', motivo:'mesa ocupada para este lote' }); return; }
  const c = carteiras.get(j.chave), stockId = num(m.stockId, 0, 1e9, -1) | 0;
  const i = c.estoque.findIndex(l => l.id === stockId), lot = i >= 0 ? c.estoque[i] : null;
  const esperado = operation === 'secagem' ? 'sec' : operation === 'cura' ? 'cura' : 'embalagem';
  if (!lot || lot.estagio !== esperado || lot.qtd < 1) { enviar(j, { t:'recusado', motivo:'lote não está na etapa correta' }); return; }
  c.estoque.splice(i, 1); marcarSuja(j);
  const job = { jobId:'fj_' + crypto.randomUUID(), ownerKey:j.chave, stationId:table.stationId,
    operation, stockId:lot.id, quantity:lot.qtd, startedAt:0, completesAt:0, status:'queued',
    source:{ s:lot.s, qual:lot.qual, desde:lot.desde } };
  table.queue.push(job);
  farmIniciarProximo(table, agora());
  enviar(j, { t:'farm_job_started', jobId:job.jobId, stationId:table.stationId, operation, qtd:job.quantity });
  enviarEstado(j); salvarFarmState(); farmEnviarTabelas();
}
function salvarTudo() {
  for (const j of jogadores.values()) copiarPosicaoParaCarteira(j);
  for (const chave of carteiras.keys()) salvarCarteira(chave);
  salvarLotes();
  salvarFarmState();
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
farmSlots.forEach(s => { s.portaoId = registrar('pt', null, s).id; });

/* Validação central de propriedade. Toda ação sobre entidade passa por
   aqui. Retorna a entidade, ou null com o motivo já enviado ao jogador. */
function entidadeDoJogador(j, id, tipo) {
  if (!j.autenticado) {
    enviar(j, { t: 'recusado', motivo: 'handshake necessário' });
    metricas.rejeitadas++; return null;
  }
  const ent = entidades.get(String(id || '').slice(0, 24));
  if (!ent) {
    enviar(j, { t: 'recusado', motivo: 'entidade não existe' });
    metricas.rejeitadas++; return null;
  }
  if (tipo && ent.tipo !== tipo) {
    enviar(j, { t: 'recusado', motivo: 'tipo de entidade errado' });
    metricas.rejeitadas++; return null;
  }
  const chave = j.chave;
  // Entidades privadas sem dono nunca podem ser operadas.
  if (!ent.dono || ent.dono !== chave) {
    enviar(j, { t: 'recusado', motivo: 'isso não é seu' });
    metricas.rejeitadas++; return null;
  }
  return ent;
}
function exigirHandshake(j) {
  if (j.autenticado) return true;
  enviar(j, { t: 'recusado', motivo: 'handshake necessário' });
  metricas.rejeitadas++;
  return false;
}
function exigirJogadorVivo(j) {
  if (!exigirHandshake(j)) return false;
  if (!j.carteiraPronta) {
    enviar(j, { t:'recusado', motivo:'carteira ainda carregando' });
    metricas.rejeitadas++;
    return false;
  }
  if (j.morto || !j.vivo) {
    enviar(j, { t:'recusado', motivo:'jogador morto — aguarde o respawn' });
    metricas.rejeitadas++;
    return false;
  }
  return true;
}
function exigirDistancia(j, x, z, raio, motivo = 'longe demais') {
  if (Math.hypot(j.x - x, j.z - z) <= raio) return true;
  enviar(j, { t: 'recusado', motivo });
  metricas.rejeitadas++;
  return false;
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
const CAT_UPG = Object.freeze(Object.assign(Object.create(null), { vasos:520, led:680, irrig:900, rack:340, auto:980 }));
const CAT_IMOVEIS = Object.freeze(Object.assign(Object.create(null), {
  casanova: { custo:1800, nivel:1, renda:60, x:69, z:64 },
  predio1: { custo:4200, nivel:2, renda:110, x:-.6, z:19.6 },
  predio2: { custo:6800, nivel:4, renda:180, x:14.4, z:19.6 },
  predio3: { custo:11000, nivel:6, renda:290, x:29.4, z:19.6 },
}));
const CAT_ADUBO = Object.freeze(Object.assign(Object.create(null), { organico:60, crescimento:110, floracao:180 }));
const CAT_ARMA = Object.freeze(Object.assign(Object.create(null), { punho:0, pistola:450, smg:1500, rifle:3600 }));
const CAT_MUNICAO = Object.freeze(Object.assign(Object.create(null), {
  pistola: { qtd: 12, custo: 54 },
  smg: { qtd: 34, custo: 180 },
  rifle: { qtd: 78, custo: 432 }
}));
const CAT_ARMA_ESTADO = Object.freeze(Object.assign(Object.create(null), {
  punho:   { dano: 0,  mag: 0,  reserva: 0, rate: 0.00, alcance: 0  },
  pistola: { dano: 26, mag: 12, reserva: 24, rate: 0.34, alcance: 34 },
  smg:     { dano: 19, mag: 30, reserva: 34, rate: 0.11, alcance: 30 },
  rifle:   { dano: 42, mag: 24, reserva: 78, rate: 0.19, alcance: 52 }
}));
const ARMA_INDEX = ['punho', 'pistola', 'smg', 'rifle'];
const AVATAR_IDS = new Set(['carmo', 'verde', 'azul', 'roxo']);
function avatarCatalogado(v) {
  const id = str(v, 16).toLowerCase();
  return AVATAR_IDS.has(id) ? id : 'carmo';
}
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
    // tenta recuperar do banco antes de criar uma carteira nova
    const salva = carregarCarteira(k);
    carteiras.set(k, salva || { cash: CASH_INICIAL, bank: [], estoque: [],
      rackMax: 6, up: {}, avatarId: avatarCatalogado(j.avatarId), armas: { pistola: true }, fert: {}, municao: {}, funcs: [] });
  }
  const c = carteiras.get(k);
  for (const lote of (Array.isArray(c.estoque) ? c.estoque : [])) {
    const id = Number(lote && lote.id);
    if (Number.isSafeInteger(id) && id >= 0 && id < 1e9) proxLoteId = Math.max(proxLoteId, id + 1);
  }
  c.armas = c.armas || {};
  c.municao = c.municao || {};
  c.imoveis = Array.isArray(c.imoveis) ? c.imoveis : [];
  c.territorios = c.territorios && typeof c.territorios === 'object' ? c.territorios : {};
  c.nivel = Math.max(1, Math.min(12, Number(c.nivel) || 1));
  c.xp = Math.max(0, Number(c.xp) || 0);
  c.funcs = Array.isArray(c.funcs) ? c.funcs : [];
  c.avatarId = avatarCatalogado(c.avatarId || (c.up && c.up._avatarId) || j.avatarId);
  j.avatarId = c.avatarId;
  // A pistola inicial não depende de mensagem do cliente.
  c.armas.pistola = true;
  if (!c.municao.pistola) c.municao.pistola = { pente: 12, reserva: 24 };
  j.armas = c.armas;
  j.municao = c.municao;
  if (j.nome) c._nome = j.nome;
  return c;
}
function sincronizarEquipamento(j) {
  const c = carteiraDe(j);
  j.avatarId = c.avatarId;
  j.armas = c.armas;
  j.municao = c.municao;
  j.armor = c.armor;
  return c;
}
function darXP(j, quantidade) {
  const c = carteiraDe(j);
  c.xp += Math.max(0, Math.min(10000, Number(quantidade) || 0));
  c.nivel = Math.min(12, 1 + Math.floor(c.xp / 450));
  marcarSuja(j);
}
function aplicarDiariaServidor() {
  for (const [chave, c] of carteiras) {
    let renda = 0;
    for (const nome of Object.keys(c.territorios || {})) {
      const p = TERRITORIOS.find(x => x.nome === nome);
      if (p && p.ownerKey === chave) renda += Math.max(0, Number(p.renda) || 0);
    }
    for (const k of (c.imoveis || [])) renda += CAT_IMOVEIS[k] ? CAT_IMOVEIS[k].renda : 0;
    let folha = 0;
    for (const registro of (c.funcs || [])) {
      const id = typeof registro === 'string' ? registro : registro && registro.id;
      const e = id && entidades.get(id);
      if (e && e.ref && CAT_FUNC[e.ref.cargo]) folha += CAT_FUNC[e.ref.cargo].diaria;
    }
    c.cash = Math.max(0, c.cash + renda - folha);
    marcarSuja({ chave });
    for (const [, j] of jogadores) if (j.chave === chave) {
      enviar(j, { t:'diaria', renda, folha, saldo:Math.floor(c.cash) });
      enviarEstado(j);
    }
  }
}
function spawnOficial(j) {
  const lote = loteDoJogador(j);
  if (lote) return { x: lote.x, y: 0, z: lote.z + LOTE_D / 2 - 3.2 };
  return { x: 0, y: 0, z: 15 };
}
function posicaoCarteira(c) {
  const p = c && c.up && c.up._posicao;
  if (!p || ![p.x, p.y, p.z, p.ry].every(Number.isFinite)) return null;
  if (dentroDeParede(p.x, p.z, RAIO_JOGADOR)) return null;
  return { x: p.x, y: 0, z: p.z, ry: p.ry };
}
function consumirPosicaoRetomada(chave) {
  const p = chave && posicoesRetomada.get(chave);
  if (!p) return null;
  posicoesRetomada.delete(chave);
  if (p.expira <= agora()) return null;
  if (![p.x, p.y, p.z, p.ry].every(Number.isFinite)) return null;
  if (dentroDeParede(p.x, p.z, RAIO_JOGADOR)) return null;
  return p;
}
function copiarPosicaoParaCarteira(j) {
  if (!j || !j.autenticado || !j.chave || !j.posIniciada || j.morto) return false;
  const c = carteiras.get(j.chave);
  if (!c) return false;
  const p = { x: num(j.x, -1000, 1000, 0), y: 0,
    z: num(j.z, -1000, 1000, 0), ry: num(j.ry, -Math.PI * 4, Math.PI * 4, 0) };
  const old = c.up && c.up._posicao;
  if (old && Math.abs(old.x - p.x) < .05 && Math.abs(old.z - p.z) < .05 && Math.abs(old.ry - p.ry) < .01) return false;
  c.up = c.up || {};
  c.up._posicao = p;
  marcarSuja(j);
  return true;
}
function aplicarDanoJogador(j, dano, de) {
  if (!j || j.morto || !j.autenticado) return { aplicado: 0, morreu: false };
  // A propriedade é uma zona segura contra NPCs e polícia. A proteção é
  // authoritative e fica aqui, antes de alterar HP/armadura, para não haver
  // dano visual no cliente que depois seja desfeito pelo próximo estado.
  if (jogadorEmCasaSegura(j)) return { aplicado: 0, morreu: false, protegido: true };
  const c = sincronizarEquipamento(j);
  let restante = Math.max(0, num(dano, 0, 100, 0));
  const absorvido = Math.min(j.armor, restante * .7);
  j.armor = Math.max(0, j.armor - absorvido);
  c.armor = j.armor;
  restante -= absorvido;
  j.hp = Math.max(0, j.hp - restante);
  const resultado = { aplicado: restante, hp: j.hp, armor: j.armor, morreu: false };
  if (j.hp <= 0) {
    const perda = Math.floor(Math.max(0, c.cash) * .3);
    c.cash = Math.max(0, c.cash - perda);
    c.armor = 0;
    j.armor = 0;
    j.hp = 0;
    j.morto = true;
    j.respawnEm = agora() + 3000;
    j.procurado = 0;
    resultado.morreu = true;
    resultado.perda = perda;
    paraInteresse({ t: 'player_morreu', id: j.id, por: de || null }, j.x, j.z, j.chave);
  }
  enviar(j, { t: 'levou_tiro', de, dano: resultado.aplicado, hp: j.hp, armor: j.armor });
  enviarEstado(j);
  marcarSuja(j);
  return resultado;
}
// Chamado sempre que a carteira muda. Marca pra salvar no próximo ciclo
// em vez de gravar na hora — evita escrever em disco a cada tecla.
const sujas = new Set();
function marcarSuja(j) { const k = j && (j.chave || j.id); if (k) sujas.add(k); }
function enviarEstado(j) {
  marcarSuja(j);
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
    up: c.up, armas: c.armas, fert: c.fert || {},
    municao: c.municao || j.municao || {},
    funcs: (c.funcs || []).map(registro => {
      const id = typeof registro === 'string' ? registro : registro && registro.id;
      const e = id && entidades.get(id); return e && e.ref ? resumoFunc(e.ref) : null;
    }).filter(Boolean),
    imoveis: c.imoveis || [], nivel: c.nivel || 1, xp: c.xp || 0,
    territorios:     c.territorios || {}, hp: j.hp, armor: j.armor, wanted: j.procurado || 0, avatarId: j.avatarId,
    arma: Number.isInteger(j.arma) ? j.arma : 0,
    farm: farmStateFor(j)

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
function gerarFilhoServer(a, b) {
  const traits = {};
  for (const k of TRAIT_KEYS) {
    const media = ((a.t[k] || 0) + (b.t[k] || 0)) / 2;
    traits[k] = Math.round(num(media + (Math.random() < .12 ? (Math.random() < .5 ? 8 : -8) : 0), 0, 100, 50));
  }
  const rar = Math.random() < .08 ? 'hibrida' : (a.rar === b.rar ? a.rar : 'comum');
  return limparStrain({
    id: crypto.randomInt(1, 1e9), nome: str(a.nome + ' × ' + b.nome, 28),
    cor: Math.round((a.cor + b.cor) / 2), gen: Math.min(50, Math.max(a.gen, b.gen) + 1),
    auto: a.auto || b.auto, rar, t: traits
  });
}

/* ═════════ GEOMETRIA DO MUNDO NO SERVIDOR ═════════
   Até aqui o servidor só checava velocidade: um cliente modificado
   atravessava qualquer parede. Agora ele conhece a geometria.

   Estes retângulos foram EXTRAÍDOS do cliente em execução, não
   transcritos à mão — são exatamente os colisores que o jogador enfrenta.
   Formato: [minX, maxX, minZ, maxZ]. */

const COL_ESTATICOS = [
  [-26,10,-13.4,-12.7], [-25.4,-24.7,-13,0], [8.7,9.4,-13,0], [-25,3.2,-0.35,0.35],
  [3,3.75,-0.3,10.9], [8.7,9.4,0,10.5], [2.9,3.7,10.15,10.85], [6.3,9.5,10.15,10.85],
  [3.65,6.35,10.3,10.7], [-4.95,-3.05,-6.35,-4.45], [-8.8,-3,-12.9,-12.5], [-8.8,-8.4,-12.7,-8.4],
  [-3.4,-3,-12.7,-8.4], [-8.8,-6.5,-8.6,-8.2], [-5.3,-3,-8.6,-8.2], [3.82,4.08,-11.28,-11.02],
  [8.52,8.78,-11.28,-11.02], [3.82,4.08,-7.78,-7.52], [8.52,8.78,-7.78,-7.52], [3.85,8.75,-11.25,-11.01],
  [3.85,4.09,-11.15,-7.65], [8.51,8.75,-11.15,-7.65], [-15.3,-13.7,-9.3,-7.7], [5,9,-5.8,-5.4],
  [5.9,9,-0.6,-0.2], [5.35,5.75,-0.6,-0.2], [7.3,8.3,-4.4,-3.8], [-10.3,-8.9,-8.3,-7.3],
  [-11.81,-11.19,-6.51,-5.89], [-4.97,-4.23,-9.97,-9.23], [-8.4,-3,-12.7,-12.15], [-10.9,-10.1,-4.8,-4],
  [-59.65,-57.35,21.73,32.74], [-56.65,-54.35,23.5,36.49], [-59.65,-57.35,56.9,70.38], [-56.65,-54.35,56.31,68.84],
  [-59.65,-57.35,85.15,104.07], [-56.65,-54.35,85.13,104.13], [-59.65,-57.35,118.97,131.99], [-56.65,-54.35,120.75,134.93],
  [-11.65,1.65,121.4,133.35], [2.35,15.65,117.9,132.3], [26.35,37.65,121.23,135.74], [38.35,49.65,117.95,132.47],
  [58.35,65.65,23.01,38.2], [66.35,73.65,28.06,40.07], [58.35,65.65,56.19,72.05], [66.35,73.65,53.27,71.26],
  [58.35,65.65,89.04,100.97], [66.35,73.65,86.87,104.93], [58.35,65.65,123,135.47], [66.35,73.65,118.2,133.53],
  [-56.18,-55.82,19.8,20.2], [-42.18,-41.82,19.8,20.2], [-28.18,-27.82,19.8,20.2], [-14.18,-13.82,19.8,20.2],
  [-0.18,0.18,19.8,20.2], [13.82,14.18,19.8,20.2], [27.82,28.18,19.8,20.2], [41.82,42.18,19.8,20.2],
  [55.82,56.18,19.8,20.2], [69.82,70.18,19.8,20.2], [-56.18,-55.82,51.8,52.2], [-42.18,-41.82,51.8,52.2],
  [-28.18,-27.82,51.8,52.2], [-14.18,-13.82,51.8,52.2], [-0.18,0.18,51.8,52.2], [13.82,14.18,51.8,52.2],
  [27.82,28.18,51.8,52.2], [41.82,42.18,51.8,52.2], [55.82,56.18,51.8,52.2], [69.82,70.18,51.8,52.2],
  [-56.18,-55.82,83.8,84.2], [-42.18,-41.82,83.8,84.2], [-28.18,-27.82,83.8,84.2], [-14.18,-13.82,83.8,84.2],
  [-0.18,0.18,83.8,84.2], [13.82,14.18,83.8,84.2], [27.82,28.18,83.8,84.2], [41.82,42.18,83.8,84.2],
  [55.82,56.18,83.8,84.2], [69.82,70.18,83.8,84.2], [-56.18,-55.82,115.8,116.2], [-42.18,-41.82,115.8,116.2],
  [-28.18,-27.82,115.8,116.2], [-14.18,-13.82,115.8,116.2], [-0.18,0.18,115.8,116.2], [13.82,14.18,115.8,116.2],
  [27.82,28.18,115.8,116.2], [41.82,42.18,115.8,116.2], [55.82,56.18,115.8,116.2], [69.82,70.18,115.8,116.2],
  [-56.18,-55.82,147.8,148.2], [-42.18,-41.82,147.8,148.2], [-28.18,-27.82,147.8,148.2], [-14.18,-13.82,147.8,148.2],
  [-0.18,0.18,147.8,148.2], [13.82,14.18,147.8,148.2], [27.82,28.18,147.8,148.2], [41.82,42.18,147.8,148.2],
  [55.82,56.18,147.8,148.2], [69.82,70.18,147.8,148.2], [9.5,18.5,10.15,10.85], [11,11.4,13.4,13.8],
  [-1.9,-1.3,12.4,13], [-7.6,6.4,21,32], [7.4,21.4,21,32], [22.4,36.4,21,32],
  [-8.6,37.4,19.7,20.3], [-5.3,-4.7,171.7,172.3], [4.7,5.3,171.7,172.3], [-36.5,-31.5,189.5,194.5],
  // perímetro authoritative da fazenda; a abertura central do portão é
  // validada por conta no handler de movimento.
  [-46.3,-45.7,172,268], [45.7,46.3,172,268], [-46,46,267.7,268.3],
  [-46,-5,171.7,172.3], [5,46,171.7,172.3],
  // galpão: paredes laterais/norte e frente dividida por uma porta central.
  [-13.3,-12.7,246,258], [12.7,13.3,246,258], [-13,13,245.7,246.3],
  [-13,-1.6,257.7,258.3], [1.6,13,257.7,258.3],   [-53.05,-50.95,46.5,47.5], [52.95,55.05,136.5,137.5], [62.95,65.05,46.5,47.5],
  [-17.05,-14.95,110.5,111.5], [18.95,21.05,78.5,79.5], [20.95,23.05,116.5,117.5], [-17.05,-14.95,46.5,47.5],
  [54.95,57.05,78.5,79.5], [18.95,21.05,46.5,47.5], [-17.05,-14.95,78.5,79.5], [-20.9,-19.1,-9.9,-8.1],
  [-17.3,-15.7,-7,-6], [64.5,73.5,55.85,56.15], [64.5,73.5,63.85,64.15], [64.35,64.65,56,64],
  [69.5,73.1,56.4,59.6], [-1.6,-1.2,-11.3,-10.9], [1.4,1.8,-11.3,-10.9], [4,4.4,-11.3,-10.9],
  [-0.1,2.9,-11.85,-10.95], [-8.5,-6.3,-2.75,-1.65], [3.75,6.05,6.88,7.75]
];
// Divisórias dos seis setores: cada jogador só atravessa a própria porta.
for (const [sx, sz] of FARM_SLOT_SPOTS) {
  const x0 = sx - 12, x1 = sx + 12, z0 = sz - 14, z1 = sz + 14;
  COL_ESTATICOS.push([x0-.3,x0+.3,z0,z1], [x1-.3,x1+.3,z0,z1], [x0,x1,z1-.3,z1+.3],
    [x0,sx-1.6,z0-.3,z0+.3], [sx+1.6,x1,z0-.3,z0+.3]);
}

/* Colisores de cada propriedade, em coordenada RELATIVA ao centro do lote.
   O índice 5 é o portão: só bloqueia quando está fechado. */
const COL_LOTE_REL = [
  [-10.2,10.2,-8.2,-7.8], [-10.2,-9.8,-8.0,8.0], [9.8,10.2,-8.0,8.0], [1.2,10.2,7.8,8.2],
  [-10.2,-1.2,7.8,8.2], [-1.2,1.2,7.8,8.2], [1.9,2.1,-5.1,-1.7], [6.300000000000001,6.5,-5.1,-1.7],
  [2.0,6.4,-5.199999999999999,-5.0], [2.0,3.5,-1.8,-1.5999999999999999], [4.9,6.4,-1.8,-1.5999999999999999], [-7.85,-7.549999999999999,2.2,6.6000000000000005], [-1.6499999999999995,-1.3499999999999996,2.2,6.6000000000000005],
  [-7.699999999999999,-1.4999999999999996,2.0500000000000003,2.35], [-7.699999999999999,-5.3,6.45,6.750000000000001], [-3.8999999999999995,-1.4999999999999996,6.45,6.750000000000001], [5.5,8.1,3.1,4.1]
];
const IDX_PORTAO = 5;

/* Monta a lista viva de colisores: estáticos + os de cada propriedade.
   Recalculada quando um portão abre ou fecha. */
let colisores = [];
function reconstruirColisores() {
  colisores = COL_ESTATICOS.map(c => ({ x0: c[0], x1: c[1], z0: c[2], z1: c[3] }));
  for (const l of lotes) {
    for (let i = 0; i < COL_LOTE_REL.length; i++) {
      if (i === IDX_PORTAO && l.portaoAberto) continue;   // portão aberto não bloqueia
      const r = COL_LOTE_REL[i];
      colisores.push({ x0: l.x + r[0], x1: l.x + r[1], z0: l.z + r[2], z1: l.z + r[3] });
    }
  }
  // A área geral da fazenda é pública. A passagem pelos vãos dos setores é
  // validada no movimento para bloquear somente a entrada quando fechado;
  // quem já está dentro sempre consegue sair, evitando becos sem saída.
  // Não duplicamos o portão como colisor global: a regra é direcional e
  // depende da posição anterior do jogador.
}
function dentroDeParede(x, z, raio) {
  const r = raio || 0;
  for (let i = 0; i < colisores.length; i++) {
    const c = colisores[i];
    if (x + r > c.x0 && x - r < c.x1 && z + r > c.z0 && z - r < c.z1) return true;
  }
  return false;
}
/* Movimento com colisão, em SUB-PASSOS.
   Testar só o ponto final não funciona: as paredes têm 0,4m de espessura e
   um passo de 1,2m cai inteiro do outro lado sem nunca tocar nela. É o
   tunelamento clássico — o jogador atravessava o muro e o teste dizia que
   estava tudo bem. Aqui o trajeto é percorrido em fatias menores que a
   parede mais fina, e cada fatia é testada. */
const PASSO_MAX = .15;
function moverComColisao(x, z, nx, nz, raio) {
  const dx = nx - x, dz = nz - z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return { x, z };
  const n = Math.min(200, Math.max(1, Math.ceil(dist / PASSO_MAX)));
  let cx = x, cz = z;
  for (let i = 0; i < n; i++) {
    const tx = cx + dx / n, tz = cz + dz / n;
    if (!dentroDeParede(tx, tz, raio)) { cx = tx; cz = tz; continue; }
    // bateu: tenta deslizar em cada eixo, pra não encravar em quina
    if (!dentroDeParede(tx, cz, raio)) { cx = tx; continue; }
    if (!dentroDeParede(cx, tz, raio)) { cz = tz; continue; }
    break;
  }
  return { x: cx, z: cz };
}
/* LINHA DE VISÃO — o bot só enxerga (e atira) se não houver parede no
   caminho. Amostra o segmento em passos de 0,5m: barato e suficiente
   para retângulos deste tamanho. */
function temVisao(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d < .5) return true;
  const passos = Math.min(120, Math.ceil(d / .5));
  for (let i = 1; i < passos; i++) {
    const t = i / passos;
    if (dentroDeParede(ax + dx * t, az + dz * t, 0)) return false;
  }
  return true;
}

/* ───────── BOTS (rivais e polícia) ─────────
   Antes cada jogador rodava a própria cópia dos bots: dois jogadores lado a
   lado viam inimigos diferentes, e matar um não valia pro outro. Agora quem
   manda neles é o servidor, e todo mundo vê os MESMOS bots nos mesmos
   lugares. */
// Espelha o cliente. Movidos pras ruas: antes 9 de 10 lotes de jogador
// tinham território inimigo em cima, e os bots patrulhavam dentro da
// propriedade. Verificado por cálculo: 0 conflitos.
const TERRITORIOS = [
  { nome:'Beco do Mercado', x:-52, z:47, raio:6, demanda:1.0, renda:26 },
  { nome:'Praça da Torre', x:54, z:137, raio:6, demanda:1.25, renda:38 },
  { nome:'Vila Alta', x:64, z:47, raio:6, demanda:1.15, renda:34 },
  { nome:'Fundão', x:-16, z:111, raio:7, demanda:1.45, renda:52 },
  { nome:'Zona Nova', x:20, z:79, raio:7, demanda:1.6, renda:60 },
  { nome:'Alto da Torre', x:22, z:117, raio:7, demanda:1.5, renda:56 },
  { nome:'Boca do Rio', x:-16, z:47, raio:7, demanda:1.8, renda:78 },
  { nome:'Jardim Alvorada', x:56, z:79, raio:8, demanda:1.9, renda:84 },
  { nome:'Beira-Linha', x:20, z:47, raio:8, demanda:2.1, renda:96 },
  { nome:'Saída da BR', x:-16, z:79, raio:8, demanda:2.4, renda:120 }
];
function aplicarTerritoriosPersistidos(rows) {
  const escolhido = new Map();
  for (const row of rows || []) {
    let mapa = {};
    try { mapa = JSON.parse(row.territorios || '{}'); } catch (_) { mapa = {}; }
    const ts = Number(row.atualizado) || 0;
    for (const nome of Object.keys(mapa)) {
      if (!mapa[nome] || !TERRITORIOS.some(x => x.nome === nome)) continue;
      const anterior = escolhido.get(nome);
      if (!anterior || ts >= anterior.ts) escolhido.set(nome, { chave:row.chave, nome:row.nome, ts });
    }
  }
  for (const t of TERRITORIOS) {
    const dono = escolhido.get(t.nome);
    t.ownerKey = dono ? dono.chave : null;
    t.ownerNome = dono ? (nomeSeguro(dono.nome) || dono.chave) : null;
  }
}
function carregarTerritoriosPersistidos() {
  if (dbTipo === 'sqlite' && db) {
    const rows = db.prepare('SELECT chave,nome,territorios,atualizado FROM usuarios').all();
    aplicarTerritoriosPersistidos(rows); return Promise.resolve();
  }
  if (dbTipo === 'postgres' && pg) {
    return pg.query('SELECT chave,nome,territorios,atualizado FROM usuarios')
      .then(r => aplicarTerritoriosPersistidos(r.rows));
  }
  return Promise.resolve();
}
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
const PLOT_OFFSETS = [
  [-7,-4],[-4.6,-4],[-2.2,-4],[-7,-1.4],[-4.6,-1.4],[-2.2,-1.4],
  [3.2,-4.4],[5.2,-4.4],[3.2,-2.4],[5.2,-2.4],
  [-6.6,3.4],[-4.6,3.4],[-2.6,3.4],[-6.6,5.4],[-4.6,5.4],[-2.6,5.4]
];
function loteDoJogador(j) {
  if (!j.autenticado || !j.chave || !loteDe.has(j.chave)) return null;
  return lotes[loteDe.get(j.chave)] || null;
}
function posPlot(lote, plotIndex) {
  const o = PLOT_OFFSETS[plotIndex];
  return o ? { x: lote.x + o[0], z: lote.z + o[1] } : null;
}
function exigirPlotDoJogador(j, lote, plotIndex, raio = 4.5) {
  if (!lote || lote.donoChave !== j.chave) {
    enviar(j, { t: 'recusado', motivo: 'canteiro não pertence ao jogador' });
    metricas.rejeitadas++;
    return false;
  }
  const p = posPlot(lote, plotIndex);
  return !!p && exigirDistancia(j, p.x, p.z, raio, 'longe do canteiro');
}
const ESTACOES_PUBLICAS = {
  balcao: { x: 4.9, z: 7.3, raio: 3.2 },
  secagem: { x: 1.4, z: -11.4, raio: 3.2 }
};
function estacaoSecagemValida(j) {
  const lote = loteDoJogador(j);
  if (!lote || lote.donoChave !== j.chave) return false;
  return Math.hypot(j.x - (lote.x + 6.8), j.z - (lote.z + 3.6)) <= 3.2;
}
function encontrarPontoVenda(j) {
  let melhor = null, distancia = Infinity;
  for (const p of TERRITORIOS) {
    const d = Math.hypot(j.x - p.x, j.z - p.z);
    if (d <= 3.5 && d < distancia) { melhor = p; distancia = d; }
  }
  return melhor;
}
function validarContextoVenda(j, onde, clienteId) {
  if (onde === 'balcao') {
    const cliente = clienteParaVenda(j, clienteId);
    return cliente ? { tipo: 'balcao', demanda: cliente.mult, cliente } : null;
  }
  if (onde === 'ponto') {
    const p = encontrarPontoVenda(j);
    if (!p || p.ownerKey !== j.chave) return null;
    return { tipo: 'ponto', demanda: num(p.demanda, .6, 1.6, 1), cliente: null };
  }
  return null;
}
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
function jogadorEmCasaSegura(j) {
  return !!j && dentroDePropriedade(j.x, j.z) >= 0;
}
function limiteCasaSegura(j) {
  const i = j && dentroDePropriedade(j.x, j.z);
  return i >= 0 ? empurrarPraFora(j.x, j.z, i) : null;
}
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

const RUAS_Z_SRV = [15, 47, 79, 111, 143];
/* ═════════ F1 — FUNCIONÁRIOS COMO ENTIDADES DO MUNDO ═════════
   Antes o funcionário era um boneco local: o cliente descontava o próprio
   dinheiro e criava a malha 3D. O servidor não sabia que existia, então o
   jogador B via o quintal de A vazio — e um cliente modificado contratava
   de graça.

   Nesta F1 só a EXISTÊNCIA migra: catálogo, custo, ID, dono e envio por
   AOI. Movimento, tarefas e diária continuam onde estão — vêm nas
   próximas fases. */
const CAT_FUNC = Object.freeze(Object.assign(Object.create(null), {
  zelador:  { nome:'Nego Du',  papel:'Zelador',           custo:1200, diaria:45  },
  colhedor: { nome:'Val',      papel:'Colhedora',         custo:2200, diaria:70  },
  caseiro:  { nome:'Seu Bené', papel:'Caseiro da fazenda',custo:4800, diaria:130,
              bloqueado:'a fazenda ainda não existe no servidor' }
}));
const funcionarios = [];            // entidades vivas
const funcsDe = new Map();          // chave persistente -> [ids]

/* Reconexão não pode duplicar: os funcionários vivem por CHAVE, não por
   conexão. Ao voltar, o jogador reencontra os mesmos. */
function funcsDoJogador(chave) {
  if (!funcsDe.has(chave)) funcsDe.set(chave, []);
  return funcsDe.get(chave);
}
function resumoFunc(f) {
  return { id:f.id, cargo:f.cargo, nome:f.nome, loteIndex:f.loteIndex ?? null,
    farmSlotIndex:f.farmSlotIndex ?? null,
    x:+f.x.toFixed(2), z:+f.z.toFixed(2), ry:+f.ry.toFixed(3), estado:f.estado || 'parado' };
}
function localFuncionario(f) {
  if (f.cargo === 'caseiro') {
    const slot = farmSlots.find(s => s.ownerKey === f.dono);
    return slot ? { tipo:'fazenda', slot, plots:slot.plots } : null;
  }
  const lote = lotes.find(l => l.donoChave === f.dono);
  return lote ? { tipo:'lote', lote, plots:lote.plots } : null;
}
function restaurarFuncionarios(j, c) {
  const meus = funcsDoJogador(j.chave);
  const existentes = new Map();
  for (const id of meus) {
    const e = entidades.get(id);
    if (e && e.ref && !existentes.has(e.ref.cargo)) existentes.set(e.ref.cargo, e.ref);
  }
  const novosRegistros = [];
  const cargos = new Set();
  for (const registro of (Array.isArray(c.funcs) ? c.funcs : [])) {
    const cargo = typeof registro === 'string' ? str(registro, 16) : str(registro && registro.cargo, 16);
    const def = cargo && CAT_FUNC[cargo];
    if (!def || cargos.has(cargo)) continue;
    const trabalho = cargo === 'caseiro' ? localFuncionario({ cargo, dono:j.chave }) : null;
    let f = existentes.get(cargo);
    if (!f) {
      const sx = Number(registro && registro.x), sz = Number(registro && registro.z), sry = Number(registro && registro.ry);
      const base = trabalho && trabalho.tipo === 'fazenda'
        ? { x:trabalho.slot.x, z:trabalho.slot.z }
        : { x:j.x+1.5, z:j.z+1.5 };
      f = { cargo, nome:def.nome, dono:j.chave,
        loteIndex:cargo === 'caseiro' ? null : (loteDe.get(j.chave) ?? null),
        farmSlotIndex:trabalho && trabalho.tipo === 'fazenda' ? trabalho.slot.slotIndex : null,
        x:Number.isFinite(sx) ? sx : base.x, z:Number.isFinite(sz) ? sz : base.z,
        ry:Number.isFinite(sry) ? sry : 0, alvo:null, estado:str(registro && registro.estado, 16) || 'parado',
        proximaTarefa:agora()+5000 };
      const ent = registrar('fn', j.chave, f);
      f.id = ent.id; funcionarios.push(f); meus.push(ent.id);
    } else {
      f.loteIndex = cargo === 'caseiro' ? null : (loteDe.get(j.chave) ?? null);
      f.farmSlotIndex = trabalho && trabalho.tipo === 'fazenda' ? trabalho.slot.slotIndex : null;
      if (trabalho && trabalho.tipo === 'fazenda' &&
          (farmSetorEm(f.x, f.z)?.slotIndex !== trabalho.slot.slotIndex)) {
        // Caseiros antigos foram criados ao lado do jogador na cidade. Na
        // primeira reconexão após esta versão, entram no setor correto.
        f.x = trabalho.slot.x; f.z = trabalho.slot.z; f.alvo = null; f.estado = 'parado';
      }
    }
    cargos.add(cargo);
    novosRegistros.push({ id:f.id, cargo, loteIndex:f.loteIndex, farmSlotIndex:f.farmSlotIndex,
      x:f.x, z:f.z, ry:f.ry, estado:f.estado });
  }
  // Uma carteira antiga pode conter vários registros do mesmo cargo ou IDs
  // de um processo anterior. Persistimos uma entrada canônica por cargo.
  c.funcs = novosRegistros;
}
function passoFuncionario(f, dt) {
  const trabalho = localFuncionario(f);
  if (!trabalho) { f.estado = 'sem_lote'; return; }
  const c = carteiras.get(f.dono);
  let alvo = null;
  for (let i = 0; i < trabalho.plots.length; i++) {
    const plot = trabalho.plots[i], pl = plot && (trabalho.tipo === 'fazenda' ? plot.plant : plot);
    if (!pl || pl.estagio >= 4 && f.cargo !== 'colhedor') continue;
    const pos = trabalho.tipo === 'fazenda' ? { x:plot.x, z:plot.z } : posPlot(trabalho.lote, i);
    if (f.cargo === 'colhedor' && pl.estagio === 4) { alvo = { pl, plot, i, pos }; break; }
    if (f.cargo === 'zelador' && (pl.agua < .55 || pl.praga)) { alvo = { pl, plot, i, pos }; break; }
    if (f.cargo === 'caseiro' && (pl.agua < .55 || pl.praga)) { alvo = { pl, plot, i, pos }; break; }
  }
  if (!alvo) { f.alvo = null; f.estado = 'parado'; return; }
  f.alvo = alvo.i;
  const dx = alvo.pos.x - f.x, dz = alvo.pos.z - f.z, d = Math.hypot(dx, dz);
  if (d > .8) {
    const passo = Math.min(d, 2.4 * dt);
    const r = moverComColisao(f.x, f.z, f.x + dx / d * passo, f.z + dz / d * passo, .25);
    f.x = r.x; f.z = r.z; f.ry = Math.atan2(dx, dz); f.estado = 'indo'; return;
  }
  f.estado = 'trabalhando';
  if (agora() < (f.proximaTarefa || 0)) return;
  if (f.cargo === 'colhedor' && alvo.pl.estagio === 4) {
    if (c.estoque.length < c.rackMax) {
      const q = Math.max(2, Math.round((1.3 + alvo.pl.s.t.rendimento / 100 * 2.6) * alvo.pl.saude * 7 * (alvo.pl.s.auto ? .72 : 1) * (RAR_MULT[alvo.pl.s.rar] || 1)));
      c.estoque.push({ id: proxLoteId++, s: alvo.pl.s, qtd:q, estagio:'sec', qual:.55 + alvo.pl.saude * .45, desde:agora() });
      trabalho.lote.plots[alvo.i] = null; remover(alvo.pl.id);
      metricas.loteUpdates++;
      paraInteresse({ t:'lote_update', loteIndex:trabalho.lote.index, plotIndex:alvo.i, plot:null }, trabalho.lote.x, trabalho.lote.z, trabalho.lote.donoChave);
      for (const jogador of jogadores.values()) {
        if (jogador.chave !== f.dono || !jogador.autenticado) continue;
        enviar(jogador, { t:'colheita', plotIndex:alvo.i, qtd:q, strain:alvo.pl.s, por:'funcionario' });
        enviarEstado(jogador);
      }
      marcarSuja({ chave:f.dono });
    }
  } else if (f.cargo === 'zelador' || f.cargo === 'caseiro') {
    alvo.pl.agua = 1; alvo.pl.praga = 0;
    if (trabalho.tipo === 'fazenda') {
      trabalho.slot.updatedAt = agora();
      farmEnviarPlotUpdates(trabalho.slot, [{ localIndex:alvo.plot.localIndex, plot:farmPlotPublic(alvo.plot) }]);
      farmEnviarSlots();
      salvarFarmState();
    } else {
      metricas.loteUpdates++;
      paraInteresse({ t:'lote_update', loteIndex:trabalho.lote.index, plotIndex:alvo.i, plot:alvo.pl }, trabalho.lote.x, trabalho.lote.z, trabalho.lote.donoChave);
    }
    for (const jogador of jogadores.values()) {
      if (jogador.chave === f.dono && jogador.autenticado) enviarEstado(jogador);
    }
  }
  f.proximaTarefa = agora() + 2500;
}

/* ═════════ CLIENTES-NPC — entidade única do mundo ═════════
   O cliente não cria, move nem resolve compradores. Cada comprador nasce
   aqui, recebe ID, propriedade-alvo, rota e estado, e aparece nos snapshots. */
const CLIENTE_NOMES = ['Dona Cida','Seu Vado','Marlene','Juninho','Tia Rosa','Kelly','Rogério','Paty'];
const CLIENTE_DESEJOS = ['aroma','brilho','rendimento','resistencia','ritmo'];
const clientes = [];
let proxCliente = 1;
let clienteSpawnT = CLIENTE_FIRST_S;
function resumoCliente(c) {
  return { id:c.id, loteIndex:c.loteIndex, nome:c.nome,
    want:c.want, qtd:c.qtd, mult:+c.mult.toFixed(3), fala:c.fala,
    fase:c.fase, x:+c.x.toFixed(2), z:+c.z.toFixed(2),
    destX:+c.destX.toFixed(2), destZ:+c.destZ.toFixed(2), ry:+c.ry.toFixed(3) };
}
function spawnClienteServer(lote) {
  if (!lote || !lote.donoChave) return null;
  if (clientes.filter(c => c.loteIndex === lote.index && c.fase !== 'saindo').length >= 3) return null;
  const nome = CLIENTE_NOMES[Math.floor(Math.random() * CLIENTE_NOMES.length)];
  const want = CLIENTE_DESEJOS[Math.floor(Math.random() * CLIENTE_DESEJOS.length)];
  const gateX = lote.x, gateZ = lote.z + LOTE_D / 2 + 1.6;
  const c = { id:'cli_' + (proxCliente++), dono:lote.donoChave, loteIndex:lote.index,
    nome, want, qtd:5 + Math.floor(Math.random() * 12), mult:.95 + Math.random() * .55,
    fala:'quero uma que tenha ' + want + ' alto', fase:'esperando',
    x:gateX, z:gateZ, destX:gateX, destZ:gateZ, ry:0,
    criadoEm:agora(), esperaAte:agora() + 30000, vendeu:false,
    rota:[], rotaPos:0 };
  clientes.push(c);
  return c;
}
function rotaEntradaCliente(lote) {
  // O cliente precisa atravessar o vão central antes de virar para a
  // bancada. Uma linha direta da rua até a bancada encosta na parede frontal
  // porque o destino fica 6,8m para a direita do portão.
  return [
    { x:lote.x,     z:lote.z + LOTE_D / 2 - 1.2 },
    { x:lote.x + 4, z:lote.z + 6.0 },
    { x:lote.x + 6.8, z:lote.z + 3.6 }
  ];
}
function rotaSaidaCliente(lote) {
  return [
    { x:lote.x + 4, z:lote.z + 6.0 },
    { x:lote.x,     z:lote.z + LOTE_D / 2 - 1.2 },
    { x:lote.x,     z:lote.z + LOTE_D / 2 + 1.6 }
  ];
}
function atualizarRotaCliente(c) {
  while (c.rotaPos < c.rota.length) {
    const alvo = c.rota[c.rotaPos];
    if (Math.hypot(alvo.x - c.x, alvo.z - c.z) > .3) break;
    c.rotaPos++;
  }
  const alvo = c.rota[c.rotaPos];
  if (alvo) { c.destX = alvo.x; c.destZ = alvo.z; }
}
function passoCliente(c, dt) {
  const lote = lotes[c.loteIndex];
  if (!lote || lote.donoChave !== c.dono) { c.fase = 'saindo'; }
  const gateX = lote ? lote.x : c.x;
  const gateZ = lote ? lote.z + LOTE_D / 2 + 1.6 : c.z;
  if (c.fase === 'esperando') {
    if (lote && lote.portaoAberto) {
      c.fase = 'atendendo';
      c.rota = rotaEntradaCliente(lote); c.rotaPos = 0;
      c.esperaAte = agora() + 120000;
    } else if (agora() >= c.esperaAte) {
      c.fase = 'saindo'; c.destX = gateX; c.destZ = gateZ;
    }
  } else if (c.fase === 'atendendo' && agora() >= c.esperaAte) {
    c.fase = 'saindo'; c.rota = lote ? rotaSaidaCliente(lote) : []; c.rotaPos = 0;
  } else if (c.fase === 'saindo') {
    if (lote && !c.rota.length) { c.rota = rotaSaidaCliente(lote); c.rotaPos = 0; }
    if (!lote) { c.destX = gateX; c.destZ = gateZ; }
  }
  if (c.fase === 'atendendo' || c.fase === 'saindo') atualizarRotaCliente(c);
  const dx = c.destX - c.x, dz = c.destZ - c.z, d = Math.hypot(dx, dz);
  if (d > .18) {
    const passo = Math.min(d, 1.7 * dt);
    const r = moverComColisao(c.x, c.z, c.x + dx / d * passo, c.z + dz / d * passo, .25);
    c.x = r.x; c.z = r.z; c.ry = Math.atan2(dx, dz);
  }
  if (c.fase === 'saindo' && d <= .25 && (!lote || lote.portaoAberto)) c.removerEm = agora() + 1000;
}
function clienteParaVenda(j, id) {
  const c = clientes.find(x => x.id === String(id || '').slice(0, 24));
  if (!c || c.dono !== j.chave || c.fase !== 'atendendo' || c.vendeu) return null;
  const lote = lotes[c.loteIndex];
  if (!lote) return null;
  const perto = Math.hypot(j.x - c.x, j.z - c.z) <= 3.5 ||
    Math.hypot(j.x - (lote.x + 6.8), j.z - (lote.z + 3.6)) <= 3.5;
  return perto ? c : null;
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
const BOT_MEMORIA_MS = 5000;// perde o alvo depois de 5s sem enxergar
const RAIO_JOGADOR = .38;
const RAIO_BOT = .38;
/* polícia — agora vive AQUI, não mais no cliente */
const PM_VEL = 2.9, PM_VIDA = 90, PM_AGRO = 26, PM_ALCANCE = 22;
const PM_DANO = 11, PM_CADENCIA_MS = 1400;

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
// LOTE_SPOTS é definido depois da criação dos lotes, então as coordenadas
// são preenchidas aqui, antes de montar a geometria.
lotes.forEach((l, i) => { const p = LOTE_SPOTS[i]; if (p) { l.x = p[0]; l.z = p[1]; } });
reconstruirColisores();   // geometria pronta antes do primeiro tick

/* ═════ POLÍCIA NO SERVIDOR ═════
   Antes cada cliente criava a própria polícia: os outros jogadores viam
   você atirando no vazio. Agora ela é do servidor, como os rivais. */
function nascerPM(alvoJog) {
  // nasce longe, numa rua, fora de parede e fora de propriedade
  const zRua = RUAS_Z_SRV.reduce((a, b2) =>
    Math.abs(b2 - alvoJog.z) < Math.abs(a - alvoJog.z) ? b2 : a, RUAS_Z_SRV[0]);
  const lado = alvoJog.x > 0 ? -1 : 1;
  let x = Math.max(-58, Math.min(72, alvoJog.x + lado * (34 + Math.random() * 18)));
  let z = zRua;
  if (dentroDePropriedade(x, z) >= 0 || dentroDeParede(x, z, RAIO_BOT)) {
    x = alvoJog.x + lado * 40; z = zRua + 3;
  }
  const b = {
    id: 'p' + (proxBot++), tipo: 'pm', terr: -1,
    casaX: x, casaZ: z, x, z, ry: 0, hp: PM_VIDA,
    alvo: null, vagarT: 0, vagarX: x, vagarZ: z,
    ultimoTiro: 0, ultimoViu: 0, morreEm: agora() + 90000,
    // BUG CORRIGIDO: ela nascia a 45m e ficava patrulhando o ponto de
    // nascimento, porque o raio de visão é 26m — nunca chegava perto.
    // Agora leva o alvo da denúncia e vai atrás dele.
    cacando: alvoJog.id, destX: alvoJog.x, destZ: alvoJog.z
  };
  bots.push(b);
  paraInteresse({ t: 'sirene' }, alvoJog.x, alvoJog.z, alvoJog.chave);
  return b;
}
/* Tiro da polícia: só dispara com linha de visão livre. Isso acaba com o
   "atirando através do muro" que você relatou. */
function tiroPM(b) {
  const t = agora();
  if (t - b.ultimoTiro < PM_CADENCIA_MS) return;
  for (const [id, j] of jogadores) {
    if (jogadorEmCasaSegura(j)) continue; // a casa nunca recebe dano de PM
    const d = Math.hypot(j.x - b.x, j.z - b.z);
    if (d > PM_ALCANCE) continue;
    if (!temVisao(b.x, b.z, j.x, j.z)) continue;   // parede no caminho: não atira
    b.ultimoTiro = t;
    aplicarDanoJogador(j, PM_DANO, b.id);
    paraInteresse({ t: 'tiro_npc', id: b.id, ax: b.x, az: b.z, bx: j.x, bz: j.z }, j.x, j.z, j.chave);
    return;
  }
}
function passoBot(b, dt) {
  // procura o jogador mais perto dentro do raio de agressão
  // Se já está perseguindo, o raio é maior (só larga em BOT_DESISTE).
  // Se não está, precisa chegar perto (BOT_AGRO) pra começar.
  const ehPM = b.tipo === 'pm';
  const raioBase = ehPM ? PM_AGRO : BOT_AGRO;
  const raio = b.alvo ? (ehPM ? PM_AGRO + 10 : BOT_DESISTE) : raioBase;
  let maisPerto = null, melhor = raio;
  for (const [, j] of jogadores) {
    const limiteCasa = limiteCasaSegura(j);
    if (limiteCasa) {
      // A PM continua aparecendo e chega até a fronteira, mas não entra.
      if (!ehPM) continue;
      const dLimite = Math.hypot(limiteCasa.x - b.x, limiteCasa.z - b.z);
      if (dLimite < melhor) {
        melhor = dLimite;
        maisPerto = { id:j.id, x:limiteCasa.x, z:limiteCasa.z, _limiteCasa:true };
      }
      continue;
    }
    const d = Math.hypot(j.x - b.x, j.z - b.z);
    if (d >= melhor) continue;
    // LINHA DE VISÃO: sem enxergar, não persegue nem atira.
    if (!temVisao(b.x, b.z, j.x, j.z)) continue;
    melhor = d; maisPerto = j;
  }
  const agoraMs = agora();
  if (maisPerto) {
    b.ultimoViu = agoraMs;
    b.ultAlvoX = maisPerto.x; b.ultAlvoZ = maisPerto.z;
  } else if (ehPM && b.cacando && !b.alvo) {
    // indo até a denúncia: atualiza o destino enquanto o procurado se move
    const alvoJ = [...jogadores.values()].find(x => x.id === b.cacando);
    if (alvoJ) { b.destX = alvoJ.x; b.destZ = alvoJ.z; }
    maisPerto = { id: b.cacando, x: b.destX, z: b.destZ, _indo: true };
  } else if (b.alvo && agoraMs - (b.ultimoViu || 0) < BOT_MEMORIA_MS) {
    // MEMÓRIA CURTA: perdeu de vista mas ainda vai até onde viu por último.
    // Depois de 5s sem enxergar, desiste — é o que permite dobrar a esquina.
    maisPerto = { id: b.alvo, x: b.ultAlvoX, z: b.ultAlvoZ, _memoria: true };
  }
  // polícia não fica presa ao território; rival sim
  if (maisPerto && !ehPM) {
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
    const passoTotal = (b.tipo === 'pm' ? PM_VEL : BOT_VEL) * dt;
    const n = Math.max(1, Math.ceil(passoTotal / .4));
    for (let k = 0; k < n; k++) {
      const nx = b.x + dx / d * (passoTotal / n);
      const nz = b.z + dz / d * (passoTotal / n);
      const li = dentroDePropriedade(nx, nz);
      if (li >= 0) {
        const fora = empurrarPraFora(nx, nz, li);
        b.x = fora.x; b.z = fora.z;
        break;
      }
      // colisão com a geometria: desliza na parede em vez de atravessar
      const r = moverComColisao(b.x, b.z, nx, nz, RAIO_BOT);
      if (r.x === b.x && r.z === b.z) break;   // encravou: para aqui
      b.x = r.x; b.z = r.z;
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
const posicoesRetomada = new Map(); // chave -> {x,y,z,ry,expira}
let proxId = 1;
let tickAtual = 0;
const metricas = { msgRecebidas: 0, msgEnviadas: 0, descartadas: 0, rejeitadas: 0,
  snapshots: 0, loteUpdates: 0, tickMaxMs: 0, desdeT: agora() };
const gradeJogadores = new Map();
const chaveGrade = (x, z) => Math.floor(x / GRADE_CELULA) + ':' + Math.floor(z / GRADE_CELULA);
function reconstruirGradeJogadores() {
  gradeJogadores.clear();
  for (const j of jogadores.values()) {
    if (!j.autenticado) continue;
    const k = chaveGrade(j.x, j.z);
    const lista = gradeJogadores.get(k);
    if (lista) lista.push(j); else gradeJogadores.set(k, [j]);
  }
}
function jogadoresNaArea(x, z, raio = AOI_RAIO) {
  const out = [];
  const minX = Math.floor((x - raio) / GRADE_CELULA);
  const maxX = Math.floor((x + raio) / GRADE_CELULA);
  const minZ = Math.floor((z - raio) / GRADE_CELULA);
  const maxZ = Math.floor((z + raio) / GRADE_CELULA);
  for (let gx = minX; gx <= maxX; gx++) for (let gz = minZ; gz <= maxZ; gz++) {
    const lista = gradeJogadores.get(gx + ':' + gz); if (!lista) continue;
    for (const j of lista) if (Math.hypot(j.x - x, j.z - z) <= raio) out.push(j);
  }
  return out;
}
const gradeDinamicos = new Map();
function reconstruirGradeDinamicos() {
  gradeDinamicos.clear();
  const adicionar = (tipo, ref) => {
    if (!ref || (tipo === 'bot' && ref.hp <= 0)) return;
    const k = chaveGrade(ref.x, ref.z);
    const lista = gradeDinamicos.get(k);
    const item = { tipo, ref };
    if (lista) lista.push(item); else gradeDinamicos.set(k, [item]);
  };
  for (const b of bots) adicionar('bot', b);
  for (const f of funcionarios) adicionar('func', f);
  for (const c of clientes) if (c.fase !== 'saindo' || !c.removerEm) adicionar('cliente', c);
}
function dinamicosNaArea(x, z, raio = AOI_RAIO) {
  const out = [];
  const minX = Math.floor((x - raio) / GRADE_CELULA);
  const maxX = Math.floor((x + raio) / GRADE_CELULA);
  const minZ = Math.floor((z - raio) / GRADE_CELULA);
  const maxZ = Math.floor((z + raio) / GRADE_CELULA);
  for (let gx = minX; gx <= maxX; gx++) for (let gz = minZ; gz <= maxZ; gz++) {
    const lista = gradeDinamicos.get(gx + ':' + gz); if (!lista) continue;
    for (const item of lista) if (Math.hypot(item.ref.x - x, item.ref.z - z) <= raio) out.push(item);
  }
  return out;
}

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm'
});
function caminhoPublico(url) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url || '/', 'http://localhost').pathname); }
  catch (_) { return null; }
  const relativo = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const absoluto = path.resolve(PUBLIC_DIR, relativo);
  if (absoluto !== PUBLIC_DIR && !absoluto.startsWith(PUBLIC_DIR + path.sep)) return null;
  return absoluto;
}
function servirArquivoPublico(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('method not allowed');
    return;
  }
  const arquivo = caminhoPublico(req.url);
  if (!arquivo) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }
  fs.stat(arquivo, (erro, info) => {
    if (erro || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(arquivo).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(arquivo);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let pathname = '/';
  try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (_) { pathname = ''; }
  if (pathname === '/metrics') {
    const dt = (agora() - metricas.desdeT) / 1000;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jogadores: jogadores.size,
      tick: tickAtual,
      tickHz: TICK_HZ,
      msgRecebidasPorSeg: +(metricas.msgRecebidas / dt).toFixed(1),
      msgEnviadasPorSeg: +(metricas.msgEnviadas / dt).toFixed(1),
      rejeitadas: metricas.rejeitadas,
      descartadasPorBackpressure: metricas.descartadas,
      snapshots: metricas.snapshots,
      loteUpdates: metricas.loteUpdates,
      tickMaxMs: +metricas.tickMaxMs.toFixed(2),
      lotesOcupados: lotes.filter(l => l.donoChave).length,
      uptimeSeg: Math.round(process.uptime()),
      memoriaMB: +(process.memoryUsage().rss / 1048576).toFixed(1),
      banco: dbTipo,
      carteirasSalvas: carteiras.size
    }, null, 2));
    return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, tick: tickAtual, banco: dbTipo }));
    return;
  }
  servirArquivoPublico(req, res);
});

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

function enviarSerializado(j, payload) {
  if (!j || !j.ws || j.ws.readyState !== 1) return false;
  // Um cliente lento não pode fazer a fila de saída crescer sem limite.
  // Snapshots são descartáveis: o próximo já contém estado mais recente.
  if (j.ws.bufferedAmount > WS_BUFFER_LIMITE) {
    metricas.descartadas++;
    return false;
  }
  try { j.ws.send(payload); metricas.msgEnviadas++; return true; } catch (e) { return false; }
}
function enviar(j, obj) {
  let payload;
  try { payload = typeof obj === 'string' ? obj : JSON.stringify(obj); } catch (_) { return false; }
  return enviarSerializado(j, payload);
}
function paraTodos(obj, exceto) {
  let payload; try { payload = JSON.stringify(obj); } catch (_) { return; }
  for (const [id, j] of jogadores) {
    if (id === exceto) continue;
    enviarSerializado(j, payload);
  }
}
function paraInteresse(obj, x, z, donoChave = null, exceto = null) {
  let payload; try { payload = JSON.stringify(obj); } catch (_) { return; }
  // O dono sempre recebe o evento, mesmo que esteja ligeiramente fora do AOI.
  const enviados = new Set();
  for (const j of jogadoresNaArea(x, z)) {
    if (j.id !== exceto && !enviados.has(j.id)) {
      enviados.add(j.id); enviarSerializado(j, payload);
    }
  }
  if (donoChave) for (const j of jogadores.values()) {
    if (j.id !== exceto && j.chave === donoChave && !enviados.has(j.id)) {
      enviados.add(j.id); enviarSerializado(j, payload);
    }
  }
}
function resumoLote(l, incluirPlots = false) {
  return { index: l.index, id: l.id, x: l.x, z: l.z, portaoId: l.portaoId,
    donoNome: l.donoNome, donoId: l.donoChave || null, portaoAberto: l.portaoAberto,
    tipos: TIPO_PLOT, plots: incluirPlots ? l.plots : [] };
}

function normalizarUsuario(v) {
  const u = String(v == null ? '' : v).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{2,23}$/.test(u) ? u : null;
}
function senhaValida(v) {
  return typeof v === 'string' && v.length >= AUTH_PASS_MIN && v.length <= AUTH_PASS_MAX;
}
function criarHashSenha(senha, salt) {
  return crypto.pbkdf2Sync(senha, salt, 120000, 32, 'sha256').toString('hex');
}
function senhaConfere(senha, salt, esperado) {
  if (!senhaValida(senha) || typeof salt !== 'string' || typeof esperado !== 'string') return false;
  const atual = Buffer.from(criarHashSenha(senha, salt), 'hex');
  const alvo = Buffer.from(esperado, 'hex');
  return atual.length === alvo.length && crypto.timingSafeEqual(atual, alvo);
}
function contaRow(row) {
  return row && row.usuario && row.chave ? {
    usuario: String(row.usuario), chave: String(row.chave), nome: nomeSeguro(row.nome),
    senhaSalt: String(row.senha_salt || ''), senhaHash: String(row.senha_hash || '')
  } : null;
}
function carregarContaUsuario(usuario) {
  if (dbTipo !== 'sqlite' || !db) return null;
  try { return contaRow(db.prepare('SELECT usuario,chave,nome,senha_salt,senha_hash FROM contas WHERE usuario = ?').get(usuario)); }
  catch (e) { console.error('erro ao ler conta:', e.message); return null; }
}
async function carregarContaUsuarioAsync(usuario) {
  if (dbTipo !== 'postgres' || !pg) return null;
  try {
    const r = await pg.query('SELECT usuario,chave,nome,senha_salt,senha_hash FROM contas WHERE usuario = $1', [usuario]);
    return contaRow(r.rows[0]);
  } catch (e) { console.error('erro ao ler conta (pg):', e.message); return null; }
}
async function criarConta(usuario, nome, senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = criarHashSenha(senha, salt);
  const chave = novaIdentidade();
  const agoraConta = Date.now();
  try {
    if (dbTipo === 'sqlite' && db) {
      db.prepare(`INSERT INTO contas (usuario,chave,nome,senha_salt,senha_hash,criado,atualizado)
        VALUES (?,?,?,?,?,?,?)`).run(usuario, chave, nome, salt, hash, agoraConta, agoraConta);
    } else if (dbTipo === 'postgres' && pg) {
      await pg.query(`INSERT INTO contas (usuario,chave,nome,senha_salt,senha_hash,criado,atualizado)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [usuario, chave, nome, salt, hash, agoraConta, agoraConta]);
    } else return null;
    return { usuario, chave, nome, senhaSalt:salt, senhaHash:hash };
  } catch (e) {
    if (!/unique|duplicate|constraint/i.test(e.message || '')) console.error('erro ao criar conta:', e.message);
    return null;
  }
}
function sessaoJaConectada(chave, idAtual) {
  for (const [oid, outro] of jogadores) {
    if (oid !== idAtual && outro.autenticado && outro.chave === chave) return true;
  }
  return false;
}
async function ativarSessao(j, chave, dados = {}) {
  if (!chave || sessaoJaConectada(chave, j.id)) {
    enviar(j, { t: dados.falhaAuth ? 'auth_error' : 'recusado', motivo: 'esta conta já está conectada em outro lugar' });
    metricas.rejeitadas++;
    return false;
  }
  j.chave = chave;
  j.autenticado = true;
  j.aparelho = str(dados.aparelhoId, 40) || null;
  j.fundador = ehFundador(j);
  if (dados.nome) j.nome = nomeSeguro(dados.nome) || j.nome;
  j.avatarId = avatarCatalogado(dados.avatarId || j.avatarId);
  enviar(j, { t: 'sessao', token: emitirToken(j.chave), persistId: j.chave,
    conta: dados.usuario ? { usuario:dados.usuario, nome:j.nome } : null });
  // A carteira é carregada antes do spawn, inclusive no Postgres assíncrono.
  const k = j.chave;
  if (dbTipo === 'postgres' && !carteiras.has(k)) {
    const salva = await carregarCarteiraAsync(k);
    if (salva) carteiras.set(k, salva);
  }
  const c = sincronizarEquipamento(j);
  let farmSlot = farmSlotDoJogador(j);
  // Compatibilidade com contas antigas que compraram o imóvel global Fazenda:
  // migra uma única vez para um setor individual sem cobrar novamente. Contas
  // novas, mesmo no nível 12, precisam comprar um lote explicitamente.
  if (!farmSlot && c.imoveis && c.imoveis.includes('fazenda')) farmSlot = atribuirFarmSlot(j, c);
  const retomada = consumirPosicaoRetomada(j.chave) || posicaoCarteira(c);
  const idx = atribuirLote(j.chave, j.nome);
  const loteInicial = idx !== null ? lotes[idx] : null;
  const spawn = retomada || (loteInicial ? {
    x: loteInicial.x, y: 0, z: loteInicial.z + LOTE_D / 2 - 3.2, ry: 0
  } : spawnOficial(j));
  j.x = spawn.x; j.y = 0; j.z = spawn.z; j.ry = spawn.ry || 0;
  j.vy = 0; j.onGround = true; j.ultimoMov = agora() - 250; j.posIniciada = true;
  enviar(j, { t: 'lote_atribuido', loteIndex: idx, retomada: !!retomada,
    posicao: { x:j.x, y:j.y, z:j.z, ry:j.ry }, lote: loteInicial ? resumoLote(loteInicial, true) : null,
    farm: farmSlot ? farmSlotPublic(farmSlot, true) : null,
    farmTables: farmSlot ? farmTables.filter(t => t.farmSlotIndex === farmSlot.slotIndex).map(farmTablePublic) : [] });
  paraTodos({ t: 'nome', id:j.id, nome:j.nome, avatarId:j.avatarId }, j.id);
  for (const nomeTerr of Object.keys(c.territorios || {})) {
    const terr = TERRITORIOS.find(x => x.nome === nomeTerr);
    if (terr && (!terr.ownerKey || terr.ownerKey === j.chave)) {
      terr.ownerKey = j.chave; terr.ownerNome = j.nome;
    }
  }
  restaurarFuncionarios(j, c);
  j.carteiraPronta = true;
  if (!c._iniciado) {
    c._iniciado = true;
    const semBase = sementeCatalogada(dados.sementeBase) || CATALOGO_SEMENTES[0];
    bankAdd(c, semBase, 2);
    salvarCarteira(k);
  }
  enviarEstado(j);
  if (j.fundador) enviar(j, { t: 'fundador', ok: true });
  return true;
}

wss.on('connection', (ws, req) => {
  if (!bancoPronto) { ws.close(1013, 'persistência inicializando'); return; }
  if (jogadores.size >= MAX_CONEXOES) {
    ws.close(1013, 'servidor cheio');
    return;
  }
  const id = String(proxId++);
  const j = {
    id, ws,
    nome: 'Jogador' + id,
    chave: null,
    x: 0, y: 0, z: 0, ry: 0, arma: 0, avatarId: 'carmo',
    hp: 100, armor: 0, procurado: 0, morto: false, respawnEm: 0,
    armas: { pistola: true },
    municao: { pistola: { pente: 12, reserva: 24 } },
    ultimoTiro: 0, ultimoCrime: 0,
    lotesVisiveis: new Set(),
    posIniciada: false, autenticado: false, helloRecebido: false, carteiraPronta: false,
    ultimoInputSeq: 0,
    vy: 0, onGround: true,
    ultimoMov: agora(),
    vivo: true, ultimoPong: agora(),
    tokens: RATE_BURST, ultimaRecarga: agora(),
    entrouEm: agora()
  };
  jogadores.set(id, j);

  enviar(j, {
    t: 'welcome', id, tick: tickAtual, tickHz: TICK_HZ,
    lotes: lotes.map(resumoLote),
    territorios: TERRITORIOS.map(t => ({ nome:t.nome, x:t.x, z:t.z, raio:t.raio,
      demanda:t.demanda, donoChave:t.ownerKey || null, donoNome:t.ownerNome || null })),
    farms: farmSlots.map(s => farmSlotPublic(s, false)),
    farmTables: farmTables.map(farmTablePublic)
  });
  paraTodos({ t: 'join', id, nome: j.nome, avatarId: j.avatarId }, id);

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
    if (!j.autenticado && !['hello','pong','auth_login','auth_register'].includes(m.t)) {
      enviar(j, { t: 'recusado', motivo: 'hello necessário antes desta ação' });
      metricas.rejeitadas++;
      return;
    }

    switch (m.t) {
      case 'pong':
        j.ultimoPong = t; j.vivo = true;
        break;

      case 'hello': {
        if (!bancoPronto || dbTipo === 'indisponivel') {
          enviar(j, { t:'recusado', motivo:'persistência indisponível — tente novamente' });
          metricas.rejeitadas++;
          try { j.ws.close(1013, 'persistência indisponível'); } catch (_) {}
          break;
        }
        if (j.autenticado) {
          enviar(j, { t: 'recusado', motivo: 'hello já recebido' });
          metricas.rejeitadas++;
          break;
        }
        j.helloRecebido = true;
        const token = str(m.token, 512);
        let chave = validarToken(token);
        if (token && !chave) {
          enviar(j, { t: 'login_required', motivo: 'sessão inválida ou expirada — entre com sua conta' });
          metricas.rejeitadas++;
          break;
        }
        // Produção não cria mais jogador anônimo: sem conta ou token válido,
        // o cliente deve registrar/entrar para que a progressão seja recuperável.
        if (!chave && !ALLOW_ANONYMOUS) {
          enviar(j, { t: 'login_required', motivo: 'crie uma conta ou entre para jogar' });
          break;
        }
        // O fallback anônimo existe apenas para os testes automatizados locais.
        if (!chave) chave = novaIdentidade();
        if (chave) {
          (async () => {
            await ativarSessao(j, chave, { aparelhoId:m.aparelhoId, nome:m.nome, avatarId:m.avatarId,
              sementeBase:m.sementeBase });
          })().catch(e => {
            console.error('erro ao ativar sessão:', e.message);
            enviar(j, { t:'auth_error', motivo:'não foi possível carregar sua conta' });
          });
        }
        break;
      }

      case 'auth_register': {
        if (!j.helloRecebido || j.autenticado) {
          enviar(j, { t:'auth_error', motivo:'abra uma nova conexão para entrar' });
          break;
        }
        if (dbTipo === 'memoria') {
          enviar(j, { t:'auth_error', motivo:'login exige banco persistente configurado' });
          break;
        }
        const usuario = normalizarUsuario(m.usuario);
        const senha = typeof m.senha === 'string' ? m.senha : '';
        const nome = nomeSeguro(m.nome) || (usuario ? usuario.slice(0, 18) : 'Jogador');
        if (!usuario || !senhaValida(senha)) {
          enviar(j, { t:'auth_error', motivo:'usuário: 3–24 letras/números; senha: 8–128 caracteres' });
          break;
        }
        (async () => {
          const conta = await criarConta(usuario, nome, senha);
          if (!conta) {
            enviar(j, { t:'auth_error', motivo:'usuário já existe ou não foi possível criar a conta' });
            return;
          }
          enviar(j, { t:'auth_ok', usuario:conta.usuario, nome:conta.nome, novo:true });
          await ativarSessao(j, conta.chave, { usuario:conta.usuario, nome:conta.nome,
            aparelhoId:m.aparelhoId, avatarId:m.avatarId, sementeBase:m.sementeBase, falhaAuth:true });
        })().catch(e => {
          console.error('erro no cadastro:', e.message);
          enviar(j, { t:'auth_error', motivo:'não foi possível criar a conta' });
        });
        break;
      }

      case 'auth_login': {
        if (!j.helloRecebido || j.autenticado) {
          enviar(j, { t:'auth_error', motivo:'abra uma nova conexão para entrar' });
          break;
        }
        const usuario = normalizarUsuario(m.usuario);
        const senha = typeof m.senha === 'string' ? m.senha : '';
        if (!usuario || !senhaValida(senha)) {
          enviar(j, { t:'auth_error', motivo:'usuário ou senha inválidos' });
          break;
        }
        (async () => {
          const conta = dbTipo === 'postgres' ? await carregarContaUsuarioAsync(usuario) : carregarContaUsuario(usuario);
          if (!conta || !senhaConfere(senha, conta.senhaSalt, conta.senhaHash)) {
            enviar(j, { t:'auth_error', motivo:'usuário ou senha inválidos' });
            return;
          }
          enviar(j, { t:'auth_ok', usuario:conta.usuario, nome:conta.nome, novo:false });
          await ativarSessao(j, conta.chave, { usuario:conta.usuario, nome:conta.nome,
            aparelhoId:m.aparelhoId, avatarId:m.avatarId, sementeBase:m.sementeBase, falhaAuth:true });
        })().catch(e => {
          console.error('erro no login:', e.message);
          enviar(j, { t:'auth_error', motivo:'não foi possível entrar agora' });
        });
        break;
      }

      case 'nome': {
        j.nome = nomeSeguro(m.nome) || j.nome;
        if (j.chave && loteDe.has(j.chave)) lotes[loteDe.get(j.chave)].donoNome = j.nome;
        if (j.chave && farmSlotDe.has(j.chave)) { const fs = farmSlots[farmSlotDe.get(j.chave)]; if (fs) { fs.ownerName = j.nome; fs.updatedAt = agora(); salvarFarmState(); farmEnviarSlots(); } }
        marcarSuja(j);
        paraTodos({ t: 'nome', id, nome: j.nome, avatarId: j.avatarId }, id);
        break;
      }

      case 'avatar': {
        if (!exigirHandshake(j)) return;
        const c = carteiraDe(j);
        c.avatarId = avatarCatalogado(m.avatarId);
        j.avatarId = c.avatarId;
        marcarSuja(j);
        paraTodos({ t: 'nome', id, nome: j.nome, avatarId: j.avatarId }, id);
        break;
      }

      case 'input': {
        // movimento com checagem de velocidade — anti-teleporte
        if (!j.autenticado || j.morto) return;
        const nx = num(m.x, -2000, 2000, j.x);
        const nz = num(m.z, -2000, 2000, j.z);
        const inputSeq = Number.isSafeInteger(Number(m.seq)) ? Math.max(0, Math.min(1e9, Number(m.seq))) : 0;
        if (inputSeq) j.ultimoInputSeq = Math.max(j.ultimoInputSeq || 0, inputSeq);
        /* O cliente envia posição prevista e intenção de salto. A altura
           oficial nunca vem do cliente: ela é integrada aqui, com gravidade,
           chão e um único salto por toque. */
        const dtMov = Math.min(.25, Math.max(.001, (t - j.ultimoMov) / 1000));
        if (m.salto === true && j.onGround) {
          j.vy = 4.9;
          j.onGround = false;
        }
        j.vy = Math.max(-20, j.vy - 15 * dtMov);
        const yAuthoritative = Math.max(0, j.y + j.vy * dtMov);
        if (yAuthoritative <= 0) {
          j.y = 0; j.vy = 0; j.onGround = true;
        } else {
          j.y = Math.min(3.5, yAuthoritative); j.onGround = false;
        }
        if (!j.posIniciada) {
          enviar(j, { t: 'recusado', motivo: 'lote ainda não atribuído' });
          metricas.rejeitadas++;
          return;
        }
        const dist = Math.hypot(nx - j.x, nz - j.z);
        const limite = VEL_MAX * dtMov + 2;   // folga pra lag
        if (dist > limite) {
          metricas.rejeitadas++;
          enviar(j, { t: 'correcao', seq: inputSeq, x: j.x, y: j.y, z: j.z });
        } else {
          // COLISÃO NO SERVIDOR: antes só a velocidade era checada, então
          // um cliente modificado atravessava qualquer parede. Agora o
          // servidor recusa a travessia e devolve a posição válida.
          const r = moverComColisao(j.x, j.z, nx, nz, RAIO_JOGADOR);
          // A fazenda inteira, fora dos setores privados, é uma área pública.
          // O portão externo não é um bloqueio de compra: a compra libera os
          // canteiros e a operação econômica, não a caminhada pelo espaço.
          const setor = farmSetorEm(r.x, r.z);
          const setorAnterior = farmSetorEm(j.x, j.z);
          if (setor && setor !== setorAnterior && !setor.portaoAberto) {
            r.x = j.x; r.z = j.z;
            enviar(j, { t:'recusado', motivo:'este setor está fechado' });
            metricas.rejeitadas++;
          }
          if (Math.hypot(r.x - nx, r.z - nz) > .25) {
            metricas.rejeitadas++;
            enviar(j, { t: 'correcao', seq: inputSeq, x: r.x, y: j.y, z: r.z });
          }
          j.x = r.x; j.z = r.z;
        }
        const yEnviado = num(m.y, 0, 20, 0);
        if (Math.abs(yEnviado - j.y) > .55) {
          metricas.rejeitadas++;
          enviar(j, { t: 'correcao', seq: inputSeq, x: j.x, y: j.y, z: j.z });
        }
        j.ry = num(m.ry, -Math.PI * 4, Math.PI * 4, j.ry);
        const armaSolicitada = ARMA_INDEX[num(m.arma, 0, ARMA_INDEX.length - 1, 0) | 0];
        j.arma = (armaSolicitada && (armaSolicitada === 'punho' || j.armas[armaSolicitada]))
          ? ARMA_INDEX.indexOf(armaSolicitada) : 0;
        j.ultimoMov = t;
        break;
      }

      case 'farm_plantar': {
        farmPlantar(j, m);
        break;
      }

      case 'farm_colher': {
        farmColher(j, m);
        break;
      }

      case 'farm_regar': {
        farmRegar(j, m);
        break;
      }

      case 'farm_job': {
        farmIniciarJob(j, m);
        break;
      }

      case 'plantar': {
        if (!exigirJogadorVivo(j)) return;
        const lote = loteDoJogador(j);
        const pi = num(m.plot, 0, PLOTS_POR_LOTE - 1, -1) | 0;
        if (!exigirPlotDoJogador(j, lote, pi)) return;
        if (pi < 0 || lote.plots[pi]) return;
        const c = sincronizarEquipamento(j);
        const seedId = num(m.seedId, 0, 1e9, -1) | 0;
        let entrada = seedId >= 0 ? c.bank.find(e => e.s && e.s.id === seedId) : null;
        if (!entrada && m.strain) {
          const informada = limparStrain(m.strain);
          if (informada) entrada = c.bank.find(e => e.s && e.s.id === informada.id);
        }
        if (!entrada || !entrada.qtd || entrada.qtd < 1) {
          enviar(j, { t: 'recusado', motivo: 'semente não pertence ao jogador' });
          metricas.rejeitadas++; return;
        }
        const s = limparStrain(entrada.s);
        if (!s || !bankTirar(c, s.id, 1)) { metricas.rejeitadas++; return; }
        // A planta vira entidade com ID e dono.
        const novaPl = { s, prog: 0, agua: 1, saude: 1, praga: 0, estagio: 0, adubOrg:0, adubCres:0, adubFlor:false };
        const entPl = registrar('pl', j.chave || j.id, novaPl);
        novaPl.id = entPl.id;
        novaPl.loteIndex = lote.index;
        novaPl.plotIndex = pi;
        lote.plots[pi] = novaPl;
        const ev = { t: 'lote_update', loteIndex: lote.index, plotIndex: pi, plot: lote.plots[pi] };
        metricas.loteUpdates++;
        paraInteresse(ev, lote.x, lote.z, lote.donoChave);
        enviarEstado(j);
        break;
      }

      case 'regar': {
        if (!exigirJogadorVivo(j)) return;
        // ETAPA C — caminho novo: id de entidade, com dono validado.
        if (m.id) {
          const ent = entidadeDoJogador(j, m.id, 'pl');
          if (!ent) return;
          const p2 = ent.ref;
          const lote2 = lotes[p2.loteIndex];
          if (!exigirPlotDoJogador(j, lote2, p2.plotIndex)) return;
          p2.agua = 1; p2.praga = 0;
          const ev2 = { t: 'lote_update', loteIndex: p2.loteIndex, plotIndex: p2.plotIndex, plot: p2 };
          metricas.loteUpdates++;
          paraInteresse(ev2, lote2.x, lote2.z, lote2.donoChave);
          return;
        }
        // caminho antigo (índice) — mantido temporariamente, com a mesma
        // autorização e proximidade do caminho por ID.
        if (!exigirHandshake(j)) return;
        const lote = loteDoJogador(j);
        const pi = num(m.plot, 0, PLOTS_POR_LOTE - 1, -1) | 0;
        if (!exigirPlotDoJogador(j, lote, pi)) return;
        const pl = lote && lote.plots[pi];
        if (!pl) return;
        pl.agua = 1; pl.praga = 0;
        const ev = { t: 'lote_update', loteIndex: lote.index, plotIndex: pi, plot: pl };
        metricas.loteUpdates++;
        paraInteresse(ev, lote.x, lote.z, lote.donoChave);
        break;
      }

      /* ═════ ETAPA B — dinheiro, sementes e estoque ═════ */
      case 'adubo': {
        if (!exigirJogadorVivo(j)) return;
        const lote = loteDoJogador(j);
        const pi = num(m.plot, 0, PLOTS_POR_LOTE - 1, -1) | 0;
        if (!exigirPlotDoJogador(j, lote, pi)) return;
        const p = lote && lote.plots[pi];
        const k = str(m.k, 16);
        const c = sincronizarEquipamento(j);
        if (!p || !p.s || !(k in CAT_ADUBO) || !(Number(c.fert && c.fert[k]) > 0)) {
          enviar(j, { t:'recusado', motivo:'planta ou adubo inválido' });
          metricas.rejeitadas++; return;
        }
        const spot = posPlot(lote, pi);
        if (!spot || !exigirDistancia(j, spot.x, spot.z, 3.2, 'longe do canteiro')) return;
        if (p.estagio === 4) { enviar(j, { t:'recusado', motivo:'planta já está pronta' }); metricas.rejeitadas++; return; }
        if (k === 'organico') {
          if (Number(p.adubOrg) > 0) { enviar(j, { t:'recusado', motivo:'adubo orgânico já aplicado' }); metricas.rejeitadas++; return; }
          p.saude = Math.min(1, Number(p.saude) + .35); p.praga = 0; p.adubOrg = 90;
        } else if (k === 'crescimento') {
          if (Number(p.adubCres) > 0) { enviar(j, { t:'recusado', motivo:'adubo de crescimento ainda ativo' }); metricas.rejeitadas++; return; }
          p.adubCres = 100;
        } else {
          if (p.adubFlor) { enviar(j, { t:'recusado', motivo:'booster já aplicado' }); metricas.rejeitadas++; return; }
          p.adubFlor = true;
        }
        c.fert[k] = Math.max(0, Number(c.fert[k]) - 1);
        const ev = { t:'lote_update', loteIndex:lote.index, plotIndex:pi, plot:p };
        metricas.loteUpdates++; paraInteresse(ev, lote.x, lote.z, lote.donoChave); marcarSuja(j);
        enviar(j, { t:'adubo_ok', k, plot:pi }); enviarEstado(j); break;
      }

      case 'comprar': {
        if (!exigirJogadorVivo(j)) return;
        const c = carteiraDe(j);
        const oq = str(m.oq, 16);
        let custo = 0, aplicar = null;

        if (oq === 'semente') {
          // O cliente escolhe apenas uma semente do catálogo visual. A genética
          // completa é conferida aqui; atributos inventados nunca entram na
          // carteira e não podem ser propagados por plantio/cruzamento.
          const sem = sementeCatalogada(m.strain);
          if (!sem) {
            enviar(j, { t:'recusado', motivo:'semente fora do catálogo' });
            metricas.rejeitadas++; return;
          }
          custo = precoSemente(sem);
          // o fenótipo é sorteado AQUI: o cliente não escolhe a raridade
          const r = Math.random();
          const rar = r < .06 ? 'hibrida' : r < .20 ? 'laranja' : r < .38 ? 'roxa' : 'comum';
          const filho = Object.assign({}, sem, { id: crypto.randomInt(1, 1e9), rar });
          aplicar = () => bankAdd(c, filho, 1);
        } else if (oq === 'upg') {
          const k = str(m.k, 12);
          if (!(k in CAT_UPG) || c.up[k]) {
            enviar(j, { t:'recusado', motivo:'catálogo inválido ou melhoria já ativa' });
            metricas.rejeitadas++; return;
          }
          custo = CAT_UPG[k];
          aplicar = () => { c.up[k] = true; if (k === 'rack') c.rackMax = 10; };
        } else if (oq === 'adubo') {
          const k = str(m.k, 12);
          if (!(k in CAT_ADUBO)) {
            enviar(j, { t:'recusado', motivo:'adubo fora do catálogo' });
            metricas.rejeitadas++; return;
          }
          custo = CAT_ADUBO[k];
          aplicar = () => { c.fert = c.fert || {}; c.fert[k] = (c.fert[k] || 0) + 1; };
        } else if (oq === 'arma') {
          const k = str(m.k, 12);
          if (!(k in CAT_ARMA) || k === 'punho') {
            enviar(j, { t:'recusado', motivo:'arma fora do catálogo' });
            metricas.rejeitadas++; return;
          }
          if (c.armas[k]) {
            const pacote = CAT_MUNICAO[k];
            if (!pacote) { metricas.rejeitadas++; return; }
            custo = pacote.custo;
            aplicar = () => {
              c.municao[k] = c.municao[k] || { pente: 0, reserva: 0 };
              c.municao[k].reserva += pacote.qtd;
            };
          } else {
            custo = CAT_ARMA[k];
            aplicar = () => {
              c.armas[k] = true;
              c.municao[k] = { pente: CAT_ARMA_ESTADO[k].mag, reserva: CAT_ARMA_ESTADO[k].reserva };
            };
          }
        } else if (oq === 'colete') {
          if ((c.armor || 0) >= 100) { metricas.rejeitadas++; return; }
          custo = CUSTO_COLETE;
          aplicar = () => { c.armor = 100; j.armor = 100; };
        } else { metricas.rejeitadas++; return; }

        if (!Number.isFinite(custo) || custo < 0 || !Number.isFinite(c.cash)) {
          enviar(j, { t:'recusado', motivo:'catálogo inválido' });
          metricas.rejeitadas++; return;
        }
        if (c.cash < custo) { enviar(j, { t: 'recusado', motivo: 'sem dinheiro' }); return; }
        c.cash -= custo;
        aplicar();
        enviarEstado(j);
        break;
      }

      case 'cruzar': {
        if (!exigirJogadorVivo(j)) return;
        const c = carteiraDe(j);
        const idA = num(m.a, 0, 1e9, -1), idB = num(m.b, 0, 1e9, -1);
        if (idA < 0 || idB < 0) { metricas.rejeitadas++; return; }
        const ea = c.bank.find(x => x.s.id === idA), eb = c.bank.find(x => x.s.id === idB);
        if (!ea || !eb) { enviar(j, { t: 'recusado', motivo: 'sem essas sementes' }); return; }
        if (c.cash < CUSTO_CRUZAR) { enviar(j, { t: 'recusado', motivo: 'sem dinheiro' }); return; }
        if (idA === idB && ea.qtd < 2) {
          enviar(j, { t: 'recusado', motivo: 'são necessárias duas sementes' });
          metricas.rejeitadas++; return;
        }
        if (!bankTirar(c, idA, 1) || !bankTirar(c, idB, 1)) {
          enviar(j, { t: 'recusado', motivo: 'sementes insuficientes' });
          metricas.rejeitadas++; return;
        }
        const filho = gerarFilhoServer(ea.s, eb.s);
        c.cash -= CUSTO_CRUZAR;
        bankAdd(c, filho, 2);
        enviar(j, { t:'cruzamento_ok', filho });
        enviarEstado(j);
        break;
      }

      case 'colher_local': {
        // Desativado até que todos os canteiros sejam entidades server-side.
        // Nunca aceitar genética, saúde ou quantidade como prova de colheita.
        enviar(j, { t: 'recusado', motivo: 'canteiro ainda não está sincronizado' });
        metricas.rejeitadas++;
        return;
      }

      case 'estoque_add': {
        // Só entra estoque quando o SERVIDOR colheu. Ver caso 'colher':
        // ele chama isto internamente. Pedido direto do cliente é recusado.
        metricas.rejeitadas++;
        return;
      }

      case 'lote_estagio': {
        if (!exigirJogadorVivo(j)) return;
        // O cronômetro visual é do cliente, mas o estágio OFICIAL é daqui.
        // Confere também se o jogador está numa estação válida.
        if (!estacaoSecagemValida(j)) {
          enviar(j, { t: 'recusado', motivo: 'fora da estação de secagem/cura' });
          metricas.rejeitadas++; return;
        }
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
        if (!exigirJogadorVivo(j)) return;
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
        const onde = str(m.onde, 8);
        const contexto = validarContextoVenda(j, onde, m.clienteId);
        if (!contexto) {
          enviar(j, { t: 'recusado', motivo: 'fora do local de venda' });
          metricas.rejeitadas++; return;
        }
        const rm = RAR_MULT[lote.s.rar] || 1;
        const dem = contexto.demanda;
        const base = contexto.tipo === 'ponto'
          ? (22 + traitAvg(lote.s) * .55 + lote.s.gen * 6)
          : (16 + traitAvg(lote.s) * .42 + lote.s.gen * 4);
        const valor = Math.round(base * q * lote.qual * rm * dem);
        lote.qtd -= q;
        if (lote.qtd <= 0) c.estoque.splice(c.estoque.indexOf(lote), 1);
        c.cash += valor;
        darXP(j, Math.max(1, Math.round(valor / (contexto.tipo === 'ponto' ? 10 : 12))));
        if (contexto.tipo === 'ponto') {
          const p = encontrarPontoVenda(j);
          if (p) p.demanda = Math.max(.6, p.demanda - .12);
        }
        if (contexto.cliente) {
          contexto.cliente.vendeu = true;
          contexto.cliente.fase = 'saindo';
          const rotaSaida = rotaSaidaCliente(lotes[contexto.cliente.loteIndex]);
          contexto.cliente.rota = rotaSaida;
          contexto.cliente.rotaPos = 0;
          contexto.cliente.destX = rotaSaida[0].x;
          contexto.cliente.destZ = rotaSaida[0].z;
          contexto.cliente.esperaAte = agora();
          paraInteresse({ t: 'cliente_vendeu', id: contexto.cliente.id, qtd: q, valor }, contexto.cliente.x, contexto.cliente.z, contexto.cliente.dono);
        }
        const pontoConfirmado = contexto.tipo === 'ponto' ? encontrarPontoVenda(j) : null;
        enviar(j, { t:'venda_ok', valor, qtd:q, estoqueId:id,
          onde:contexto.tipo, clienteId:contexto.cliente ? contexto.cliente.id : null,
          pontoNome:pontoConfirmado ? pontoConfirmado.nome : null,
          demanda:pontoConfirmado ? pontoConfirmado.demanda : null });
        enviarEstado(j);
        break;
      }

      case 'comprar_farm_lote': {
        if (!exigirJogadorVivo(j)) return;
        const c = sincronizarEquipamento(j);
        const slotIndex = num(m.slotIndex, 0, FARM_MAX_PLAYERS - 1, -1) | 0;
        const slot = farmSlots[slotIndex];
        if (!slot) { enviar(j, { t:'recusado', motivo:'lote da fazenda inválido' }); metricas.rejeitadas++; return; }
        if (Number(c.nivel) < 10) {
          enviar(j, { t:'recusado', motivo:'o lote da fazenda libera no nível 10' }); metricas.rejeitadas++; return;
        }
        if (farmSlotDoJogador(j)) {
          enviar(j, { t:'recusado', motivo:'você já possui um lote da fazenda' }); metricas.rejeitadas++; return;
        }
        if (slot.ownerKey) {
          enviar(j, { t:'recusado', motivo:'este lote da fazenda já foi vendido' }); metricas.rejeitadas++; return;
        }
        if (!exigirDistancia(j, slot.x, slot.z - 14, 4.5, 'longe da porteira do lote')) return;
        const custo = FARM_LOT_PRICES[slotIndex];
        if (!Number.isFinite(custo) || c.cash < custo) {
          enviar(j, { t:'recusado', motivo:'sem dinheiro para este lote' }); metricas.rejeitadas++; return;
        }
        c.cash -= custo;
        slot.ownerKey = j.chave; slot.ownerName = j.nome;
        slot.unlockedAt = agora(); slot.updatedAt = slot.unlockedAt;
        slot.plots.forEach(p => { p.ownerKey = j.chave; });
        farmSlotDe.set(j.chave, slot.slotIndex);
        const ep = entidades.get(slot.portaoId); if (ep) ep.dono = j.chave;
        salvarFarmState();
        farmEnviarSlots();
        enviar(j, { t:'farm_lote_comprado', slot:farmSlotPublic(slot, true), valor:custo });
        enviarEstado(j);
        break;
      }

      case 'comprar_imovel': {
        if (!exigirJogadorVivo(j)) return;
        const c = sincronizarEquipamento(j);
        const k = str(m.k, 16);
        const def = CAT_IMOVEIS[k];
        if (!def || c.imoveis.includes(k)) { metricas.rejeitadas++; return; }
        if (c.nivel < def.nivel) {
          enviar(j, { t: 'recusado', motivo: 'nível insuficiente' }); metricas.rejeitadas++; return;
        }
        if (!exigirDistancia(j, def.x, def.z, 3.5, 'longe do imóvel')) return;
        if (c.cash < def.custo) {
          enviar(j, { t: 'recusado', motivo: 'sem dinheiro' }); metricas.rejeitadas++; return;
        }
        c.cash -= def.custo;
        c.imoveis.push(k);
        enviar(j, { t: 'imovel_comprado', k });
        enviarEstado(j);
        break;
      }

      case 'capturar_territorio': {
        if (!exigirJogadorVivo(j)) return;
        const nome = str(m.nome, 40);
        const p = TERRITORIOS.find(x => x.nome === nome);
        if (!p || p.ownerKey === j.chave) { metricas.rejeitadas++; return; }
        if (!exigirDistancia(j, p.x, p.z, p.raio + 2.2, 'longe do território')) return;
        const antigo = p.ownerKey;
        if (antigo && antigo !== j.chave) {
          const carteiraAntiga = carteiras.get(antigo);
          if (carteiraAntiga && carteiraAntiga.territorios) delete carteiraAntiga.territorios[p.nome];
          if (carteiraAntiga) marcarSuja({ chave: antigo });
        }
        p.ownerKey = j.chave;
        p.ownerNome = j.nome;
        p.demanda = Math.max(.6, p.demanda || 1);
        const c = sincronizarEquipamento(j);
        c.territorios[p.nome] = true;
        darXP(j, 220);
        paraTodos({ t: 'territorio_estado', nome:p.nome, dono:j.nome, donoChave:j.chave });
        enviarEstado(j);
        break;
      }

      case 'contratar_func': {
        if (!exigirJogadorVivo(j)) return;
        /* F1 — o SERVIDOR contrata. O cliente só pede o cargo: preço,
           saldo, ID e dono são decididos aqui. Um cliente modificado não
           consegue escolher preço nem criar funcionário por conta. */
        const chave = j.chave || j.id;
        const cargo = str(m.cargo, 16);
        const def = CAT_FUNC[cargo];
        if (!def) { enviar(j, { t:'recusado', motivo:'cargo inválido' });
          metricas.rejeitadas++; return; }
        const c = carteiraDe(j);
        if (cargo === 'caseiro' && !farmSlotDoJogador(j)) {
          enviar(j, { t:'recusado', motivo:'compre um lote da fazenda primeiro' }); return;
        }
        const meus = funcsDoJogador(chave);
        if (meus.some(id => {
          const e = entidades.get(id); return e && e.ref && e.ref.cargo === cargo;
        })) { enviar(j, { t:'recusado', motivo:'já contratado' }); return; }

        if (c.cash < def.custo) {
          enviar(j, { t:'recusado', motivo:'sem dinheiro' }); return; }
        c.cash -= def.custo;

        // O caseiro nasce dentro do setor da fazenda; os demais funcionários
        // continuam nascendo junto ao lote urbano do proprietário.
        const farmTrabalho = cargo === 'caseiro' ? farmSlots.find(s => s.ownerKey === chave) : null;
        let fx = farmTrabalho ? farmTrabalho.x : j.x + 1.5;
        let fz = farmTrabalho ? farmTrabalho.z : j.z + 1.5;
        if (!farmTrabalho && dentroDeParede(fx, fz, RAIO_BOT)) { fx = j.x; fz = j.z; }
        const novo = { cargo, nome:def.nome, dono:chave,
          loteIndex:farmTrabalho ? null : (loteDe.get(chave) ?? null),
          farmSlotIndex:farmTrabalho ? farmTrabalho.slotIndex : null,
          x:fx, z:fz, ry:0, alvo:null, estado:'parado' };
        const ent = registrar('fn', chave, novo);
        novo.id = ent.id;
        funcionarios.push(novo);
        meus.push(ent.id);
        c.funcs.push({ id:ent.id, cargo });
        marcarSuja(j);

        enviar(j, { t:'func_contratado', func: resumoFunc(novo) });
        enviarEstado(j);
        break;
      }

      case 'portao': {
        if (!exigirJogadorVivo(j)) return;
        /* A entidade pode ser um portão urbano ou o portão privado de um
           setor da fazenda. Em ambos os casos só o proprietário altera o
           estado; a colisão authoritative é reconstruída imediatamente. */
        const ent = entidadeDoJogador(j, m.id, 'pt');
        if (!ent) return;
        const alvo = ent.ref;
        const eLote = lotes.includes(alvo);
        const eFarm = farmSlots.includes(alvo);
        const px = eFarm ? alvo.x : alvo.x;
        const pz = eFarm ? alvo.z - 14 : alvo.z + LOTE_D / 2;
        if (!exigirDistancia(j, px, pz, 4.5, 'longe do portão')) return;
        alvo.portaoAberto = !alvo.portaoAberto;
        reconstruirColisores();
        if (eFarm) {
          alvo.updatedAt = agora();
          salvarFarmState();
          enviarEstado(j);
          const evento = { t:'portao_estado', id:ent.id, farmSlotIndex:alvo.slotIndex,
            aberto:alvo.portaoAberto };
          paraTodos(evento);
          farmEnviarSlots();
        } else if (eLote) {
          const evento = { t:'portao_estado', id:ent.id, loteIndex:alvo.index,
            aberto:alvo.portaoAberto };
          paraTodos(evento);
          enviar(j, evento);
        }
        break;
      }

      case 'crime': {
        if (!exigirJogadorVivo(j)) return;
        // O aviso é rate-limited e o peso é fixo; o cliente não escolhe
        // quantas unidades de procurado quer gerar nem pode spammar polícia.
        if (t - j.ultimoCrime < 1200) { metricas.rejeitadas++; return; }
        j.ultimoCrime = t;
        j.procurado = Math.min(5, (j.procurado || 0) + 1);
        j.crimeEm = agora();
        const jaTem = bots.filter(b => b.tipo === 'pm' && b.hp > 0).length;
        if (jaTem < 2 + j.procurado) nascerPM(j);
        enviar(j, { t: 'procurado', nivel: j.procurado });
        break;
      }

      case 'recarregar': {
        if (!exigirHandshake(j) || j.morto) return;
        const chaveArma = ARMA_INDEX[j.arma] || 'punho';
        const arma = CAT_ARMA_ESTADO[chaveArma];
        const c = sincronizarEquipamento(j);
        const mun = c.municao[chaveArma];
        if (!arma || chaveArma === 'punho' || !c.armas[chaveArma] || !mun) return;
        const falta = Math.max(0, arma.mag - mun.pente);
        const n = Math.min(falta, Math.max(0, mun.reserva));
        if (n <= 0) return;
        mun.pente += n; mun.reserva -= n;
        enviarEstado(j);
        break;
      }

      case 'tiro_bot': {
        if (!exigirJogadorVivo(j)) return;
        // O cliente só informa a intenção e o alvo visual. Arma, dano,
        // cadência e munição pertencem ao servidor.
        if (!exigirHandshake(j) || !j.vivo) return;
        const chaveArma = ARMA_INDEX[j.arma] || 'punho';
        const arma = CAT_ARMA_ESTADO[chaveArma];
        const cArma = sincronizarEquipamento(j);
        if (!arma || chaveArma === 'punho' || !j.armas[chaveArma]) {
          enviar(j, { t: 'recusado', motivo: 'arma não equipada' });
          metricas.rejeitadas++; return;
        }
        const agoraTiro = agora();
        if (agoraTiro - j.ultimoTiro < arma.rate * 1000) {
          metricas.rejeitadas++; return;
        }
        const mun = j.municao[chaveArma];
        if (!mun || mun.pente <= 0) {
          enviar(j, { t: 'recusado', motivo: 'sem munição' });
          metricas.rejeitadas++; return;
        }
        const b = bots.find(x => x.id === String(m.bot).slice(0, 12));
        if (!b || b.hp <= 0) return;
        if (Math.hypot(b.x - j.x, b.z - j.z) > arma.alcance) { metricas.rejeitadas++; return; }
        if (!temVisao(j.x, j.z, b.x, b.z)) { metricas.rejeitadas++; return; }
        mun.pente--;
        j.ultimoTiro = agoraTiro;
        const dano = arma.dano;
        b.hp -= dano;
        if (b.hp <= 0) {
          b.hp = 0;
          darXP(j, 80);
          paraInteresse({ t: 'bot_morreu', id: b.id, porQuem: j.nome }, b.x, b.z);
          // renasce depois de um tempo, no próprio ponto
          setTimeout(() => {
            b.x = b.casaX; b.z = b.casaZ; b.hp = BOT_VIDA; b.alvo = null;
            paraInteresse({ t: 'bot_nasceu', id: b.id }, b.x, b.z);
          }, 25000);
        } else {
          paraInteresse({ t: 'bot_dano', id: b.id, hp: b.hp }, b.x, b.z);
        }
        enviarEstado(j);
        break;
      }
      case 'colher': {
        if (!exigirJogadorVivo(j)) return;
        // ETAPA C — caminho novo por id de entidade
        if (m.id) {
          const ent = entidadeDoJogador(j, m.id, 'pl');
          if (!ent) return;
          const p2 = ent.ref;
          const lote2 = lotes[p2.loteIndex];
          if (!exigirPlotDoJogador(j, lote2, p2.plotIndex)) return;
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
          metricas.loteUpdates++;
          paraInteresse(ev2, lote2.x, lote2.z, lote2.donoChave);
          c2.estoque.push({ id: proxLoteId++, s: p2.s, qtd: q2, estagio: 'sec',
            qual: .55 + p2.saude * .45, desde: agora() });
          enviar(j, { t: 'colheita', plotIndex: p2.plotIndex, qtd: q2, strain: p2.s });
          enviarEstado(j);
          return;
        }
        if (!exigirHandshake(j)) return;
        const lote = loteDoJogador(j);
        const pi = num(m.plot, 0, PLOTS_POR_LOTE - 1, -1) | 0;
        if (!exigirPlotDoJogador(j, lote, pi)) return;
        const pl = lote && lote.plots[pi];
        if (!pl || pl.estagio !== 4) return;
        const autoPen = pl.s.auto ? .72 : 1;
        const rm = RAR_MULT[pl.s.rar] || 1;
        const q = Math.max(2, Math.round(
          (1.3 + pl.s.t.rendimento / 100 * 2.6) * pl.saude * 7 * autoPen * rm));
        const c = carteiraDe(j);
        if (c.estoque.length >= c.rackMax) {
          enviar(j, { t: 'recusado', motivo: 'bancada cheia' }); return;
        }
        lote.plots[pi] = null;
        const ev = { t: 'lote_update', loteIndex: lote.index, plotIndex: pi, plot: null };
        metricas.loteUpdates++;
        paraInteresse(ev, lote.x, lote.z, lote.donoChave);
        c.estoque.push({ id: proxLoteId++, s: pl.s, qtd:q, estagio:'sec',
          qual:.55 + pl.saude * .45, desde:agora() });
        enviar(j, { t: 'colheita', plotIndex: pi, qtd: q, qual: .55 + pl.saude * .45, strain: pl.s });
        enviarEstado(j);
        break;
      }

      default:
        metricas.rejeitadas++;
    }
  });

  ws.on('close', () => {
    // grava na saída: é o momento mais provável de perder progresso
    try {
      const k = j.chave || j.id;
      if (j.autenticado && j.chave && j.posIniciada && !j.morto) {
        copiarPosicaoParaCarteira(j);
      }
      if (carteiras.has(k)) salvarCarteira(k);
      if (j.autenticado && j.chave && j.posIniciada && !j.morto) {
        posicoesRetomada.set(j.chave, {
          x:j.x, y:j.y, z:j.z, ry:j.ry, expira:agora()+RETOMADA_POS_MS
        });
      }
    } catch (e) {}
    jogadores.delete(id); paraTodos({ t: 'leave', id });
  });
  ws.on('error', () => {});
});

/* ───────── tick fixo: um snapshot por tick, só de quem está perto ───────── */
setInterval(() => {
  const tickInicio = performance.now();
  tickAtual++;
  const agoraTick = agora();
  for (const [chave, p] of posicoesRetomada) if (p.expira <= agoraTick) posicoesRetomada.delete(chave);
  const dtTick = TICK_MS / 1000;
  clienteSpawnT -= dtTick;
  if (clienteSpawnT <= 0) {
    clienteSpawnT = CLIENTE_MIN_S + Math.random() * (CLIENTE_MAX_S - CLIENTE_MIN_S);
    const donos = lotes.filter(l => l.donoChave);
    if (donos.length) {
      // Não sorteia sempre a mesma casa: primeiro atende o lote que está
      // sem cliente ativo. Assim cada propriedade tem fluxo próprio e uma
      // casa não fica invisível enquanto outra recebe todos os compradores.
      const semCliente = donos.filter(l => !clientes.some(c =>
        c.loteIndex === l.index && c.fase !== 'saindo' && !c.removerEm));
      const fila = semCliente.length ? semCliente : donos;
      spawnClienteServer(fila[Math.floor(Math.random() * fila.length)]);
    }
  }
  for (let i = clientes.length - 1; i >= 0; i--) {
    passoCliente(clientes[i], dtTick);
    if (clientes[i].removerEm && agora() >= clientes[i].removerEm) clientes.splice(i, 1);
  }
  if (jogadores.size) for (const b of bots) if (b.hp > 0) {
    passoBot(b, dtTick);
    if (b.tipo === 'pm' && b.alvo) tiroPM(b);
  }
  for (const f of funcionarios) passoFuncionario(f, dtTick);
  farmProcessarMesas();
  // polícia tem prazo: some sozinha depois de um tempo
  for (let i = bots.length - 1; i >= 0; i--) {
    const b = bots[i];
    if (b.tipo === 'pm' && b.morreEm && agora() > b.morreEm) {
      const alvo = b.cacando && jogadores.get(b.cacando);
      if (alvo && alvo.procurado > 0 && !alvo.morto) {
        // A viatura não some enquanto o mandado continua ativo. Ela só
        // deixa o mundo quando o procurado não precisa mais ser perseguido.
        b.morreEm = agora() + 90000;
      } else {
        bots.splice(i, 1);
        paraInteresse({ t: 'bot_morreu', id: b.id, porQuem: null }, b.x, b.z);
      }
    }
  }
  reconstruirGradeJogadores();
  reconstruirGradeDinamicos();
  for (const [id, j] of jogadores) {
    if (j.ws.bufferedAmount > WS_BUFFER_LIMITE) {
      metricas.descartadas++;
      continue; // o próximo snapshot substitui este
    }
    if (j.morto && agora() >= j.respawnEm) {
      const p = spawnOficial(j);
      j.x = p.x; j.y = 0; j.z = p.z; j.vy = 0; j.onGround = true; j.hp = 100; j.armor = 0;
      j.morto = false; j.vivo = true; j.ultimoMov = agora() - 250; j.posIniciada = true;
      const c = sincronizarEquipamento(j); c.armor = 0;
      enviar(j, { t:'respawn', x:j.x, y:j.y, z:j.z, hp:j.hp, armor:j.armor });
      enviarEstado(j);
    }
    const perto = [];
    for (const o of jogadoresNaArea(j.x, j.z)) {
      if (o.id === id) continue;
      perto.push({
        id: o.id, nome: o.nome,
        x: +o.x.toFixed(2), y: +o.y.toFixed(2),
        z: +o.z.toFixed(2), ry: +o.ry.toFixed(3), arma: o.arma,
        avatarId: o.avatarId, hp: o.hp, morto: !!o.morto
      });
    }
    const botsPerto = [], funcsPerto = [], clientesPerto = [];
    for (const item of dinamicosNaArea(j.x, j.z)) {
      if (item.tipo === 'bot') {
        const b = item.ref;
        botsPerto.push({ id: b.id, tipo: b.tipo, x: +b.x.toFixed(2),
          z: +b.z.toFixed(2), ry: +b.ry.toFixed(3), hp: b.hp, agro: !!b.alvo });
      } else if (item.tipo === 'func') {
        funcsPerto.push(resumoFunc(item.ref));
      } else {
        clientesPerto.push(resumoCliente(item.ref));
      }
    }
    // Dados de plantas só são enviados quando o jogador entra no AOI do lote.
    // O handshake nunca deve revelar todas as plantas privadas do mundo.
    const lotesNovos = [];
    for (const l of lotes) {
      const perto = Math.hypot(l.x - j.x, l.z - j.z) <= AOI_RAIO;
      if (perto && !j.lotesVisiveis.has(l.index)) {
        j.lotesVisiveis.add(l.index);
        lotesNovos.push(resumoLote(l, true));
      } else if (!perto) {
        j.lotesVisiveis.delete(l.index);
      }
    }
    metricas.snapshots++;
    const farmsPerto = farmSlots.filter(s => Math.hypot(j.x - s.x, j.z - s.z) <= AOI_RAIO)
      .map(s => farmSlotPublic(s, true));
    const minhaFarmSlot = farmSlotDe.has(j.chave) ? farmSlotDe.get(j.chave) : null;
    const minhasMesas = minhaFarmSlot === null ? [] : farmTables
      .filter(t => t.farmSlotIndex === minhaFarmSlot).map(farmTablePublic);
    enviar(j, { t: 'snap', tick: tickAtual, players: perto, bots: botsPerto,
      funcs: funcsPerto, clientes: clientesPerto, lotes: lotesNovos,
      farms: farmsPerto, farmTables: minhasMesas });
  }
  metricas.tickMaxMs = Math.max(metricas.tickMaxMs, performance.now() - tickInicio);
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
  const avancou = dt * (1440 / DAYLEN);
  const relogioAntes = relogio;
  relogio = (relogio + avancou) % 1440;
  if (relogioAntes + avancou >= 1440) aplicarDiariaServidor();
  for (const lote of lotes) {
    const updates = [];
    for (let i = 0; i < lote.plots.length; i++) {
      const pl = lote.plots[i];
      if (!pl) continue;
      const dono = lote.donoChave ? carteiras.get(lote.donoChave) : null;
      const mudouEstagio = crescer(pl, dt, relogio, TIPO_PLOT[i], dono ? dono.up : null);
      const mudouProg = Math.abs(pl.prog - (pl._ultProg ?? -99)) >= 0.7;
      const mudouAgua = Math.abs(pl.agua - (pl._ultAgua ?? -99)) >= 0.05;
      if (mudouEstagio || mudouProg || mudouAgua) {
        pl._ultProg = pl.prog;
        pl._ultAgua = pl.agua;
        updates.push({ plotIndex: i, plot: pl });
      }
    }
    if (updates.length) {
      metricas.loteUpdates += updates.length;
      // Um pacote por lote substitui dezenas de broadcasts e mantém o
      // progresso contínuo sem inundar sockets que nem estão na área.
      paraInteresse({ t: 'lotes_update', loteIndex: lote.index, updates }, lote.x, lote.z, lote.donoChave);
    }
  }
  for (const slot of farmSlots) {
    if (!slot.ownerKey) continue;
    const c = carteiras.get(slot.ownerKey), updates = [];
    for (const plot of slot.plots) {
      if (!plot.plant) continue;
      const mudouEstagio = crescer(plot.plant, dt, relogio, 'sol', c ? c.up : null);
      const mudouProg = Math.abs(plot.plant.prog - (plot.plant._ultProg ?? -99)) >= 0.7;
      const mudouAgua = Math.abs(plot.plant.agua - (plot.plant._ultAgua ?? -99)) >= 0.05;
      if (mudouEstagio || mudouProg || mudouAgua) {
        plot.plant._ultProg = plot.plant.prog; plot.plant._ultAgua = plot.plant.agua;
        plot.updatedAt = agora(); updates.push({ localIndex:plot.localIndex, plot:farmPlotPublic(plot) });
      }
    }
    if (updates.length) { slot.updatedAt = agora(); farmEnviarPlotUpdates(slot, updates); }
  }
}, GROW_MS);

/* ───────── gravação periódica ─────────
   Grava só o que mudou, a cada 20s, e os lotes a cada minuto. Escrever a
   cada alteração seria I/O demais; deixar só no fim seria perder tudo num
   crash. Este é o meio-termo. */
setInterval(() => {
  for (const j of jogadores.values()) copiarPosicaoParaCarteira(j);
  if (!sujas.size) return;
  for (const k of sujas) salvarCarteira(k);
  sujas.clear();
}, 20000);
setInterval(salvarLotes, 60000);

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
  console.log('desligando: gravando estado...');
  try { salvarTudo(); } catch (e) { console.error('erro ao gravar:', e.message); }
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

iniciarBanco();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Quintal 3D — servidor autoritativo na porta ${PORT} · tick ${TICK_HZ}Hz · AOI ${AOI_RAIO}m`);
});
