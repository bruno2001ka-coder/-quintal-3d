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

const PORT = Number(process.env.TEST_MODULES_PORT || 19117);
const DB_PATH = path.join(os.tmpdir(), `quintal-modulos-${process.pid}.db`);
const AUTH_SECRET = 'modulos-negocios-funcionarios-cruzar-regression-secret';
const SERVER = path.join(__dirname, '..', 'servidor-1.js');
const USER = `modulos_${process.pid}`.slice(0, 24);
const OBS_USER = `obs_${process.pid}`.slice(0, 24);
const PASSWORD = 'SenhaModulos9!';
const NAME = 'Teste Módulos';
const OBS_NAME = 'Observador Módulos';
const BASE_A = { id: 3, nome: 'Northern Lights', cor: 0x5f9c46, gen: 0, auto: false, rar: 'comum',
  nivelMin: 1, qualidade: 3, slug: 'northern-lights', aromaPerfil: 'pinho, terra e madeira doce', cheiro: 'resinoso, terroso e picante',
  t: { ritmo: 66, rendimento: 58, resistencia: 88, aroma: 52, brilho: 48 } };
const BASE_B = { id: 4, nome: 'White Widow', cor: 0xc9d8bc, gen: 0, auto: false, rar: 'comum',
  nivelMin: 1, qualidade: 3, slug: 'white-widow', aromaPerfil: 'terra, especiarias e pimenta', cheiro: 'pungente, herbal e apimentado',
  t: { ritmo: 58, rendimento: 62, resistencia: 74, aroma: 60, brilho: 92 } };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tokenFor = sub => {
  const payload = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 3600000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
};

function removeDb() {
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + suffix, { force: true });
}

function insertAccount(db, { usuario, chave, nome, estoque = [], bank = [] }) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PASSWORD, salt, 120000, 32, 'sha256').toString('hex');
  const agora = Date.now();
  db.prepare('INSERT INTO contas (usuario,chave,nome,senha_salt,senha_hash,criado,atualizado) VALUES (?,?,?,?,?,?,?)')
    .run(usuario, chave, nome, salt, hash, agora, agora);
  db.prepare(`INSERT INTO usuarios
    (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,armor,municao,funcs,imoveis,nivel,xp,territorios,atualizado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(chave, nome, 10000, JSON.stringify(bank), JSON.stringify(estoque), '{}',
      JSON.stringify({ pistola: true }), '{}', 6, 0,
      JSON.stringify({ pistola: { pente: 12, reserva: 24 } }), '[]', '[]', 1, 0, '{}', agora);
}

function seedDb(mainKey, observerKey) {
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
  const readyStock = [{ id: 9001, s: BASE_A, qtd: 3, estagio: 'pronto', qual: 1, desde: Date.now() }];
  const plots = Array(16).fill(null);
  plots[0] = { s: BASE_A, prog: 100, agua: 1, saude: 1, praga: 0, estagio: 4,
    adubOrg: 0, adubCres: 0, adubFlor: false };
  insertAccount(db, { usuario: USER, chave: mainKey, nome: NAME,
    bank: [{ s: BASE_A, qtd: 2 }, { s: BASE_B, qtd: 1 }], estoque: readyStock });
  insertAccount(db, { usuario: OBS_USER, chave: observerKey, nome: OBS_NAME });
  db.prepare('INSERT INTO lotes (idx,dono_chave,dono_nome,plots,portao_aberto) VALUES (?,?,?,?,?)')
    .run(0, mainKey, NAME, JSON.stringify(plots), 0);
  db.close();
}

function healthOk() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT}/healthz`, res => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}
async function waitHealth() {
  for (let i = 0; i < 100; i++) { if (await healthOk()) return; await sleep(50); }
  throw new Error('servidor de módulos não subiu');
}
function startServer() {
  return spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), DB_PATH, AUTH_SECRET, ALLOW_ANONYMOUS: '0',
      CLIENTE_FIRST_S: '1', CLIENTE_MIN_S: '1', CLIENTE_MAX_S: '2' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
}
function stopServer(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const messages = [];
    const waiters = [];
    const client = {
      ws, messages,
      send(value) { ws.send(JSON.stringify(value)); },
      waitFor(predicate, timeout = 6000, label = 'mensagem') {
        const found = messages.find(predicate);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const i = waiters.findIndex(w => w.res === res);
            if (i >= 0) waiters.splice(i, 1);
            rej(new Error(`timeout esperando ${label}`));
          }, timeout);
          waiters.push({ predicate, res: value => { clearTimeout(timer); res(value); }, rej });
        });
      }
    };
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          const waiter = waiters.splice(i, 1)[0]; waiter.res(msg);
        }
      }
    });
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}
async function ready(client, token, name) {
  client.send({ t: 'hello', token, nome: name, avatarId: 'verde', aparelhoId: `fixture-${process.pid}` });
  const sessao = await client.waitFor(m => m.t === 'sessao' && m.token, 6000, 'sessão');
  const lote = await client.waitFor(m => m.t === 'lote_atribuido', 6000, 'lote');
  const estado = await client.waitFor(m => m.t === 'estado' && Array.isArray(m.bank), 6000, 'estado');
  return { sessao, lote, estado };
}
async function waitSnap(client, predicate, label) {
  return client.waitFor(m => m.t === 'snap' && predicate(m), 9000, label);
}
async function moveTo(client, from, to) {
  let cur = { x: from.x, z: from.z }, seq = 1;
  while (Math.hypot(to.x - cur.x, to.z - cur.z) > .35) {
    const d = Math.hypot(to.x - cur.x, to.z - cur.z);
    const step = Math.min(2.1, d);
    cur = { x: cur.x + (to.x - cur.x) / d * step, z: cur.z + (to.z - cur.z) / d * step };
    client.send({ t: 'input', seq: seq++, x: cur.x, y: 0, z: cur.z, ry: 0, arma: 0 });
    await sleep(170);
  }
}
function closeClient(client) {
  try { if (client && client.ws.readyState <= 1) client.ws.close(); } catch (_) {}
}

