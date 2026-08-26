'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const WebSocket = require('ws');

const PORT = Number(process.env.TEST_HARVEST_PORT || 8816);
const DB_PATH = path.join(os.tmpdir(), `quintal-harvest-${process.pid}.db`);
const AUTH_SECRET = 'colheita-estoque-regression-secret';
const SERVER = path.join(__dirname, '..', 'servidor-1.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BASE = { id:1, nome:'Northern Lights', cor:0x5f9c46, gen:0, auto:false, rar:'comum',
  t:{ritmo:66,rendimento:58,resistencia:88,aroma:52,brilho:48} };

function tokenFor(sub) {
  const payload = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 3600000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function seedDb(chave) {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE usuarios (
    chave TEXT PRIMARY KEY, nome TEXT, cash INTEGER DEFAULT 0, bank TEXT DEFAULT '[]', estoque TEXT DEFAULT '[]',
    up TEXT DEFAULT '{}', armas TEXT DEFAULT '{}', fert TEXT DEFAULT '{}', rack_max INTEGER DEFAULT 6,
    armor REAL DEFAULT 0, municao TEXT DEFAULT '{}', funcs TEXT DEFAULT '[]', imoveis TEXT DEFAULT '[]',
    nivel INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, territorios TEXT DEFAULT '{}', atualizado INTEGER)`);
  db.exec(`CREATE TABLE lotes (idx INTEGER PRIMARY KEY, dono_chave TEXT, dono_nome TEXT,
    plots TEXT DEFAULT '[]', portao_aberto INTEGER DEFAULT 0)`);
  const plots = Array(16).fill(null);
  plots[5] = { id:'fixture-old-id', loteIndex:0, plotIndex:5, s:BASE, prog:100, agua:1, saude:1,
    praga:0, estagio:4, adubOrg:0, adubCres:0, adubFlor:false };
  db.prepare(`INSERT INTO usuarios
    (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,armor,municao,funcs,imoveis,nivel,xp,territorios,atualizado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      chave,'Teste Colheita',350,JSON.stringify([{s:BASE,qtd:2}]),'[]','{}',
      JSON.stringify({pistola:true}),'{}',6,0,JSON.stringify({}), '[]','[]',1,0,'{}',Date.now());
  db.prepare('INSERT INTO lotes (idx,dono_chave,dono_nome,plots,portao_aberto) VALUES (?,?,?,?,?)')
    .run(0,chave,'Teste Colheita',JSON.stringify(plots),0);
  db.close();
}
function healthOk() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT}/healthz`, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}
async function waitHealth() {
  for(let i=0;i<80;i++){ if(await healthOk())return; await sleep(50); }
  throw new Error('servidor de colheita não subiu');
}
function startServer() {
  return spawn(process.execPath,[SERVER],{env:{...process.env,PORT:String(PORT),DB_PATH,AUTH_SECRET},stdio:['ignore','pipe','pipe']});
}
function stopServer(child) {
  return new Promise(resolve => {
    if(!child||child.exitCode!==null)return resolve();
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},3000);
    child.once('exit',()=>{clearTimeout(timer);resolve()});
    child.kill('SIGTERM');
  });
}
function connect(token) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(`ws://127.0.0.1:${PORT}`),messages=[],waiters=[];
    const client={ws,messages,send(m){ws.send(JSON.stringify(m));},waitFor(pred,timeout=5000,label='mensagem'){
      const found=messages.find(pred);if(found)return Promise.resolve(found);
      return new Promise((res,rej)=>{const timer=setTimeout(()=>{const i=waiters.findIndex(x=>x.res===res);if(i>=0)waiters.splice(i,1);rej(new Error('timeout esperando '+label))},timeout);waiters.push({pred,res:v=>{clearTimeout(timer);res(v)},rej})});
    }};
    ws.on('open',()=>ws.send(JSON.stringify({t:'hello',token,nome:'Teste Colheita',sementeBase:BASE})));
    ws.on('message',raw=>{let m;try{m=JSON.parse(String(raw))}catch(_){return}messages.push(m);for(let i=waiters.length-1;i>=0;i--)if(waiters[i].pred(m)){const w=waiters.splice(i,1)[0];w.res(m)}});
    ws.once('error',reject);
    client.waitFor(m=>m.t==='estado',6000,'estado inicial').then(()=>resolve(client),reject);
  });
}
async function moveTo(c,from,to){
  let cur={x:from.x,z:from.z};
  while(Math.hypot(to.x-cur.x,to.z-cur.z)>.45){
    const d=Math.hypot(to.x-cur.x,to.z-cur.z),step=Math.min(2.3,d);
    cur={x:cur.x+(to.x-cur.x)/d*step,z:cur.z+(to.z-cur.z)/d*step};
    c.send({t:'input',seq:Math.floor(Date.now()%1e8),x:cur.x,y:0,z:cur.z,ry:0,arma:0});
    await sleep(300);
  }
}

