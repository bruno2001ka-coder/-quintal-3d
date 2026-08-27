'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { WebSocket } = require('ws');

const PORT = Number(process.env.TEST_FARM_PORT || 19121);
const DB_PATH = path.join(os.tmpdir(), `quintal-farm-${process.pid}.db`);
const AUTH_SECRET = 'farm-multiplayer-regression-secret';
const SERVER = path.join(__dirname, '..', 'servidor-1.js');
const PASSWORD = 'SenhaFazenda9!';
const SEED = { id: 101, nome: 'Northern Lights', cor: 0x5f9c46, gen: 0, auto: false, rar: 'comum',
  t: { ritmo: 66, rendimento: 58, resistencia: 88, aroma: 52, brilho: 48 } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tokenFor = sub => {
  const payload = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 3600000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};
function removeDb() { for (const suffix of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + suffix, { force: true }); }
function seedDb() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE contas (
    usuario TEXT PRIMARY KEY, chave TEXT UNIQUE NOT NULL, nome TEXT,
    senha_salt TEXT NOT NULL, senha_hash TEXT NOT NULL, criado BIGINT, atualizado BIGINT);
    CREATE TABLE usuarios (
      chave TEXT PRIMARY KEY, nome TEXT, cash INTEGER DEFAULT 0, bank TEXT DEFAULT '[]', estoque TEXT DEFAULT '[]',
      up TEXT DEFAULT '{}', armas TEXT DEFAULT '{}', fert TEXT DEFAULT '{}', rack_max INTEGER DEFAULT 6,
      armor REAL DEFAULT 0, municao TEXT DEFAULT '{}', funcs TEXT DEFAULT '[]', imoveis TEXT DEFAULT '[]',
      nivel INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, territorios TEXT DEFAULT '{}', atualizado INTEGER);
    CREATE TABLE lotes (
      idx INTEGER PRIMARY KEY, dono_chave TEXT, dono_nome TEXT, plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0);`);
  for (let i = 0; i < 7; i++) {
    const usuario = `farm_${process.pid}_${i}`.slice(0, 24);
    const chave = `farm_key_${process.pid}_${i}`;
    const nome = `Fazendeiro ${i + 1}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(PASSWORD, salt, 120000, 32, 'sha256').toString('hex');
    const agora = Date.now();
    const estoque = i === 0 ? [
      { id: 7001, s: SEED, qtd: 6, estagio: 'sec', qual: .75, desde: agora },
      { id: 7002, s: SEED, qtd: 4, estagio: 'cura', qual: .8, desde: agora },
      { id: 7003, s: SEED, qtd: 2, estagio: 'embalagem', qual: .9, desde: agora }
    ] : [];
    db.prepare('INSERT INTO contas (usuario,chave,nome,senha_salt,senha_hash,criado,atualizado) VALUES (?,?,?,?,?,?,?)')
      .run(usuario, chave, nome, salt, hash, agora, agora);
    db.prepare(`INSERT INTO usuarios
      (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,armor,municao,funcs,imoveis,nivel,xp,territorios,atualizado)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(chave, nome, 50000, JSON.stringify([{ s: SEED, qtd: 2 }]), JSON.stringify(estoque), (i === 0 || i === 6) ? JSON.stringify({ _posicao:{ x:0, y:0, z:170, ry:0 } }) : '{}',
        JSON.stringify({ pistola: true }), '{}', 12, 0, JSON.stringify({}), '[]', JSON.stringify(['fazenda']), 10, 0, '{}', agora);
  }
  db.close();
  return { mainKey: `farm_key_${process.pid}_0`, outsiderKey: `farm_key_${process.pid}_6` };
}
function healthOk() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT}/healthz`, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false)); req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}
async function waitHealth() { for (let i = 0; i < 100; i++) { if (await healthOk()) return; await sleep(50); } throw new Error('servidor da fazenda não subiu'); }
function startServer() {
  return spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH, AUTH_SECRET,
    DATABASE_URL: '', ALLOW_ANONYMOUS: '0', FARM_SEC_S: '.1', FARM_CURA_S: '.1', FARM_EMBALAGEM_S: '.1', CLIENTE_FIRST_S: '1', CLIENTE_MIN_S: '1', CLIENTE_MAX_S: '2' }, stdio: ['ignore', 'ignore', 'pipe'] });
}
function stopServer(child) {
  return new Promise(resolve => { if (!child || child.exitCode !== null) return resolve(); const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); });
}
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`), messages = [], waiters = [];
    const client = { ws, messages,
      send(v) { ws.send(JSON.stringify(v)); },
      waitFor(predicate, timeout = 7000, label = 'mensagem') {
        const found = messages.find(predicate); if (found) return Promise.resolve(found);
        return new Promise((res, rej) => { const timer = setTimeout(() => { const i = waiters.findIndex(w => w.res === res); if (i >= 0) waiters.splice(i, 1); rej(new Error(`timeout esperando ${label}`)); }, timeout); waiters.push({ predicate, res: v => { clearTimeout(timer); res(v); }, rej }); });
      }
    };
    ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch (_) { return; } messages.push(m); for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].predicate(m)) { const w = waiters.splice(i, 1)[0]; w.res(m); } });
    ws.once('open', () => resolve(client)); ws.once('error', reject);
  });
}
async function ready(client, key, index) {
  client.send({ t: 'hello', token: tokenFor(key), nome: `Fazendeiro ${index + 1}`, avatarId: 'verde', aparelhoId: `farm-${process.pid}-${index}` });
  const lote = await client.waitFor(m => m.t === 'lote_atribuido', 7000, 'lote atribuído');
  const estado = await client.waitFor(m => m.t === 'estado' && m.farm, 7000, 'estado da fazenda');
  return { lote, estado };
}
async function moveTo(client, from, to) {
  let cur = { x: from.x, z: from.z }, seq = 1;
  while (Math.hypot(to.x - cur.x, to.z - cur.z) > .35) {
    const d = Math.hypot(to.x - cur.x, to.z - cur.z), step = Math.min(2.1, d);
    cur = { x: cur.x + (to.x - cur.x) / d * step, z: cur.z + (to.z - cur.z) / d * step };
    client.send({ t: 'input', seq: seq++, x: cur.x, y: 0, z: cur.z, ry: 0, arma: 0 }); await sleep(170);
  }
  return cur;
}
function closeClient(c) { try { if (c && c.ws.readyState <= 1) c.ws.close(); } catch (_) {} }
async function waitFarmState(client, predicate, label) { return client.waitFor(m => m.t === 'estado' && m.farm && predicate(m), 7000, label); }

(async () => {
  let server; const clients = []; let keys;
  try {
    removeDb(); keys = seedDb();
    server = startServer(); await waitHealth();
    for (let i = 0; i < 6; i++) { const c = await connect(); clients.push(c); const r = await ready(c, `farm_key_${process.pid}_${i}`, i); assert.ok(r.estado.farm.unlocked, `estado farm recebido: ${JSON.stringify({farm:r.estado.farm,nivel:r.estado.nivel,imoveis:r.estado.imoveis})}`); assert.equal(r.estado.farm.slot.plots.length, 12, `jogador ${i + 1} deve receber 12 canteiros`); assert.equal(r.lote.farm.plots.length, 12); }
    const slots = clients.map(c => c.messages.find(m => m.t === 'estado' && m.farm && m.farm.slot)?.farm.slot.slotIndex);
    assert.deepEqual([...new Set(slots)].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], 'seis contas devem ocupar setores distintos');

    // A sétima conta continua podendo autenticar na cidade, mas não recebe setor nem pode passar pelo portão.
    const outsider = await connect(); clients.push(outsider); const out = await ready(outsider, keys.outsiderKey, 6);
    assert.equal(out.estado.farm.unlocked, false, 'a sétima conta não deve receber setor da fazenda');
    const rejectsBefore = outsider.messages.filter(m => m.t === 'recusado').length;
    await moveTo(outsider, out.lote.posicao, { x: 0, z: 174 });
    outsider.send({ t: 'input', seq: 99, x: 0, y: 0, z: 180, ry: 0, arma: 0 });
    await outsider.waitFor(m => m.t === 'recusado' && /fazenda bloqueada|setor pertence/i.test(m.motivo), 7000, 'bloqueio do portão para sétimo jogador');
    assert.ok(outsider.messages.filter(m => m.t === 'recusado').length > rejectsBefore);

    const main = clients[0];
    // Caminho legítimo: portão externo, corredor entre setores e porta central do galpão.
    let pos = main.messages.find(m => m.t === 'lote_atribuido').posicao;
    pos = await moveTo(main, pos, { x: 0, z: 174 });
    pos = await moveTo(main, pos, { x: -15, z: 174 });
    pos = await moveTo(main, pos, { x: -15, z: 260 });
    pos = await moveTo(main, pos, { x: 0, z: 260 });
    pos = await moveTo(main, pos, { x: 0, z: 255 });
    pos = await moveTo(main, pos, { x: -8, z: 250 });
    const beforeTables = main.messages.find(m => m.t === 'estado' && m.farm)?.farm.tables;
    assert.equal(beforeTables.length, 6, 'o galpão deve ter seis mesas authoritative');

    // Todas as três etapas usam somente estoque real; a mesa ocupa uma posição e produz o próximo estágio.
    for (const [operation, stockId, stage] of [['secagem', 7001, 'cura'], ['cura', 7002, 'embalagem'], ['embalagem', 7003, 'pronto']]) {
      main.send({ t: 'farm_job', stationId: 0, operation, stockId });
      const started = await main.waitFor(m => (m.t === 'farm_job_started' && m.stationId === 0 && m.operation === operation) || m.t === 'recusado', 7000, `início de ${operation}`);
      assert.equal(started.t, 'farm_job_started', `servidor recusou ${operation}: ${started.motivo || JSON.stringify(started)}; posição=${JSON.stringify(main.messages.filter(m => m.t === 'correcao').at(-1) || main.messages.find(m => m.t === 'lote_atribuido')?.posicao)}`);
      await main.waitFor(m => m.t === 'farm_job_ok' && m.stationId === 0 && m.operation === operation && m.estagio === stage, 7000, `conclusão de ${operation}`);
      await waitFarmState(main, m => m.estoque.some(l => l.id === stockId && l.estagio === stage), `estoque após ${operation}`);
    }
    const finalState = main.messages.filter(m => m.t === 'estado' && m.farm).at(-1);
    assert.equal(finalState.farm.tables.length, 6);
    assert.ok(finalState.estoque.some(l => l.id === 7001 && l.estagio === 'cura'));
    assert.ok(finalState.estoque.some(l => l.id === 7002 && l.estagio === 'embalagem'));
    assert.ok(finalState.estoque.some(l => l.id === 7003 && l.estagio === 'pronto'));

    // Posse: um jogador só consegue alterar seus próprios canteiros.
    const ownPlot = finalState.farm.slot.plots[0];
    assert.match(ownPlot.id, /^farm_0_0$/);
    pos = await moveTo(main, pos, { x: 0, z: 260 });
    pos = await moveTo(main, pos, { x: -15, z: 260 });
    pos = await moveTo(main, pos, { x: -15, z: 174 });
    pos = await moveTo(main, pos, { x: -30, z: 174 });
    pos = await moveTo(main, pos, { x: -30, z: 181 });
    await moveTo(main, pos, { x: ownPlot.x, z: ownPlot.z });
    main.send({ t: 'farm_plantar', plotId: ownPlot.id, seedId: SEED.id });
    await main.waitFor(m => m.t === 'farm_plot_update' && m.slotIndex === 0 && m.localIndex === 0 && m.plot && m.plot.plant, 7000, 'plantio no canteiro próprio');
    const foreignPlot = clients[1].messages.find(m => m.t === 'estado' && m.farm)?.farm.slots.find(s => s.slotIndex === 1);
    assert.ok(foreignPlot);
    main.send({ t: 'farm_plantar', plotId: foreignPlot.plots?.[0]?.id || 'farm_1_0', seedId: SEED.id });
    await main.waitFor(m => m.t === 'recusado' && /não pertence|bloqueada/i.test(m.motivo), 7000, 'bloqueio de canteiro alheio');

    console.log('FARM_MULTIPLAYER_OK', JSON.stringify({ setores: 6, canteirosPorJogador: 12, totalCanteiros: 72, mesas: 6, galpaoInterno: true, portaoBloqueiaSetimo: true, processamento: ['secagem', 'cura', 'embalagem'], posseAuthoritative: true }));
  } catch (error) {
    console.error('FARM_MULTIPLAYER_FAILED:', error.stack || error.message); process.exitCode = 1;
  } finally { clients.forEach(closeClient); await stopServer(server); removeDb(); }
})().catch(error => { console.error('FARM_MULTIPLAYER_FAILED:', error.stack || error.message); process.exitCode = 1; });