(async () => {
  let server;
  let client;
  let observer;
  const mainKey = `u_fixture_${process.pid}`;
  const observerKey = `u_observer_${process.pid}`;
  try {
    removeDb();
    seedDb(mainKey, observerKey);
    server = startServer();
    await waitHealth();

    client = await connect();
    const initial = await ready(client, tokenFor(mainKey), NAME);
    assert.equal(initial.lote.loteIndex, 0, 'a fixture principal deve recuperar o lote 0');
    assert.equal(initial.estado.cash, 10000);
    assert.equal(initial.estado.bank.find(e => e.s.id === BASE_A.id).qtd, 2);

    const cashBeforeFunc = initial.estado.cash;
    client.send({ t: 'contratar_func', cargo: 'zelador' });
    const contratado = await client.waitFor(m => m.t === 'func_contratado' && m.func && m.func.cargo === 'zelador', 6000, 'contratação do zelador');
    const afterFunc = await client.waitFor(m => m.t === 'estado' && m.cash === cashBeforeFunc - 1200 && m.funcs.some(f => f.cargo === 'zelador'), 6000, 'estado após funcionário');
    assert.equal(afterFunc.funcs.filter(f => f.cargo === 'zelador').length, 1);
    assert.equal(contratado.func.id, afterFunc.funcs.find(f => f.cargo === 'zelador').id, 'evento e estado devem referir o mesmo funcionário');

    client.send({ t: 'contratar_func', cargo: 'zelador' });
    const duplicate = await client.waitFor(m => m.t === 'recusado' && /já contratado/i.test(m.motivo), 6000, 'bloqueio de funcionário duplicado');
    assert.match(duplicate.motivo, /já contratado/i);
    await sleep(150);
    const latestFuncState = client.messages.filter(m => m.t === 'estado' && Array.isArray(m.funcs)).at(-1);
    assert.equal(latestFuncState.cash, afterFunc.cash, 'tentativa duplicada não deve cobrar novamente');

    // Reinício do servidor comprova persistência em banco, não apenas cache do processo.
    closeClient(client);
    await sleep(180);
    await stopServer(server);
    server = startServer();
    await waitHealth();
    client = await connect();
    const afterRestart = await ready(client, tokenFor(mainKey), NAME);
    assert.equal(afterRestart.lote.loteIndex, 0);
    assert.equal(afterRestart.estado.cash, afterFunc.cash, 'saldo do funcionário deve sobreviver ao reinício');
    assert.equal(afterRestart.estado.funcs.filter(f => f.cargo === 'zelador').length, 1, 'funcionário deve reaparecer após reinício');
    assert.equal(afterRestart.estado.funcs[0].id, contratado.func.id, 'o funcionário persistido deve manter sua identidade');

    // Tarefa server-side: um colhedor deve limpar uma planta pronta e atualizar
    // imediatamente a carteira do dono, além do evento de lote.
    const cashBeforeHarvester = afterRestart.estado.cash;
    client.send({ t: 'contratar_func', cargo: 'colhedor' });
    const harvester = await client.waitFor(m => m.t === 'func_contratado' && m.func && m.func.cargo === 'colhedor', 6000, 'contratação do colhedor');
    const afterHarvester = await client.waitFor(m => m.t === 'estado' && m.cash === cashBeforeHarvester - 2200 && m.funcs.some(f => f.cargo === 'colhedor'), 6000, 'estado após contratação do colhedor');
    await client.waitFor(m => m.t === 'lote_update' && m.loteIndex === 0 && m.plotIndex === 0 && m.plot === null, 12000, 'colheita authoritative do colhedor');
    const harvestedState = await client.waitFor(m => m.t === 'estado' && m.estoque.some(l => l.id !== 9001 && l.estagio === 'sec'), 6000, 'estado da carteira após colheita do colhedor');
    assert.ok(harvestedState.estoque.some(l => l.s.id === BASE_A.id && l.estagio === 'sec'), 'a produção do funcionário deve entrar no estoque do dono');

    // Cruzar: IDs reais e genética são lidos do banco; filho, geração, débito e consumo vêm do servidor.
    const cashBeforeCross = afterHarvester.cash;
    client.send({ t: 'cruzar', a: 999999999, b: BASE_B.id });
    const forged = await client.waitFor(m => m.t === 'recusado' && /sem essas sementes/i.test(m.motivo), 6000, 'bloqueio de semente forjada');
    assert.match(forged.motivo, /sem essas sementes/i);
    client.send({ t: 'cruzar', a: BASE_B.id, b: BASE_B.id });
    const sameSingle = await client.waitFor(m => m.t === 'recusado' && /duas sementes|insuficientes/i.test(m.motivo), 6000, 'bloqueio de mesma semente com uma unidade');
    assert.match(sameSingle.motivo, /duas sementes|insuficientes/i);
    client.send({ t: 'cruzar', a: BASE_A.id, b: BASE_B.id });
    const crossed = await client.waitFor(m => m.t === 'cruzamento_ok' && m.filho && m.filho.id, 6000, 'cruzamento válido');
    const afterCross = await client.waitFor(m => m.t === 'estado' && m.cash === cashBeforeCross - 120 && m.bank.some(e => e.s.id === crossed.filho.id), 6000, 'estado após cruzamento');
    assert.equal(afterCross.bank.find(e => e.s.id === BASE_A.id).qtd, 1, 'uma das duas sementes A deve permanecer');
    assert.equal(afterCross.bank.find(e => e.s.id === BASE_B.id), undefined, 'a semente B unitária deve ser consumida');
    assert.equal(afterCross.bank.find(e => e.s.id === crossed.filho.id).qtd, 2, 'o filho deve entrar com quantidade 2');
    assert.equal(crossed.filho.gen, 0, 'o cruzamento deve retornar uma genética oficial');
    assert.ok([1, 2, 3, 4, 5, 6, 7, 8].includes(crossed.filho.id), 'o filho deve pertencer às oito genéticas oficiais');
    assert.notEqual(crossed.filho.id, BASE_A.id);
    assert.notEqual(crossed.filho.id, BASE_B.id);
    // O primeiro cruzamento continua no histórico do socket. Limpar a fila
    // antes da segunda ação evita que waitFor consuma um evento antigo.
    client.messages.length = 0;
    client.send({ t: 'cruzar', a: crossed.filho.id, b: crossed.filho.id });
    const sameChild = await client.waitFor(m => m.t === 'cruzamento_ok' && m.filho && [1, 2, 3, 4, 5, 6, 7, 8].includes(m.filho.id), 6000, 'cruzamento da mesma semente com duas unidades');
    const afterSameCross = await client.waitFor(m => m.t === 'estado' && m.cash === cashBeforeCross - 240 && m.bank.some(e => e.s.id === sameChild.filho.id), 6000, 'estado após segundo cruzamento');
    assert.equal(sameChild.filho.gen, 0, 'duas unidades devem continuar apontando para uma genética oficial');

    // Multiplayer: a segunda conta ocupa outro lote e recebe seu próprio cliente NPC.
    observer = await connect();
    const observerReady = await ready(observer, tokenFor(observerKey), OBS_NAME);
    assert.equal(observerReady.lote.loteIndex, 1, 'a conta observadora deve receber outro lote');
    const loteMain = afterRestart.lote.lote;
    const loteOther = observerReady.lote.lote;
    assert.ok(loteMain && loteMain.portaoId && loteOther && loteOther.portaoId);
    client.send({ t: 'portao', id: loteMain.portaoId });
    observer.send({ t: 'portao', id: loteOther.portaoId });
    await client.waitFor(m => m.t === 'portao_estado' && m.loteIndex === 0 && m.aberto === true, 6000, 'portão do lote principal');
    await observer.waitFor(m => m.t === 'portao_estado' && m.loteIndex === 1 && m.aberto === true, 6000, 'portão do lote observador');
    const mainCustomerSnap = await waitSnap(client, snap => (snap.clientes || []).some(c => c.loteIndex === 0 && c.fase === 'atendendo'), 'cliente atendendo no lote principal');
    const otherCustomerSnap = await waitSnap(observer, snap => (snap.clientes || []).some(c => c.loteIndex === 1 && c.fase === 'atendendo'), 'cliente atendendo no lote observador');
    const mainNpc = mainCustomerSnap.clientes.find(c => c.loteIndex === 0 && c.fase === 'atendendo');
    const otherNpc = otherCustomerSnap.clientes.find(c => c.loteIndex === 1 && c.fase === 'atendendo');
    assert.ok(mainNpc && otherNpc);
    const ownFuncSnap = await waitSnap(observer, snap => (snap.funcs || []).some(f => f.id === contratado.func.id), 'funcionário visível em snapshot multiplayer');
    assert.ok(ownFuncSnap.funcs.some(f => f.id === contratado.func.id), 'a entidade do funcionário deve aparecer nos snapshots AOI');

    // A posição inicial fica dentro do lote; mover até a bancada respeita a validação de velocidade.
    const bench = { x: loteMain.x + 6.8, z: loteMain.z + 3.6 };
    await moveTo(client, afterRestart.lote.posicao, bench);
    const cashBeforeSale = afterSameCross.cash;
    const xpBeforeSale = afterSameCross.xp;
    const expectedValue = Math.round((16 + 62.4 * .42) * 2 * mainNpc.mult);
    client.send({ t: 'vender', id: 9001, qtd: 2, onde: 'balcao', clienteId: mainNpc.id });
    const sale = await client.waitFor(m => m.t === 'venda_ok' && m.estoqueId === 9001 && m.clienteId === mainNpc.id, 6000, 'venda no balcão');
    const afterSale = await client.waitFor(m => m.t === 'estado' && m.cash === cashBeforeSale + sale.valor && m.estoque.some(l => l.id === 9001 && l.qtd === 1), 6000, 'estado após venda');
    assert.equal(sale.valor, expectedValue, 'preço deve seguir a fórmula authoritative do servidor');
    assert.equal(afterSale.xp, xpBeforeSale + Math.max(1, Math.round(sale.valor / 12)), 'XP deve seguir a regra authoritative');
    assert.equal(afterSale.estoque.find(l => l.id === 9001).qtd, 1);

    // Cliente de outro lote não pode comprar no balcão deste jogador.
    const cashBeforeWrongCustomer = afterSale.cash;
    client.send({ t: 'vender', id: 9001, qtd: 1, onde: 'balcao', clienteId: otherNpc.id });
    const wrongCustomer = await client.waitFor(m => m.t === 'recusado' && /fora do local de venda/i.test(m.motivo), 6000, 'bloqueio de cliente de outro lote');
    assert.match(wrongCustomer.motivo, /fora do local de venda/i);
    await sleep(120);
    const lastSaleState = client.messages.filter(m => m.t === 'estado' && Array.isArray(m.estoque)).at(-1);
    assert.equal(lastSaleState.cash, cashBeforeWrongCustomer, 'venda rejeitada não deve alterar o saldo');
    assert.equal(lastSaleState.estoque.find(l => l.id === 9001).qtd, 1, 'venda rejeitada não deve remover estoque');

    console.log('MODULOS_NEGOCIOS_OK', JSON.stringify({
      funcionario: { cargo: contratado.func.cargo, id: contratado.func.id, cobranca: 1200, duplicidadeBloqueada: true, persistiuNoReinicio: true, visivelNoAOI: true, colhedorAtualizouEstado: true, colhedorId: harvester.func.id },
      cruzar: { filhoId: crossed.filho.id, gen: crossed.filho.gen, cobranca: 120, mesmasDuasUnidadesAceitas: sameChild.filho.gen === 0, payloadForjadoBloqueado: true, unidadeUnicaBloqueada: true },
      negocios: { clienteProprio: mainNpc.id, clienteAlheio: otherNpc.id, valor: sale.valor, qtd: sale.qtd, estoqueRestante: 1, vendaConfirmada: true, vendaAlheiaBloqueada: true }
    }));
  } catch (error) {
    console.error('MODULOS_NEGOCIOS_FAILED:', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    closeClient(client); closeClient(observer);
    await stopServer(server);
    removeDb();
  }
})().catch(error => {
  console.error('MODULOS_NEGOCIOS_FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
