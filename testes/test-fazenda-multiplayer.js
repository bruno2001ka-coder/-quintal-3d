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
const SEED = { id: 3, nome: 'Northern Lights', cor: 0x5f9c46, gen: 0, auto: false, rar: 'comum',
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
      idx INTEGER PRIMARY KEY, dono_chave TEXT, dono_nome TEXT, plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0);
    CREATE TABLE farm_slots (
      slot_index INTEGER PRIMARY KEY, owner_key TEXT UNIQUE, owner_name TEXT,
      plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0,
      unlocked_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0);`);
  for (let i = 0; i < 8; i++) {
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
    const funcionarios = [];
    db.prepare('INSERT INTO contas (usuario,chave,nome,senha_salt,senha_hash,criado,atualizado) VALUES (?,?,?,?,?,?,?)')
      .run(usuario, chave, nome, salt, hash, agora, agora);
    db.prepare(`INSERT INTO usuarios
      (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,armor,municao,funcs,imoveis,nivel,xp,territorios,atualizado)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(chave, nome, 50000, JSON.stringify([{ s: SEED, qtd: 2 }]), JSON.stringify(estoque),         JSON.stringify({ _posicao:{ x:0, y:0, z:170, ry:0 } }),
        JSON.stringify({ pistola: true }), '{}', 12, 0, JSON.stringify({}), JSON.stringify(funcionarios), JSON.stringify([]), i === 7 ? 9 : 12, 0, '{}', agora);
  }
  db.close();
  return { mainKey: `farm_key_${process.pid}_0`, outsiderKey: `farm_key_${process.pid}_6`, lowKey: `farm_key_${process.pid}_7` };
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
      waitFor(predicate, timeout = 7000, label = 'mensagem', after = 0) {
        const found = messages.slice(after).find(predicate); if (found) return Promise.resolve(found);
        const current = m => messages.indexOf(m) >= after && predicate(m);
        return new Promise((res, rej) => { const timer = setTimeout(() => { const i = waiters.findIndex(w => w.res === res); if (i >= 0) waiters.splice(i, 1); rej(new Error(`timeout esperando ${label}`)); }, timeout); waiters.push({ predicate:current, res: v => { clearTimeout(timer); res(v); }, rej }); });
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
  let cur = { x: from.x, z: from.z }, seq = 1, guard = 0;
  while (Math.hypot(to.x - cur.x, to.z - cur.z) > .35) {
    if (++guard > 900) throw new Error(`rota authoritative travou em ${JSON.stringify(cur)} para ${JSON.stringify(to)}`);
    const d = Math.hypot(to.x - cur.x, to.z - cur.z), step = Math.min(2.1, d);
    cur = { x: cur.x + (to.x - cur.x) / d * step, z: cur.z + (to.z - cur.z) / d * step };
    const sentSeq = seq++;
    const before = client.messages.length;
    client.send({ t: 'input', seq: sentSeq, x: cur.x, y: 0, z: cur.z, ry: 0, arma: 0 }); await sleep(170);
    const correction = client.messages.slice(before).find(m => m.t === 'correcao' && m.seq === sentSeq);
    if (correction) cur = { x: correction.x, z: correction.z };
  }
  return cur;
}
function closeClient(c) { try { if (c && c.ws.readyState <= 1) c.ws.close(); } catch (_) {} }
async function waitFarmState(client, predicate, label) { return client.waitFor(m => m.t === 'estado' && m.farm && predicate(m), 7000, label); }
async function chegarPorteiraDoSlot(client, from, slotIndex) {
  const [x,z] = [[-30,194],[0,194],[30,194],[-30,230],[0,230],[30,230]][slotIndex];
  let p = await moveTo(client, from, { x:0, z:174 });
  const top = z < 210, gapX = x < 0 ? -15 : 15;
  if (top) {
    p = await moveTo(client, p, { x, z:174 });
    p = await moveTo(client, p, { x, z:z-15.5 });
  } else {
    p = await moveTo(client, p, { x:gapX, z:174 });
    p = await moveTo(client, p, { x:gapX, z:212 });
    p = await moveTo(client, p, { x, z:212 });
    p = await moveTo(client, p, { x, z:z-14.8 });
  }
  return p;
}

