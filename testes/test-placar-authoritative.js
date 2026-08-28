const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');

const PORT = Number(process.env.TEST_SCORE_PORT || 19126);
const DB_PATH = path.join(os.tmpdir(), `quintal-score-${process.pid}.db`);
const AUTH_SECRET = 'placar-authoritative-regression-secret';
const SERVER = path.join(__dirname, '..', 'servidor-1.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function removeDb() { for (const suffix of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + suffix, { force: true }); }
function healthOk() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT}/healthz`, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false)); req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}
async function waitHealth() { for (let i = 0; i < 100; i++) { if (await healthOk()) return; await sleep(50); } throw new Error('servidor do placar não subiu'); }
function startServer() {
  return spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH, AUTH_SECRET, DATABASE_URL: '', ALLOW_ANONYMOUS: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
}
function stopServer(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
  });
}
function connect(nome) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`), messages = [], waiters = [];
    const client = {
      ws, messages,
      send(value) { ws.send(JSON.stringify(value)); },
      waitFor(predicate, timeout = 6000, label = 'mensagem') {
        const found = messages.find(predicate); if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { const i = waiters.findIndex(w => w.res === res); if (i >= 0) waiters.splice(i, 1); rej(new Error(`timeout esperando ${label}`)); }, timeout);
          waiters.push({ predicate, res: value => { clearTimeout(timer); res(value); } });
        });
      }
    };
    ws.on('message', raw => { let msg; try { msg = JSON.parse(raw); } catch (_) { return; } messages.push(msg); for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].predicate(msg)) { const waiter = waiters.splice(i, 1)[0]; waiter.res(msg); } });
    ws.once('open', () => { client.send({ t:'hello', nome, aparelhoId:`score-${process.pid}-${nome}` }); resolve(client); });
    ws.once('error', reject);
  });
}
async function ready(client) { await client.waitFor(m => m.t === 'sessao' && m.persistId, 6000, 'sessão'); await client.waitFor(m => m.t === 'estado' && Array.isArray(m.bank), 6000, 'estado'); }

(async () => {
  removeDb(); let server; const clients = [];
  try {
    server = startServer(); await waitHealth();
    clients.push(await connect('Placar A'), await connect('Placar B'));
    await Promise.all(clients.map(ready));
    clients[0].send({ t:'placar' });
    const resposta = await clients[0].waitFor(m => m.t === 'placar' && Array.isArray(m.board), 6000, 'placar authoritative');
    assert.ok(resposta.board.length >= 2, 'as duas carteiras devem aparecer no placar');
    assert.equal(resposta.board.filter(item => item.id === 'self').length, 1, 'somente o próprio jogador deve ser marcado');
    assert.ok(resposta.board.every(item => !Object.hasOwn(item, 'chave')), 'a chave persistente não pode ser exposta');
    assert.ok(resposta.board.every(item => Number.isInteger(item.cash) && item.cash >= 0), 'saldo deve ser agregado pelo servidor');
    console.log('SCORE_AUTHORITATIVE_OK', JSON.stringify({ jogadores:resposta.board.length, proprio:resposta.board.filter(item => item.id === 'self').length, chaveExposta:false }));
  } catch (error) {
    console.error('SCORE_AUTHORITATIVE_FAILED:', error.stack || error.message); process.exitCode = 1;
  } finally {
    clients.forEach(client => { try { client.ws.close(); } catch (_) {} }); await stopServer(server); removeDb();
  }
})().catch(error => { console.error('SCORE_AUTHORITATIVE_FAILED:', error.stack || error.message); process.exitCode = 1; });
