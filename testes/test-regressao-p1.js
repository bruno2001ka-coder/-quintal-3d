const WebSocket = require('ws');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const URL = process.env.TEST_WS || 'ws://127.0.0.1:8920';
const SECRET = process.env.AUTH_SECRET || 'p1-regressao';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function tokenExpirado() {
  const payload = Buffer.from(JSON.stringify({ sub:'u-expirado', exp:Date.now()-1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function connect(token, nome) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL), messages = [];
    const client = {
      ws, messages,
      send(m) { ws.send(JSON.stringify(m)); },
      wait(pred, timeout = 4000) {
        const old = messages.find(pred); if (old) return Promise.resolve(old);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { ws.off('message', on); rej(new Error('timeout de mensagem P1')); }, timeout);
          const on = raw => { let m; try { m = JSON.parse(raw); } catch (_) { return; }
            if (!pred(m)) return; clearTimeout(timer); ws.off('message', on); res(m); };
          ws.on('message', on);
        });
      }
    };
    ws.on('message', raw => { try { messages.push(JSON.parse(raw)); } catch (_) {} });
    ws.once('open', () => { client.send({ t:'hello', token:token || '', nome: nome || 'P1' }); resolve(client); });
    ws.once('error', reject);
  });
}

(async () => {
  const expirado = await connect(tokenExpirado(), 'token expirado');
  const recusaExpirada = await expirado.wait(m => m.t === 'login_required');
  assert.match(recusaExpirada.motivo, /sessão inválida|expirada|conta/i);
  expirado.ws.close();

  const a = await connect('', 'sessão A');
  const sessao = await a.wait(m => m.t === 'sessao');
  await a.wait(m => m.t === 'estado');
  const b = await connect(sessao.token, 'sessão duplicada');
  const recusaDuplicada = await b.wait(m => m.t === 'recusado');
  assert.match(recusaDuplicada.motivo, /conectada/i);
  a.ws.close(); b.ws.close();

  const servidor = fs.readFileSync(path.join(__dirname, '..', 'servidor-1.js'), 'utf8');
  const cliente = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(servidor, /carteiraPronta/);
  assert.match(servidor, /j\.ultimoMov\s*=\s*agora\(\)\s*-\s*250/);
  assert.match(servidor, /rotaSaidaCliente\(lotes\[contexto\.cliente\.loteIndex\]\)/);
  assert.match(servidor, /Object\.create\(null\)/);
  assert.match(servidor, /\[2\.0,3\.5,-1\.8,-1\.5999999999999999\][\s\S]*\[4\.9,6\.4,-1\.8,-1\.5999999999999999\]/,
    'o servidor deve deixar a porta central da estufa livre');
  assert.match(cliente, /const vaoEstufa=1\.4/,
    'o cliente deve criar a mesma abertura de estufa');
  assert.match(cliente, /escaparHTML\(kid\.nome/);
  assert.match(cliente, /mpLimparEntidades\(\)/);
  assert.match(cliente, /sem conexão com o servidor/);
  await sleep(100);
  console.log('REGRESSAO_P1_OK');
})().catch(err => { console.error('REGRESSAO_P1_FAILED:', err.stack || err.message); process.exitCode = 1; });