(async () => {
  let server; const clients = []; let keys;
  try {
    removeDb(); keys = seedDb();
    server = startServer(); await waitHealth();
    const initialReady = [];
    for (let i = 0; i < 6; i++) {
      const c = await connect(); clients.push(c);
      const r = await ready(c, `farm_key_${process.pid}_${i}`, i);
      assert.equal(r.estado.farm.unlocked, false, 'nível 10 não deve conceder lote automaticamente');
      assert.equal(r.estado.farm.slots.length, 6, 'o catálogo deve mostrar os seis lotes');
      assert.equal(r.estado.farm.slots[i].preco, [26000,28000,30000,32000,34000,36000][i]);
      assert.equal(r.estado.farm.slots[i].disponivel, true);
      initialReady.push(r);
    }
    const slots = [], purchasePositions = [];
    for (let i = 0; i < 6; i++) {
      const c = clients[i], before = c.messages.find(m => m.t === 'lote_atribuido').posicao;
      const purchasePos = await chegarPorteiraDoSlot(c, before, i);
      purchasePositions.push(purchasePos);
      c.send({ t:'comprar_farm_lote', slotIndex:i });
      const comprado = await c.waitFor(m => m.t === 'farm_lote_comprado' && m.slot && m.slot.slotIndex === i, 7000, `compra do lote ${i}`);
      assert.equal(comprado.valor, [26000,28000,30000,32000,34000,36000][i]);
      const estadoComprado = await waitFarmState(c, m => m.farm.unlocked && m.farm.slot.slotIndex === i, `estado do lote ${i} comprado`);
      assert.equal(estadoComprado.farm.slot.plots.length, 12, `jogador ${i + 1} deve receber 12 canteiros`);
      slots.push(i);
    }
    assert.deepEqual(slots, [0,1,2,3,4,5]);
    const initialPositions = clients.slice(0, 6).map(c => {
      const p = c.messages.find(m => m.t === 'lote_atribuido')?.posicao;
      return { x: p.x, z: p.z };
    });
    assert.deepEqual([...new Set(slots)].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], 'seis contas devem ocupar setores distintos');

    // A sétima conta não recebe setor, mas pode caminhar na fazenda pública.
    const outsider = await connect(); clients.push(outsider); const out = await ready(outsider, keys.outsiderKey, 6);
    assert.equal(out.estado.farm.unlocked, false, 'a sétima conta não deve receber setor da fazenda');
    let outsiderPos = await moveTo(outsider, out.lote.posicao, { x: 0, z: 170 });
    outsiderPos = await moveTo(outsider, outsiderPos, { x: 0, z: 174 });
    outsiderPos = await moveTo(outsider, outsiderPos, { x: 15, z: 174 });
    outsiderPos = await moveTo(outsider, outsiderPos, { x: 15, z: 260 });
    outsiderPos = await moveTo(outsider, outsiderPos, { x: 15, z: 240 });
    assert.ok(outsiderPos.z > 235, `jogador sem setor deve circular no pátio/galpão público: ${JSON.stringify(outsiderPos)}`);
    // Setores fechados continuam privados: a porteira impede entrar, mas não
    // impede andar no corredor público imediatamente à frente dela.
    outsiderPos = await moveTo(outsider, outsiderPos, { x: 15, z: 174 });
    outsiderPos = await moveTo(outsider, outsiderPos, { x: -30, z: 174 });
    outsiderPos = await moveTo(outsider, outsiderPos, { x: -30, z: 178 });
    assert.ok(outsiderPos.z < 180, `setor fechado não pode ser atravessado: ${JSON.stringify(outsiderPos)}`);
    assert.equal(out.estado.farm.slots[0].portaoAberto, false);
    const low = await connect(); clients.push(low); const lowState = await ready(low, keys.lowKey, 7);
    assert.equal(lowState.estado.nivel, 9, 'a conta de teste deve estar abaixo do nível mínimo');
    low.send({ t:'comprar_farm_lote', slotIndex:0 });
    await low.waitFor(m => m.t === 'recusado' && /nível 10/i.test(m.motivo), 7000, 'bloqueio de lote abaixo do nível 10');

    const main = clients[0];
    // O dono abre a porteira do próprio setor; depois outro jogador pode
    // atravessar esse vão, como nos portões das casas.
    let mainPos = main.messages.find(m => m.t === 'lote_atribuido').posicao;
    mainPos = await moveTo(main, mainPos, { x:0, z:174 });
    mainPos = await moveTo(main, mainPos, { x:-30, z:174 });
    mainPos = await moveTo(main, mainPos, { x:-30, z:178 });
    const mainFarmMeta = main.messages.filter(m => m.t === 'estado' && m.farm && m.farm.slot).at(-1).farm.slot;
    main.send({ t:'portao', id:mainFarmMeta.portaoId });
    await main.waitFor(m => m.t === 'portao_estado' && m.farmSlotIndex === 0 && m.aberto === true, 7000, 'abertura da porteira do setor próprio');
    await waitFarmState(main, m => m.farm.slot && m.farm.slot.portaoAberto === true, 'estado com porteira própria aberta');
    outsiderPos = await moveTo(outsider, outsiderPos, { x:-30, z:182 });
    assert.ok(outsiderPos.z > 180, `o visitante deve entrar quando a porteira está aberta: ${JSON.stringify(outsiderPos)}`);
    main.send({ t:'portao', id:mainFarmMeta.portaoId });
    await main.waitFor(m => m.t === 'portao_estado' && m.farmSlotIndex === 0 && m.aberto === false, 7000, 'fechamento da porteira do setor próprio');
    outsiderPos = await moveTo(outsider, outsiderPos, { x:-30, z:174 });
    assert.ok(outsiderPos.z < 180, `o visitante já dentro deve conseguir sair após o fechamento: ${JSON.stringify(outsiderPos)}`);
    main.send({ t:'portao', id:mainFarmMeta.portaoId });
    await main.waitFor(m => m.t === 'portao_estado' && m.farmSlotIndex === 0 && m.aberto === true, 7000, 'reabertura da porteira do setor próprio');
    // Caminho legítimo: portão externo, corredor entre setores e porta central do galpão.
    let pos = mainPos;
    pos = await moveTo(main, pos, { x: 0, z: 174 });
    pos = await moveTo(main, pos, { x: -15, z: 174 });
    pos = await moveTo(main, pos, { x: -15, z: 260 });
    pos = await moveTo(main, pos, { x: 0, z: 260 });
    pos = await moveTo(main, pos, { x: 0, z: 255 });
    pos = await moveTo(main, pos, { x: -8, z: 250 });
    const beforeTables = main.messages.filter(m => m.t === 'estado' && m.farm && m.farm.slot).at(-1)?.farm.tables;
    assert.equal(beforeTables.length, 1, 'cada proprietário deve receber somente a mesa do próprio lote');
    assert.equal(beforeTables[0].farmSlotIndex, 0, 'a mesa recebida deve pertencer ao setor 0');
    main.send({ t:'farm_job', stationId:1, operation:'secagem', stockId:7001 });
    await main.waitFor(m => m.t === 'recusado' && /aproxime-se de uma mesa/i.test(m.motivo), 7000, 'bloqueio da mesa de outro lote');

    // Todas as três etapas usam somente estoque real; a mesa ocupa uma posição e produz o próximo estágio.
    for (const [operation, stockId, stage] of [['secagem', 7001, 'cura'], ['cura', 7002, 'embalagem'], ['embalagem', 7003, 'pronto']]) {
      const beforeJob = main.messages.length;
      main.send({ t: 'farm_job', stationId: 0, operation, stockId });
      const started = await main.waitFor(m => (m.t === 'farm_job_started' && m.stationId === 0 && m.operation === operation) || m.t === 'recusado', 7000, `início de ${operation}`, beforeJob);
      assert.equal(started.t, 'farm_job_started', `servidor recusou ${operation}: ${started.motivo || JSON.stringify(started)}; posição=${JSON.stringify(main.messages.filter(m => m.t === 'correcao').at(-1) || main.messages.find(m => m.t === 'lote_atribuido')?.posicao)}`);
      await main.waitFor(m => m.t === 'farm_job_ok' && m.stationId === 0 && m.operation === operation && m.estagio === stage, 7000, `conclusão de ${operation}`);
      await waitFarmState(main, m => m.estoque.some(l => l.id === stockId && l.estagio === stage), `estoque após ${operation}`);
    }
    const finalState = main.messages.filter(m => m.t === 'estado' && m.farm && m.farm.slot).at(-1);
    assert.equal(finalState.farm.tables.length, 1);
    assert.equal(finalState.farm.tables[0].farmSlotIndex, 0);
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
    pos = await moveTo(main, pos, { x: ownPlot.x, z: ownPlot.z });
    main.send({ t: 'farm_plantar', plotId: ownPlot.id, seedId: SEED.id });
    await main.waitFor(m => m.t === 'farm_plot_update' && m.slotIndex === 0 && m.localIndex === 0 && m.plot && m.plot.plant, 7000, 'plantio no canteiro próprio');
    const workerPlot = finalState.farm.slot.plots[1];
    pos = await moveTo(main, pos, { x:workerPlot.x, z:workerPlot.z });
    main.send({ t:'farm_plantar', plotId:workerPlot.id, seedId:SEED.id });
    await main.waitFor(m => m.t === 'farm_plot_update' && m.slotIndex === 0 && m.localIndex === 1 && m.plot && m.plot.plant, 7000, 'plantio do canteiro do caseiro');
    main.send({ t:'contratar_func', cargo:'caseiro' });
    const contratado = await main.waitFor(m => m.t === 'func_contratado' && m.func && m.func.cargo === 'caseiro', 7000, 'contratação do caseiro após compra do lote');
    assert.equal(contratado.func.farmSlotIndex, 0, 'caseiro deve ser vinculado ao setor comprado');
    const foreignPlot = clients[1].messages.find(m => m.t === 'estado' && m.farm)?.farm.slots.find(s => s.slotIndex === 1);
    assert.ok(foreignPlot);
    main.send({ t: 'farm_plantar', plotId: foreignPlot.plots?.[0]?.id || 'farm_1_0', seedId: SEED.id });
    await main.waitFor(m => m.t === 'recusado' && /não pertence|bloqueada/i.test(m.motivo), 7000, 'bloqueio de canteiro alheio');

    // O caseiro restaurado deve atuar no primeiro canteiro da fazenda e
    // transmitir a rega authoritative ao dono.
    await main.waitFor(m => m.t === 'farm_plots_update' && m.slotIndex === 0 &&
      (m.updates || []).some(u => u.localIndex === 1 && u.plot && u.plot.plant && u.plot.plant.agua > .9),
      12000, 'tarefa authoritative do caseiro na fazenda');
    const caseiroSnap = await waitFarmState(main, m => m.farm.slot && m.farm.slot.plots[1].plant && m.farm.slot.plots[1].plant.agua > .9,
      'snapshot após a rega authoritative do caseiro');
    assert.ok(caseiroSnap.farm.slot.plots[1].plant.agua > .9, 'o caseiro deve regar o canteiro da fazenda');

    // Saída completa: canteiro próprio -> porta do setor -> portão externo -> estrada.
    pos = await moveTo(main, pos, { x: -30, z: 178 });
    pos = await moveTo(main, pos, { x: 0, z: 178 });
    pos = await moveTo(main, pos, { x: 0, z: 170 });
    assert.ok(pos.z < 172, `o jogador deve conseguir sair pela porteira externa; posição=${JSON.stringify(pos)}`);
    // Retorno completo pela estrada e pelo vão central da porteira.
    pos = await moveTo(main, pos, { x: 0, z: 174 });
    assert.ok(pos.z > 172 && pos.x > -5 && pos.x < 5, `o jogador deve retornar pela abertura central; posição=${JSON.stringify(pos)}`);

    // Todos os seis setores devem ser acessíveis e também ter uma saída sem becos sem saída.
    for (let i = 0; i < 6; i++) {
      const c = clients[i];
      const farm = c.messages.filter(m => m.t === 'estado' && m.farm && m.farm.slot).at(-1).farm.slot;
      const top = farm.z < 210;
      const gapX = farm.x < 0 ? -15 : 15;
      let p = i === 0 ? pos : purchasePositions[i];
      if (!farm.portaoAberto) {
        c.send({ t:'portao', id:farm.portaoId });
        await c.waitFor(m => m.t === 'portao_estado' && m.farmSlotIndex === farm.slotIndex && m.aberto === true,
          7000, `abertura da porteira do setor ${farm.slotIndex}`);
      }
      p = await moveTo(c, p, { x: gapX, z: 174 });
      if (top) {
        p = await moveTo(c, p, { x: farm.x, z: 174 });
        p = await moveTo(c, p, { x: farm.x, z: farm.z - 15.5 });
      } else {
        p = await moveTo(c, p, { x: gapX, z: 174 });
        p = await moveTo(c, p, { x: gapX, z: 212 });
        p = await moveTo(c, p, { x: farm.x, z: 212 });
        p = await moveTo(c, p, { x: farm.x, z: farm.z - 14.8 });
      }
      if (top) {
        p = await moveTo(c, p, { x: farm.x, z: 174 });
        p = await moveTo(c, p, { x: farm.x, z: farm.z - 13 });
      } else {
        p = await moveTo(c, p, { x: gapX, z: 174 });
        p = await moveTo(c, p, { x: gapX, z: 212 });
        p = await moveTo(c, p, { x: farm.x, z: 212 });
        p = await moveTo(c, p, { x: farm.x, z: farm.z - 13 });
      }
      p = await moveTo(c, p, { x: farm.x, z: farm.z - 15 });
      if (!top) p = await moveTo(c, p, { x: gapX, z: farm.z - 15 });
      p = await moveTo(c, p, { x: gapX, z: 174 });
      p = await moveTo(c, p, { x: 0, z: 170 });
      assert.ok(p.z < 172, `setor ${farm.slotIndex} deve permitir saída pela porteira; posição=${JSON.stringify(p)}`);
    }

    console.log('FARM_MULTIPLAYER_OK', JSON.stringify({ setores: 6, canteirosPorJogador: 12, totalCanteiros: 72, mesas: 6, galpaoInterno: true, fazendaPublica: true, setoresPrivados: true, porteirasAuthoritative: true, caseiroAuthoritative: true, processamento: ['secagem', 'cura', 'embalagem'], posseAuthoritative: true }));
  } catch (error) {
    console.error('FARM_MULTIPLAYER_FAILED:', error.stack || error.message); process.exitCode = 1;
  } finally { clients.forEach(closeClient); await stopServer(server); removeDb(); }
})().catch(error => { console.error('FARM_MULTIPLAYER_FAILED:', error.stack || error.message); process.exitCode = 1; });

