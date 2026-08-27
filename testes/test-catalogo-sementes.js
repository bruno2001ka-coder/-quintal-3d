const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'servidor-1.js');
const PORT = Number(process.env.TEST_CATALOG_PORT || 19125);
const DB_PATH = path.join('/tmp', `quintal-catalogo-${process.pid}.db`);
const AUTH_SECRET = 'catalogo-local-secret';
const USERS = [
  { key: `catalogo_nivel10_${process.pid}`, name: 'Catálogo Nível 10', level: 10 },
  { key: `catalogo_nivel11_${process.pid}`, name: 'Catálogo Nível 11', level: 11 }
];
const SEEDS = [
  { id: 1, nome: 'Blueberry Auto', cor: 0x7fa8c4, gen: 0, auto: true, rar: 'comum', nivelMin: 10, qualidade: 2, slug: 'blueberry-auto', aromaPerfil: 'mirtilo e frutas vermelhas', cheiro: 'doce, frutado e fresco', t: { ritmo: 82, rendimento: 62, resistencia: 78, aroma: 76, brilho: 70 } },
  { id: 2, nome: 'Amnesia Haze Auto', cor: 0x86c65a, gen: 0, auto: true, rar: 'comum', nivelMin: 10, qualidade: 2, slug: 'amnesia-haze-auto', aromaPerfil: 'limão, cítrico e terra', cheiro: 'cítrico, herbal e haze', t: { ritmo: 84, rendimento: 68, resistencia: 66, aroma: 84, brilho: 64 } },
  { id: 3, nome: 'Northern Lights', cor: 0x5f9c46, gen: 0, auto: false, rar: 'comum', nivelMin: 10, qualidade: 3, slug: 'northern-lights', aromaPerfil: 'pinho, terra e madeira doce', cheiro: 'resinoso, terroso e picante', t: { ritmo: 66, rendimento: 58, resistencia: 88, aroma: 52, brilho: 48 } },
  { id: 4, nome: 'White Widow', cor: 0xc9d8bc, gen: 0, auto: false, rar: 'comum', nivelMin: 10, qualidade: 3, slug: 'white-widow', aromaPerfil: 'terra, especiarias e pimenta', cheiro: 'pungente, herbal e apimentado', t: { ritmo: 58, rendimento: 62, resistencia: 74, aroma: 60, brilho: 92 } },
  { id: 5, nome: 'Northern Light Auto', cor: 0x63a05a, gen: 0, auto: true, rar: 'comum', nivelMin: 11, qualidade: 4, slug: 'northern-light-auto', aromaPerfil: 'doçura, pinho e terra', cheiro: 'doce, resinoso e amadeirado', t: { ritmo: 88, rendimento: 70, resistencia: 86, aroma: 64, brilho: 58 } },
  { id: 6, nome: 'White Widow Auto', cor: 0xb8cf9d, gen: 0, auto: true, rar: 'comum', nivelMin: 11, qualidade: 4, slug: 'white-widow-auto', aromaPerfil: 'madeira, terra e especiarias', cheiro: 'pungente, terroso e resinoso', t: { ritmo: 86, rendimento: 74, resistencia: 76, aroma: 72, brilho: 88 } },
  { id: 7, nome: 'OG Kush', cor: 0x5e8f42, gen: 0, auto: false, rar: 'comum', nivelMin: 11, qualidade: 5, slug: 'og-kush', aromaPerfil: 'cítrico, terra e combustível', cheiro: 'cítrico intenso, diesel e terroso', t: { ritmo: 46, rendimento: 60, resistencia: 58, aroma: 86, brilho: 62 } },
  { id: 8, nome: 'Sour Diesel', cor: 0x7fbf6a, gen: 0, auto: false, rar: 'comum', nivelMin: 11, qualidade: 5, slug: 'sour-diesel', aromaPerfil: 'diesel, cítrico azedo e terra', cheiro: 'combustível, sour e cítrico', t: { ritmo: 44, rendimento: 66, resistencia: 56, aroma: 90, brilho: 50 } }
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tokenFor = sub => {
  const payload = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 3600000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};
function removeDb() { for (const suffix of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + suffix, { force: true }); }
function seedDb() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE contas (usuario TEXT PRIMARY KEY, chave TEXT UNIQUE NOT NULL, nome TEXT, senha_salt TEXT NOT NULL, senha_hash TEXT NOT NULL, criado BIGINT, atualizado BIGINT);
    CREATE TABLE usuarios (chave TEXT PRIMARY KEY, nome TEXT, cash INTEGER DEFAULT 0, bank TEXT DEFAULT '[]', estoque TEXT DEFAULT '[]', up TEXT DEFAULT '{}', armas TEXT DEFAULT '{}', fert TEXT DEFAULT '{}', rack_max INTEGER DEFAULT 6, armor REAL DEFAULT 0, municao TEXT DEFAULT '{}', funcs TEXT DEFAULT '[]', imoveis TEXT DEFAULT '[]', nivel INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, territorios TEXT DEFAULT '{}', atualizado INTEGER);
    CREATE TABLE lotes (idx INTEGER PRIMARY KEY, dono_chave TEXT, dono_nome TEXT, plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0);
    CREATE TABLE farm_slots (slot_index INTEGER PRIMARY KEY, owner_key TEXT UNIQUE, owner_name TEXT, plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0, unlocked_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0);
    CREATE TABLE farm_jobs (job_id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, station_id INTEGER NOT NULL, operation TEXT NOT NULL, stock_id INTEGER NOT NULL, quantity INTEGER NOT NULL, started_at INTEGER NOT NULL, completes_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', source_json TEXT DEFAULT '{}');`);
  const now = Date.now();
  const insertConta = db.prepare('INSERT INTO contas (usuario,chave,nome,senha_salt,senha_hash,criado,atualizado) VALUES (?,?,?,?,?,?,?)');
  const insertUsuario = db.prepare('INSERT INTO usuarios (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,armor,municao,funcs,imoveis,nivel,xp,territorios,atualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const user of USERS) {
    const salt = `salt-${user.level}`;
    const hash = crypto.pbkdf2Sync('SenhaCatalogo9!', salt, 120000, 32, 'sha256').toString('hex');
    insertConta.run(user.key, user.key, user.name, salt, hash, now, now);
    insertUsuario.run(user.key, user.name, 100000, '[]', '[]', JSON.stringify({ _posicao: { x: 5, y: 0, z: 6.5, ry: Math.PI } }), JSON.stringify({ pistola: true }), '{}', 6, 0, '{}', '[]', '[]', user.level, 0, '{}', now);
  }
  db.close();
}
function startServer() {
  return spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH, AUTH_SECRET, DATABASE_URL: '', ALLOW_ANONYMOUS: '0', CLIENTE_FIRST_S: '1', CLIENTE_MIN_S: '1', CLIENTE_MAX_S: '2' }, stdio: ['ignore', 'ignore', 'pipe'] });
}
async function waitHealth() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${PORT}/healthz`, res => { res.resume(); res.statusCode === 200 ? resolve() : reject(new Error(`health ${res.statusCode}`)); });
        req.on('error', reject); req.setTimeout(300, () => { req.destroy(); reject(new Error('health timeout')); });
      });
      return;
    } catch (_) { await sleep(50); }
  }
  throw new Error('servidor não subiu');
}
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const messages = [], waiters = [];
    const client = {
      ws, messages,
      send(message) { ws.send(JSON.stringify(message)); },
      waitFor(predicate, timeout = 5000, label = 'mensagem') {
        const found = messages.find(predicate); if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { const i = waiters.findIndex(w => w.res === res); if (i >= 0) waiters.splice(i, 1); rej(new Error(`timeout: ${label}`)); }, timeout);
          waiters.push({ predicate, res: value => { clearTimeout(timer); res(value); } });
        });
      }
    };
    ws.on('message', raw => {
      let message; try { message = JSON.parse(raw); } catch (_) { return; }
      messages.push(message);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].predicate(message)) { const waiter = waiters.splice(i, 1)[0]; waiter.res(message); }
    });
    ws.once('open', () => resolve(client)); ws.once('error', reject);
  });
}
async function authenticated(user) {
  const client = await connect();
  client.send({ t: 'hello', token: tokenFor(user.key), nome: user.name, aparelhoId: `catalogo-${user.level}-${process.pid}` });
  await client.waitFor(m => m.t === 'sessao', 5000, 'sessão');
  await client.waitFor(m => m.t === 'estado', 5000, 'estado inicial');
  return client;
}
async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
}
function validateCatalogSource() {
  const source = fs.readFileSync(SERVER, 'utf8');
  const block = source.match(/const CATALOGO_SEMENTES = \[(.*?)\n\]\.map/s);
  assert.ok(block, 'catálogo authoritative não encontrado');
  const names = [...block[1].matchAll(/nome:'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(names, SEEDS.map(seed => seed.nome), 'o servidor deve expor exatamente oito genéticas, na ordem oficial');
  assert.equal(SEEDS.filter(seed => seed.nivelMin === 10).length, 4);
  assert.equal(SEEDS.filter(seed => seed.nivelMin === 11).length, 4);
  assert.equal(SEEDS.filter(seed => seed.nivelMin === 10 && seed.auto).length, 2);
  assert.equal(SEEDS.filter(seed => seed.nivelMin === 10 && !seed.auto).length, 2);
  assert.equal(SEEDS.filter(seed => seed.nivelMin === 11 && seed.auto).length, 2);
  assert.equal(SEEDS.filter(seed => seed.nivelMin === 11 && !seed.auto).length, 2);
  assert.match(source, /if \(Number\(c\.nivel\) < Number\(sem\.nivelMin \|\| 10\)\)/, 'compra deve conferir nível no servidor');
}
async function main() {
  validateCatalogSource();
  removeDb(); seedDb();
  let server;
  const clients = [];
  try {
    server = startServer(); await waitHealth();
    const level10 = await authenticated(USERS[0]); clients.push(level10);
    const spawn10 = level10.messages.find(m => m.t === 'lote_atribuido');
    assert.ok(spawn10, 'o servidor deve enviar a atribuição do lote');
    assert.equal(spawn10.loteIndex, 0, 'a conta antiga deve receber o primeiro lote');
    assert.equal(spawn10.posicao.x, -34, 'posição antiga deve ser migrada para o lote novo');
    assert.equal(spawn10.posicao.z, 35.8, 'spawn migrado deve ficar atrás do portão do lote novo');
    level10.send({ t: 'comprar', oq: 'semente', strain: SEEDS[0] });
    await level10.waitFor(m => m.t === 'estado' && m.bank.some(entry => entry.s && entry.s.nome === SEEDS[0].nome), 5000, 'compra nível 10');
    level10.send({ t: 'comprar', oq: 'semente', strain: SEEDS[4] });
    const rejected = await level10.waitFor(m => m.t === 'recusado' && /nível 11/.test(m.motivo), 5000, 'bloqueio de genética avançada no nível 10');
    assert.match(rejected.motivo, /genética liberada no nível 11/);
    level10.send({ t: 'comprar', oq: 'semente', strain: { ...SEEDS[0], nome: 'Genética Inventada' } });
    await level10.waitFor(m => m.t === 'recusado' && /fora do catálogo/.test(m.motivo), 5000, 'genética inventada recusada');

    const level11 = await authenticated(USERS[1]); clients.push(level11);
    level11.send({ t: 'comprar', oq: 'semente', strain: SEEDS[4] });
    const accepted = await level11.waitFor(m => m.t === 'estado' && m.bank.some(entry => entry.s && entry.s.nome === SEEDS[4].nome), 5000, 'compra nível 11');
    assert.ok(accepted.bank.some(entry => entry.s.nome === 'Northern Light Auto'));
    console.log('SEED_CATALOG_OK', JSON.stringify({ total: SEEDS.length, nivel10: 4, nivel11: 4, blockedAt10: true, acceptedAt11: true }));
  } finally {
    for (const client of clients) if (client.ws.readyState === WebSocket.OPEN) client.ws.close();
    await stopServer(server); removeDb();
  }
}
main().catch(err => { console.error('SEED_CATALOG_FAILED:', err.stack || err.message); removeDb(); process.exitCode = 1; });
process.on('uncaughtException', err => { console.error('SEED_CATALOG_FAILED:', err.stack || err.message); removeDb(); process.exitCode = 1; });
process.on('unhandledRejection', err => { console.error('SEED_CATALOG_FAILED:', err && (err.stack || err.message) || err); removeDb(); process.exitCode = 1; });
