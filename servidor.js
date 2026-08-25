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

function iniciarBanco() {
  if (DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      pg = new Pool({ connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
      dbTipo = 'postgres';
      pg.query(`CREATE TABLE IF NOT EXISTS usuarios (
        chave TEXT PRIMARY KEY, nome TEXT, cash INTEGER DEFAULT 0,
        bank TEXT DEFAULT '[]', estoque TEXT DEFAULT '[]',
        up TEXT DEFAULT '{}', armas TEXT DEFAULT '{}', fert TEXT DEFAULT '{}',
        rack_max INTEGER DEFAULT 6, atualizado BIGINT)`)
        .then(() => pg.query(`CREATE TABLE IF NOT EXISTS lotes (
          idx INTEGER PRIMARY KEY, dono_chave TEXT, dono_nome TEXT,
          plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0)`))
        .then(() => { console.log('banco: Postgres pronto'); carregarLotes(); })
        .catch(e => { console.error('Postgres falhou:', e.message); pg = null; dbTipo = 'memoria'; });
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
    db.exec(`CREATE TABLE IF NOT EXISTS usuarios (
      chave TEXT PRIMARY KEY, nome TEXT, cash INTEGER DEFAULT 0,
      bank TEXT DEFAULT '[]', estoque TEXT DEFAULT '[]',
      up TEXT DEFAULT '{}', armas TEXT DEFAULT '{}', fert TEXT DEFAULT '{}',
      rack_max INTEGER DEFAULT 6, atualizado INTEGER)`);
    db.exec(`CREATE TABLE IF NOT EXISTS lotes (
      idx INTEGER PRIMARY KEY, dono_chave TEXT, dono_nome TEXT,
      plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0)`);
    dbTipo = 'sqlite';
    console.log('banco: SQLite em ' + DB_PATH);
    carregarLotes();
  } catch (e) {
    console.error('SQLite indisponível (' + e.message + ') — rodando só em memória');
    db = null; dbTipo = 'memoria';
  }
}

/* ── carteiras ── */
function carregarCarteira(chave) {
  if (dbTipo === 'sqlite' && db) {
    try {
      const r = db.prepare('SELECT * FROM usuarios WHERE chave = ?').get(chave);
      if (!r) return null;
      return {
        cash: r.cash, bank: JSON.parse(r.bank || '[]'),
        estoque: JSON.parse(r.estoque || '[]'), up: JSON.parse(r.up || '{}'),
        armas: JSON.parse(r.armas || '{}'), fert: JSON.parse(r.fert || '{}'),
        rackMax: r.rack_max || 6, _iniciado: true
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
    return {
      cash: x.cash, bank: JSON.parse(x.bank || '[]'),
      estoque: JSON.parse(x.estoque || '[]'), up: JSON.parse(x.up || '{}'),
      armas: JSON.parse(x.armas || '{}'), fert: JSON.parse(x.fert || '{}'),
      rackMax: x.rack_max || 6, _iniciado: true
    };
  } catch (e) { console.error('erro ao ler carteira (pg):', e.message); return null; }
}
function salvarCarteira(chave) {
  const c = carteiras.get(chave);
  if (!c) return;
  const dados = [chave, c._nome || '', Math.floor(c.cash),
    JSON.stringify(c.bank || []), JSON.stringify(c.estoque || []),
    JSON.stringify(c.up || {}), JSON.stringify(c.armas || {}),
    JSON.stringify(c.fert || {}), c.rackMax || 6, Date.now()];
  if (dbTipo === 'sqlite' && db) {
    try {
      db.prepare(`INSERT INTO usuarios
        (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,atualizado)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(chave) DO UPDATE SET nome=excluded.nome, cash=excluded.cash,
          bank=excluded.bank, estoque=excluded.estoque, up=excluded.up,
          armas=excluded.armas, fert=excluded.fert, rack_max=excluded.rack_max,
          atualizado=excluded.atualizado`).run(...dados);
    } catch (e) { console.error('erro ao salvar carteira:', e.message); }
  } else if (dbTipo === 'postgres' && pg) {
    pg.query(`INSERT INTO usuarios
      (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,atualizado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(chave) DO UPDATE SET nome=EXCLUDED.nome, cash=EXCLUDED.cash,
        bank=EXCLUDED.bank, estoque=EXCLUDED.estoque, up=EXCLUDED.up,
        armas=EXCLUDED.armas, fert=EXCLUDED.fert, rack_max=EXCLUDED.rack_max,
        atualizado=EXCLUDED.atualizado`, dados)
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
    pg.query('SELECT * FROM lotes')
      .then(r => { r.rows.forEach(x => { const l = lotes[x.idx]; if (l) aplicarLoteSalvo(l, x); });
        console.log('lotes carregados do banco: ' + r.rows.length); })
      .catch(e => console.error('erro ao carregar lotes (pg):', e.message));
  }
}
function salvarTudo() {
  for (const chave of carteiras.keys()) salvarCarteira(chave);
  salvarLotes();
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
    // tenta recuperar do banco antes de criar uma carteira nova
    const salva = carregarCarteira(k);
    carteiras.set(k, salva || { cash: CASH_INICIAL, bank: [], estoque: [],
      rackMax: 6, up: {}, armas: {}, fert: {} });
  }
  const c = carteiras.get(k);
  if (j.nome) c._nome = j.nome;
  return c;
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
  [-8.6,37.4,19.7,20.3], [-5.3,-4.7,171.7,172.3], [4.7,5.3,171.7,172.3], [-29,-15,187.5,196.5],
  [-36.5,-31.5,189.5,194.5], [-53.05,-50.95,46.5,47.5], [52.95,55.05,136.5,137.5], [62.95,65.05,46.5,47.5],
  [-17.05,-14.95,110.5,111.5], [18.95,21.05,78.5,79.5], [20.95,23.05,116.5,117.5], [-17.05,-14.95,46.5,47.5],
  [54.95,57.05,78.5,79.5], [18.95,21.05,46.5,47.5], [-17.05,-14.95,78.5,79.5], [-20.9,-19.1,-9.9,-8.1],
  [-17.3,-15.7,-7,-6], [64.5,73.5,55.85,56.15], [64.5,73.5,63.85,64.15], [64.35,64.65,56,64],
  [69.5,73.1,56.4,59.6], [-1.6,-1.2,-11.3,-10.9], [1.4,1.8,-11.3,-10.9], [4,4.4,-11.3,-10.9],
  [-0.1,2.9,-11.85,-10.95], [-8.5,-6.3,-2.75,-1.65], [3.75,6.05,6.88,7.75]
];

/* Colisores de cada propriedade, em coordenada RELATIVA ao centro do lote.
   O índice 5 é o portão: só bloqueia quando está fechado. */
const COL_LOTE_REL = [
  [-10.2,10.2,-8.2,-7.8], [-10.2,-9.8,-8.0,8.0], [9.8,10.2,-8.0,8.0], [1.2,10.2,7.8,8.2],
  [-10.2,-1.2,7.8,8.2], [-1.2,1.2,7.8,8.2], [1.9,2.1,-5.1,-1.7], [6.300000000000001,6.5,-5.1,-1.7],
  [2.0,6.4,-5.199999999999999,-5.0], [2.0,6.4,-1.8,-1.5999999999999999], [-7.85,-7.549999999999999,2.2,6.6000000000000005], [-1.6499999999999995,-1.3499999999999996,2.2,6.6000000000000005],
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
  { nome:'Beco do Mercado', x:-52, z:47 },
  { nome:'Praça da Torre', x:54, z:137 },
  { nome:'Vila Alta', x:64, z:47 },
  { nome:'Fundão', x:-16, z:111 },
  { nome:'Zona Nova', x:20, z:79 },
  { nome:'Alto da Torre', x:22, z:117 },
  { nome:'Boca do Rio', x:-16, z:47 },
  { nome:'Jardim Alvorada', x:56, z:79 },
  { nome:'Beira-Linha', x:20, z:47 },
  { nome:'Saída da BR', x:-16, z:79 }
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

const RUAS_Z_SRV = [15, 47, 79, 111, 143];
/* ═════════ F1 — FUNCIONÁRIOS COMO ENTIDADES DO MUNDO ═════════
   Antes o funcionário era um boneco local: o cliente descontava o próprio
   dinheiro e criava a malha 3D. O servidor não sabia que existia, então o
   jogador B via o quintal de A vazio — e um cliente modificado contratava
   de graça.

   Nesta F1 só a EXISTÊNCIA migra: catálogo, custo, ID, dono e envio por
   AOI. Movimento, tarefas e diária continuam onde estão — vêm nas
   próximas fases. */
const CAT_FUNC = {
  zelador:  { nome:'Nego Du',  papel:'Zelador',           custo:1200, diaria:45  },
  colhedor: { nome:'Val',      papel:'Colhedora',         custo:2200, diaria:70  },
  caseiro:  { nome:'Seu Bené', papel:'Caseiro da fazenda',custo:4800, diaria:130,
              bloqueado:'a fazenda ainda não existe no servidor' }
};
const funcionarios = [];            // entidades vivas
const funcsDe = new Map();          // chave persistente -> [ids]

/* Reconexão não pode duplicar: os funcionários vivem por CHAVE, não por
   conexão. Ao voltar, o jogador reencontra os mesmos. */
function funcsDoJogador(chave) {
  if (!funcsDe.has(chave)) funcsDe.set(chave, []);
  return funcsDe.get(chave);
}
function resumoFunc(f) {
  return { id:f.id, cargo:f.cargo, nome:f.nome, dono:f.dono,
    x:+f.x.toFixed(2), z:+f.z.toFixed(2), ry:+f.ry.toFixed(3) };
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
  paraTodos({ t: 'sirene' });
  return b;
}
/* Tiro da polícia: só dispara com linha de visão livre. Isso acaba com o
   "atirando através do muro" que você relatou. */
function tiroPM(b) {
  const t = agora();
  if (t - b.ultimoTiro < PM_CADENCIA_MS) return;
  for (const [id, j] of jogadores) {
    const d = Math.hypot(j.x - b.x, j.z - b.z);
    if (d > PM_ALCANCE) continue;
    if (!temVisao(b.x, b.z, j.x, j.z)) continue;   // parede no caminho: não atira
    b.ultimoTiro = t;
    enviar(j, { t: 'levou_tiro', de: b.id, dano: PM_DANO, x: b.x, z: b.z });
    paraTodos({ t: 'tiro_npc', id: b.id, ax: b.x, az: b.z, bx: j.x, bz: j.z });
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
      memoriaMB: +(process.memoryUsage().rss / 1048576).toFixed(1),
      banco: dbTipo,
      carteirasSalvas: carteiras.size
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
        // identidade do APARELHO — só usada pra conferir o fundador.
        // Nunca é repassada a outros jogadores nem entra em broadcast.
        j.aparelho = str(m.aparelhoId, 40) || null;
        j.fundador = ehFundador(j);
        if (j.fundador) console.log('fundador conectado: ' + j.nome);
        if (m.nome) j.nome = str(m.nome, 18).trim() || j.nome;
        const idx = atribuirLote(j.chave, j.nome);
        enviar(j, {
          t: 'lote_atribuido',
          loteIndex: idx,
          lote: idx !== null ? resumoLote(lotes[idx]) : null
        });
        paraTodos({ t: 'nome', id, nome: j.nome }, id);
        // Carrega o estado salvo ANTES de mandar o estado inicial.
        // No Postgres a leitura é assíncrona, então esperamos ela.
        (async () => {
          const k = j.chave || j.id;
          if (dbTipo === 'postgres' && !carteiras.has(k)) {
            const salva = await carregarCarteiraAsync(k);
            if (salva) carteiras.set(k, salva);
          }
          const c = carteiraDe(j);
          if (!c._iniciado) {
            c._iniciado = true;
            const semBase = limparStrain(m.sementeBase);
            if (semBase) bankAdd(c, semBase, 2);
            salvarCarteira(k);
          }
          enviarEstado(j);
          // avisa SÓ este jogador. Não vai em broadcast.
          if (j.fundador) enviar(j, { t: 'fundador', ok: true });
        })();
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
            // COLISÃO NO SERVIDOR: antes só a velocidade era checada, então
            // um cliente modificado atravessava qualquer parede. Agora o
            // servidor recusa a travessia e devolve a posição válida.
            const r = moverComColisao(j.x, j.z, nx, nz, RAIO_JOGADOR);
            if (Math.hypot(r.x - nx, r.z - nz) > .25) {
              metricas.rejeitadas++;
              enviar(j, { t: 'correcao', x: r.x, y: ny, z: r.z });
            }
            j.x = r.x; j.y = ny; j.z = r.z;
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

      case 'contratar_func': {
        /* F1 — o SERVIDOR contrata. O cliente só pede o cargo: preço,
           saldo, ID e dono são decididos aqui. Um cliente modificado não
           consegue escolher preço nem criar funcionário por conta. */
        const chave = j.chave || j.id;
        const cargo = str(m.cargo, 16);
        const def = CAT_FUNC[cargo];
        if (!def) { enviar(j, { t:'recusado', motivo:'cargo inválido' });
          metricas.rejeitadas++; return; }
        if (def.bloqueado) {
          // honestidade: o caseiro depende da fazenda, que ainda não é
          // server-side. Recusar é melhor que fingir a validação.
          enviar(j, { t:'recusado', motivo:def.bloqueado }); return;
        }
        const meus = funcsDoJogador(chave);
        if (meus.some(id => {
          const e = entidades.get(id); return e && e.ref && e.ref.cargo === cargo;
        })) { enviar(j, { t:'recusado', motivo:'já contratado' }); return; }

        const c = carteiraDe(j);
        if (c.cash < def.custo) {
          enviar(j, { t:'recusado', motivo:'sem dinheiro' }); return; }
        c.cash -= def.custo;

        // nasce ao lado do dono, sem atravessar parede
        let fx = j.x + 1.5, fz = j.z + 1.5;
        if (dentroDeParede(fx, fz, RAIO_BOT)) { fx = j.x; fz = j.z; }
        const novo = { cargo, nome:def.nome, dono:chave,
          x:fx, z:fz, ry:0, alvo:null, estado:'parado' };
        const ent = registrar('fn', chave, novo);
        novo.id = ent.id;
        funcionarios.push(novo);
        meus.push(ent.id);

        enviar(j, { t:'func_contratado', func: resumoFunc(novo) });
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
        reconstruirColisores();   // portão aberto deixa de bloquear
        paraTodos({ t: 'portao_estado', id: ent.id, loteIndex: lote.index,
          aberto: lote.portaoAberto });
        enviar(j, { t: 'portao_estado', id: ent.id, loteIndex: lote.index,
          aberto: lote.portaoAberto });
        break;
      }

      case 'crime': {
        // o cliente avisa que fez algo ilegal; QUEM decide a resposta
        // policial é o servidor, e ela é visível pra todo mundo.
        j.procurado = Math.min(5, (j.procurado || 0) + num(m.peso, 1, 3, 1));
        j.crimeEm = agora();
        const jaTem = bots.filter(b => b.tipo === 'pm' && b.hp > 0).length;
        if (jaTem < 2 + j.procurado) nascerPM(j);
        enviar(j, { t: 'procurado', nivel: j.procurado });
        break;
      }

      case 'tiro_bot': {
        // O SERVIDOR decide se o tiro valeu. O cliente só avisa em quem
        // acertou — dano, morte e renascimento são decididos aqui, senão
        // cada jogador mataria o bot na própria tela e ninguém concordaria.
        const b = bots.find(x => x.id === String(m.bot).slice(0, 12));
        if (!b || b.hp <= 0) return;
        if (Math.hypot(b.x - j.x, b.z - j.z) > 60) { metricas.rejeitadas++; return; }
        /* CORREÇÃO — faltava a linha de visão aqui. A polícia já respeitava
           parede pra atirar no jogador, mas o caminho inverso validava só
           distância: dava pra matar bot de dentro de casa, através do muro.
           Reusa a MESMA temVisao dos bots — nenhuma função nova. */
        if (!temVisao(j.x, j.z, b.x, b.z)) { metricas.rejeitadas++; return; }
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

  ws.on('close', () => {
    // grava na saída: é o momento mais provável de perder progresso
    try { const k = j.chave || j.id; if (carteiras.has(k)) salvarCarteira(k); } catch (e) {}
    jogadores.delete(id); paraTodos({ t: 'leave', id });
  });
  ws.on('error', () => {});
});

/* ───────── tick fixo: um snapshot por tick, só de quem está perto ───────── */
setInterval(() => {
  tickAtual++;
  const dtTick = TICK_MS / 1000;
  if (jogadores.size) for (const b of bots) if (b.hp > 0) {
    passoBot(b, dtTick);
    if (b.tipo === 'pm' && b.alvo) tiroPM(b);
  }
  // polícia tem prazo: some sozinha depois de um tempo
  for (let i = bots.length - 1; i >= 0; i--) {
    const b = bots[i];
    if (b.tipo === 'pm' && b.morreEm && agora() > b.morreEm) {
      bots.splice(i, 1);
      paraTodos({ t: 'bot_morreu', id: b.id, porQuem: null });
    }
  }
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
    // F1 — funcionários viajam no MESMO snapshot dos bots, com o mesmo
    // filtro de AOI. Todos que estiverem perto veem os mesmos.
    const funcsPerto = [];
    for (const f of funcionarios) {
      if (Math.hypot(f.x - j.x, f.z - j.z) > AOI_RAIO) continue;
      funcsPerto.push(resumoFunc(f));
    }
    enviar(j, { t: 'snap', tick: tickAtual, players: perto, bots: botsPerto,
      funcs: funcsPerto });
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

/* ───────── gravação periódica ─────────
   Grava só o que mudou, a cada 20s, e os lotes a cada minuto. Escrever a
   cada alteração seria I/O demais; deixar só no fim seria perder tudo num
   crash. Este é o meio-termo. */
setInterval(() => {
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
server.listen(PORT, () => {
  console.log(`Quintal 3D — servidor autoritativo na porta ${PORT} · tick ${TICK_HZ}Hz · AOI ${AOI_RAIO}m`);
});