(async()=>{
  for(const suffix of ['', '-shm', '-wal'])fs.rmSync(DB_PATH+suffix,{force:true});
  const chave='u_harvest_fixture_'+process.pid;
  seedDb(chave);
  let server=null,client=null;
  try{
    server=startServer();await waitHealth();
    client=await connect(tokenFor(chave));
    const atrib=client.messages.find(m=>m.t==='lote_atribuido');
    const estadoInicial=client.messages.find(m=>m.t==='estado');
    assert.equal(atrib.loteIndex,0,'o token fixture deve recuperar o lote 0');
    const p=atrib.lote.plots[5];
    assert.equal(p.estagio,4,'a fixture deve chegar pronta para colher');
    assert.equal(p.prog,100,'a fixture deve ter progresso 100');
    await moveTo(client,atrib.posicao,{x:atrib.lote.x-2.2,z:atrib.lote.z-1.4});
    const before=client.messages.length;
    client.send({t:'colher',id:p.id});
    const loteUpdate=await client.waitFor(m=>m.t==='lote_update'&&m.loteIndex===0&&m.plotIndex===5&&m.plot===null,5000,'lote_update de colheita');
    const colheita=await client.waitFor(m=>m.t==='colheita'&&Number(m.qtd)>0,5000,'confirmação de colheita');
    const estado=await client.waitFor(m=>m.t==='estado'&&Array.isArray(m.estoque)&&m.estoque.some(l=>l.estagio==='sec'&&l.qtd===m.estoque.find(x=>x.id===l.id)?.qtd),5000,'estoque após colheita');
    const iUpdate=client.messages.indexOf(loteUpdate),iColheita=client.messages.indexOf(colheita),iEstado=client.messages.indexOf(estado);
    assert.ok(iUpdate>=before&&iUpdate<iColheita,'o servidor deve limpar o plot antes de confirmar a colheita');
    assert.ok(iColheita<iEstado,'o estado da carteira deve vir após a confirmação');
    assert.equal(estado.estoque.length,1,'a carteira deve receber um lote de produção');
    assert.equal(estado.estoque[0].estagio,'sec','a produção recém-colhida deve entrar como secando');
    assert.equal(estado.estoque[0].qtd,colheita.qtd,'quantidade do estoque deve ser a mesma confirmada pelo servidor');
    assert.equal(estado.estoque[0].s.nome,'Northern Lights');
    console.log('HARVEST_STOCK_REGRESSION_OK',JSON.stringify({qtd:colheita.qtd,estagio:estado.estoque[0].estagio,ordem:[loteUpdate.t,colheita.t,estado.t]}));
  }catch(err){console.error('HARVEST_STOCK_REGRESSION_FAILED:',err.stack||err.message);process.exitCode=1}
  finally{try{if(client)client.ws.close()}catch(_){}await stopServer(server);for(const suffix of ['', '-shm', '-wal'])fs.rmSync(DB_PATH+suffix,{force:true})}
})().catch(err=>{console.error('HARVEST_STOCK_REGRESSION_FAILED:',err.stack||err.message);process.exitCode=1});
