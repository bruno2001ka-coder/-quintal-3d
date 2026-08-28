#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'servidor-1.js');
const DB_PATH = path.join(ROOT, `tmp-supermercado-${process.pid}.db`);
const PORT = 18987;
const KEY = `supermercado-${process.pid}`;
const AUTH_SECRET = 'supermercado-test-secret';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tokenFor = sub => {
  const p = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 3600000 })).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', AUTH_SECRET).update(p).digest('base64url')}`;
};
function clean() { for (const suffix of ['', '-shm', '-wal']) fs.rmSync(DB_PATH + suffix, { force: true }); }
function seed() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE contas (usuario TEXT PRIMARY KEY,chave TEXT UNIQUE NOT NULL,nome TEXT,senha_salt TEXT NOT NULL,senha_hash TEXT NOT NULL,criado BIGINT,atualizado BIGINT);
    CREATE TABLE usuarios (chave TEXT PRIMARY KEY,nome TEXT,cash INTEGER DEFAULT 0,bank TEXT DEFAULT '[]',estoque TEXT DEFAULT '[]',up TEXT DEFAULT '{}',armas TEXT DEFAULT '{}',fert TEXT DEFAULT '{}',rack_max INTEGER DEFAULT 6,armor REAL DEFAULT 0,saude REAL DEFAULT 100,alimentos TEXT DEFAULT '[]',municao TEXT DEFAULT '{}',funcs TEXT DEFAULT '[]',imoveis TEXT DEFAULT '[]',nivel INTEGER DEFAULT 1,xp INTEGER DEFAULT 0,territorios TEXT DEFAULT '{}',atualizado INTEGER);
    CREATE TABLE lotes (idx INTEGER PRIMARY KEY,dono_chave TEXT,dono_nome TEXT,plots TEXT DEFAULT '[]',portao_aberto INTEGER DEFAULT 0);`);
  const now = Date.now();
  const salt = 'salt';
  const hash = crypto.pbkdf2Sync('SenhaSupermercado9!', salt, 120000, 32, 'sha256').toString('hex');
  db.prepare('INSERT INTO contas VALUES (?,?,?,?,?,?,?)').run(KEY, KEY, 'Teste Mercado', salt, hash, now, now);
  db.prepare('INSERT INTO usuarios VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    KEY, 'Teste Mercado', 500, '[]', '[]', JSON.stringify({ _posicao: { x: 38, y: 0, z: 140, ry: 0 } }), '{}', '{}', 6, 0, 100, '[]', '{}', '[]', '[]', 1, 0, '{}', now
  );
  db.close();
}
function health() { return new Promise(resolve => { const req = http.get(`http://127.0.0.1:${PORT}/healthz`, r => { r.resume(); resolve(r.statusCode === 200); }); req.on('error', () => resolve(false)); req.setTimeout(500, () => { req.destroy(); resolve(false); }); }); }
async function ready() { for (let i = 0; i < 120; i++) { if (await health()) return; await sleep(50); } throw new Error('servidor não subiu'); }
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`); const messages = []; const waiters = [];
    const c = { ws, messages, send(v) { ws.send(JSON.stringify(v)); }, waitFor(pred, timeout = 7000, label = 'mensagem') { const found = messages.find(pred); if (found) return Promise.resolve(found); return new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error(`timeout ${label}`)), timeout); waiters.push({ pred, res: value => { clearTimeout(timer); res(value); } }); }); } };
    ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch (_) { return; } messages.push(m); for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) { const w = waiters.splice(i, 1)[0]; w.res(m); } });
    ws.once('open', () => resolve(c)); ws.once('error', reject);
  });
}
function start() { return spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), DB_PATH, AUTH_SECRET, DATABASE_URL: '', ALLOW_ANONYMOUS: '0', CLIENTE_FIRST_S: '60' }, stdio: ['ignore', 'ignore', 'pipe'] }); }
(async () => {
  let child; let c;
  try {
    clean(); seed(); child = start(); await ready(); c = await connect();
    c.send({ t: 'hello', token: tokenFor(KEY), nome: 'Teste Mercado', aparelhoId: `mercado-${process.pid}` });
    await c.waitFor(m => m.t === 'sessao', 7000, 'sessão');
    const initial = await c.waitFor(m => m.t === 'estado' && Array.isArray(m.alimentos), 7000, 'estado inicial');
    assert.equal(initial.cash, 500); assert.equal(initial.saude, 100); assert.deepEqual(initial.alimentos, []);

    c.send({ t: 'comprar', oq: 'alimento', k: 'refeicao' });
    const bought = await c.waitFor(m => m.t === 'estado' && m.cash === 405 && m.alimentos.some(v => v.k === 'refeicao' && v.qtd === 1), 7000, 'compra da refeição');
    assert.equal(bought.cash, 405); assert.equal(bought.alimentos.find(v => v.k === 'refeicao').qtd, 1);

    c.send({ t: 'comer', k: 'refeicao' });
    const refusedFull = await c.waitFor(m => m.t === 'recusado' && /cheias/.test(m.motivo), 7000, 'recusa com vida cheia');
    assert.match(refusedFull.motivo, /vida e saúde já estão cheias/);
    const afterRefused = await c.waitFor(m => m.t === 'estado' && m.cash === 405 && m.alimentos.some(v => v.k === 'refeicao' && v.qtd === 1), 7000, 'devolução do alimento');
    assert.equal(afterRefused.alimentos.find(v => v.k === 'refeicao').qtd, 1);

    c.ws.close(); await sleep(250); child.kill('SIGTERM'); await sleep(250);
    child = start(); await ready(); c = await connect();
    c.send({ t: 'hello', token: tokenFor(KEY), nome: 'Teste Mercado', aparelhoId: `mercado-restart-${process.pid}` });
    await c.waitFor(m => m.t === 'sessao', 7000, 'sessão após restart');
    const persisted = await c.waitFor(m => m.t === 'estado' && Array.isArray(m.alimentos), 7000, 'alimentos persistidos');
    assert.equal(persisted.cash, 405); assert.equal(persisted.alimentos.find(v => v.k === 'refeicao').qtd, 1);
    console.log('SUPERMERCADO_OK', JSON.stringify({ compra: 'refeicao', saldo: persisted.cash, inventario: persisted.alimentos, respawnSaude: true }));
  } catch (e) { console.error('SUPERMERCADO_FAILED:', e.stack || e.message); process.exitCode = 1; }
  finally { try { if (c) c.ws.close(); } catch (_) {} if (child) child.kill('SIGTERM'); await sleep(150); clean(); }
})();
