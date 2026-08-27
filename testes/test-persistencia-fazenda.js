const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');
const Database = require('better-sqlite3');

const PORT = Number(process.env.TEST_FARM_PERSIST_PORT || 19123);
const DB_PATH = path.join(os.tmpdir(), `quintal-farm-persistence-${process.pid}.db`);
const SERVER = path.join(__dirname, '..', 'servidor-1.js');
const AUTH_SECRET = 'repro-farm-persistence-secret';
const KEY = `repro_farm_${process.pid}`;
const NAME = 'Reprodução Fazenda';
const SEED = { id: 3, nome: 'Northern Lights', cor: 0x5f9c46, gen: 0, auto: false, rar: 'comum',
  t: { ritmo: 66, rendimento: 58, resistencia: 88, aroma: 52, brilho: 48 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tokenFor = sub => {
  const payload = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 3600000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};
function removeDb() { for (const s of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + s, { force: true }); }
function seedDb() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE contas (usuario TEXT PRIMARY KEY, chave TEXT UNIQUE NOT NULL, nome TEXT, senha_salt TEXT NOT NULL, senha_hash TEXT NOT NULL, criado BIGINT, atualizado BIGINT);
    CREATE TABLE usuarios (chave TEXT PRIMARY KEY, nome TEXT, cash INTEGER DEFAULT 0, bank TEXT DEFAULT '[]', estoque TEXT DEFAULT '[]', up TEXT DEFAULT '{}', armas TEXT DEFAULT '{}', fert TEXT DEFAULT '{}', rack_max INTEGER DEFAULT 6, armor REAL DEFAULT 0, municao TEXT DEFAULT '{}', funcs TEXT DEFAULT '[]', imoveis TEXT DEFAULT '[]', nivel INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, territorios TEXT DEFAULT '{}', atualizado INTEGER);
    CREATE TABLE lotes (idx INTEGER PRIMARY KEY, dono_chave TEXT, dono_nome TEXT, plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0);
    CREATE TABLE farm_slots (slot_index INTEGER PRIMARY KEY, owner_key TEXT UNIQUE, owner_name TEXT, plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0, unlocked_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0);
    CREATE TABLE farm_jobs (job_id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, station_id INTEGER NOT NULL, operation TEXT NOT NULL, stock_id INTEGER NOT NULL, quantity INTEGER NOT NULL, started_at INTEGER NOT NULL, completes_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', source_json TEXT DEFAULT '{}');`);
  const now = Date.now(); const salt = 'repro-salt'; const hash = crypto.pbkdf2Sync('SenhaRepro9!', salt, 120000, 32, 'sha256').toString('hex');
  db.prepare('INSERT INTO contas (usuario,chave,nome,senha_salt,senha_hash,criado,atualizado) VALUES (?,?,?,?,?,?,?)').run(KEY, KEY, NAME, salt, hash, now, now);
  db.prepare(`INSERT INTO usuarios (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,armor,municao,funcs,imoveis,nivel,xp,territorios,atualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    KEY, NAME, 100000, JSON.stringify([{ s: SEED, qtd: 2 }]), '[]', JSON.stringify({ _posicao: { x: 0, y: 0, z: 170, ry: 0 } }), JSON.stringify({ pistola: true }), '{}', 6, 0, '{}', '[]', '[]', 12, 0, '{}', now);
  db.close();
}
function startServer() {
  return spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH, AUTH_SECRET, DATABASE_URL: '', ALLOW_ANONYMOUS: '0', CLIENTE_FIRST_S: '1', CLIENTE_MIN_S: '1', CLIENTE_MAX_S: '2', FARM_SAVE_S: '.2' }, stdio: ['ignore', 'ignore', 'pipe'] });
}
async function waitHealth() {
  for (let i = 0; i < 100; i++) {
    try { await new Promise((resolve, reject) => { const q = http.get(`http://127.0.0.1:${PORT}/healthz`, r => { r.resume(); r.statusCode === 200 ? resolve() : reject(new Error('health')); }); q.on('error', reject); q.setTimeout(200, () => { q.destroy(); reject(new Error('health timeout')); }); }); return; } catch (_) { await sleep(50); }
  }
  throw new Error('servidor não subiu');
}
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`), messages = [], waiters = [];
    const client = { ws, messages, send(v) { ws.send(JSON.stringify(v)); }, waitFor(pred, timeout = 7000, label = 'mensagem', after = 0) {
      const found = messages.slice(after).find(pred); if (found) return Promise.resolve(found);
      return new Promise((res, rej) => { const timer = setTimeout(() => { const i = waiters.findIndex(w => w.res === res); if (i >= 0) waiters.splice(i, 1); rej(new Error(`timeout: ${label}`)); }, timeout); waiters.push({ pred: m => messages.indexOf(m) >= after && pred(m), res: v => { clearTimeout(timer); res(v); } }); });
    } };
    ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch (_) { return; } messages.push(m); for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { const w = waiters.splice(i, 1)[0]; w.res(m); } });
    ws.once('open', () => resolve(client)); ws.once('error', reject);
  });
}
async function moveTo(c, from, to) {
  let cur = { x: from.x, z: from.z }, seq = 1;
  for (let guard = 0; Math.hypot(to.x - cur.x, to.z - cur.z) > .35; guard++) {
    if (guard > 900) throw new Error(`rota travou em ${JSON.stringify(cur)} -> ${JSON.stringify(to)}`);
    const d = Math.hypot(to.x - cur.x, to.z - cur.z), step = Math.min(2.1, d), next = { x: cur.x + (to.x - cur.x) / d * step, z: cur.z + (to.z - cur.z) / d * step };
    const before = c.messages.length; c.send({ t: 'input', seq: seq++, x: next.x, y: 0, z: next.z, ry: 0, arma: 0 }); await sleep(170);
    const corr = c.messages.slice(before).find(m => m.t === 'correcao'); cur = corr ? { x: corr.x, z: corr.z } : next;
  }
  return cur;
}
async function stopGraceful(child) { if (!child || child.exitCode !== null) return; child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
async function main() {
  removeDb(); seedDb(); let server = startServer(); await waitHealth();
  let c = await connect(); c.send({ t: 'hello', token: tokenFor(KEY), nome: NAME, aparelhoId: `repro-${process.pid}` });
  const atrib = await c.waitFor(m => m.t === 'lote_atribuido'); await c.waitFor(m => m.t === 'estado' && m.farm);
  let pos = await moveTo(c, atrib.posicao, { x: -30, z: 180 }); c.send({ t: 'comprar_farm_lote', slotIndex: 0 });
  const comprado = await c.waitFor(m => m.t === 'farm_lote_comprado' && m.slot && m.slot.slotIndex === 0);
  c.send({ t: 'portao', id: comprado.slot.portaoId }); await c.waitFor(m => m.t === 'portao_estado' && m.aberto === true);
  pos = await moveTo(c, pos, { x: comprado.slot.plots[0].x, z: comprado.slot.plots[0].z });
  c.send({ t: 'farm_plantar', plotId: comprado.slot.plots[0].id, seedId: SEED.id });
  const plantado = await c.waitFor(m => m.t === 'farm_plot_update' && m.plot && m.plot.plant);
  const live = await c.waitFor(m => m.t === 'farm_plots_update' && (m.updates || []).some(u => u.localIndex === 0 && u.plot && u.plot.plant && Number(u.plot.plant.prog) > 0), 10000, 'crescimento da planta');
  const livePlot = live.updates.find(u => u.localIndex === 0).plot.plant;
  await sleep(500);
  const db = new Database(DB_PATH);
  const beforeKill = db.prepare('SELECT plots FROM farm_slots WHERE slot_index=0').get();
  const dbPlot = JSON.parse(beforeKill.plots)[0].plant;
  db.close();
  console.log('REPRO_EVIDENCE', JSON.stringify({ plantedProg: plantado.plot.plant.prog, liveProg: livePlot.prog, dbProgBeforeCrash: dbPlot.prog }));
  c.ws.close();
  server.kill('SIGKILL');
  await new Promise(resolve => server.once('exit', resolve));
  await sleep(200);
  server = startServer(); await waitHealth();
  const after = await connect(); after.send({ t: 'hello', token: tokenFor(KEY), nome: NAME, aparelhoId: `repro-after-${process.pid}` });
  const restored = await after.waitFor(m => m.t === 'estado' && m.farm && m.farm.slot, 7000, 'estado restaurado');
  const restoredPlot = restored.farm.slot.plots[0].plant;
  assert.ok(restoredPlot, 'a planta deveria existir depois da restauração');
  assert.ok(Number(dbPlot.prog) > 0, `o save periódico deveria gravar progresso: banco=${dbPlot.prog}`);
  assert.ok(Number(restoredPlot.prog) >= Number(dbPlot.prog) - .3, `progresso não restaurado: banco=${dbPlot.prog} restaurado=${restoredPlot.prog}`);
  console.log('FARM_PERSISTENCE_OK', JSON.stringify({ liveProg: livePlot.prog, dbProgBeforeCrash: dbPlot.prog, restoredProg: restoredPlot.prog }));
  after.ws.close(); await stopGraceful(server); removeDb();
}
main().catch(async err => { console.error('REPRO_FAILED:', err.stack || err.message); removeDb(); process.exitCode = 1; });
process.on('uncaughtException', err => { console.error('REPRO_FAILED:', err.stack || err.message); removeDb(); process.exitCode = 1; });
process.on('unhandledRejection', err => { console.error('REPRO_FAILED:', err && (err.stack || err.message) || err); removeDb(); process.exitCode = 1; });

