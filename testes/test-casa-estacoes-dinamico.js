const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { WebSocket } = require('ws');

const PORT = Number(process.env.TEST_HOUSE_PORT || 19123);
const DB_PATH = path.join(os.tmpdir(), `quintal-house-${process.pid}.db`);
const AUTH_SECRET = 'house-stations-regression-secret';
const SERVER = path.join(__dirname, '..', 'servidor-1.js');
const KEY = `house_key_${process.pid}`;
const USER = `house_${process.pid}`.slice(0, 24);
const PASSWORD = 'SenhaCasa9!';
const SEED = { id: 3, nome: 'Northern Lights', cor: 0x5f9c46, gen: 0, auto: false, rar: 'comum', t: { ritmo: 66, rendimento: 58, resistencia: 88, aroma: 52, brilho: 48 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tokenFor = sub => { const p = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 3600000 })).toString('base64url'); return `${p}.${crypto.createHmac('sha256', AUTH_SECRET).update(p).digest('base64url')}`; };
function removeDb(){ for(const s of ['', '-shm', '-wal'])fs.rmSync(DB_PATH+s,{force:true}); }
function seedDb(){
 const db=new Database(DB_PATH); db.exec(`CREATE TABLE contas (usuario TEXT PRIMARY KEY,chave TEXT UNIQUE NOT NULL,nome TEXT,senha_salt TEXT NOT NULL,senha_hash TEXT NOT NULL,criado BIGINT,atualizado BIGINT);
 CREATE TABLE usuarios (chave TEXT PRIMARY KEY,nome TEXT,cash INTEGER DEFAULT 0,bank TEXT DEFAULT '[]',estoque TEXT DEFAULT '[]',up TEXT DEFAULT '{}',armas TEXT DEFAULT '{}',fert TEXT DEFAULT '{}',rack_max INTEGER DEFAULT 6,armor REAL DEFAULT 0,municao TEXT DEFAULT '{}',funcs TEXT DEFAULT '[]',imoveis TEXT DEFAULT '[]',nivel INTEGER DEFAULT 1,xp INTEGER DEFAULT 0,territorios TEXT DEFAULT '{}',atualizado INTEGER);
 CREATE TABLE lotes (idx INTEGER PRIMARY KEY,dono_chave TEXT,dono_nome TEXT,plots TEXT DEFAULT '[]',portao_aberto INTEGER DEFAULT 0);`);
 const salt=crypto.randomBytes(16).toString('hex'),hash=crypto.pbkdf2Sync(PASSWORD,salt,120000,32,'sha256').toString('hex'),now=Date.now();
 const estoque=[{id:7101,s:SEED,qtd:3,estagio:'sec',qual:.75,desde:now-1000}];
 db.prepare('INSERT INTO contas (usuario,chave,nome,senha_salt,senha_hash,criado,atualizado) VALUES (?,?,?,?,?,?,?)').run(USER,KEY,'Casa Teste',salt,hash,now,now);
 db.prepare(`INSERT INTO usuarios (chave,nome,cash,bank,estoque,up,armas,fert,rack_max,armor,municao,funcs,imoveis,nivel,xp,territorios,atualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(KEY,'Casa Teste',50000,JSON.stringify([{s:SEED,qtd:2}]),JSON.stringify(estoque),JSON.stringify({}),JSON.stringify({pistola:true}),'{}',6,0,JSON.stringify({pistola:{pente:12,reserva:24}}),'[]','[]',12,0,'{}',now);
 db.close();
}
function healthOk(){return new Promise(resolve=>{const r=http.get(`http://127.0.0.1:${PORT}/healthz`,res=>{res.resume();resolve(res.statusCode===200)});r.on('error',()=>resolve(false));r.setTimeout(500,()=>{r.destroy();resolve(false)})})}
async function waitHealth(){for(let i=0;i<100;i++){if(await healthOk())return;await sleep(50)}throw Error('servidor não subiu')}
function startServer(){return spawn(process.execPath,[SERVER],{env:{...process.env,PORT:String(PORT),DB_PATH,AUTH_SECRET,DATABASE_URL:'',ALLOW_ANONYMOUS:'0',HOUSE_SEC_S:'.1',HOUSE_CURA_S:'.1',FARM_EMBALAGEM_S:'.1',CLIENTE_FIRST_S:'60'},stdio:['ignore','ignore','pipe']})}
function connect(){return new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${PORT}`),messages=[],waiters=[];const c={ws,messages,send(v){ws.send(JSON.stringify(v))},waitFor(pred,timeout=7000,label='mensagem',after=0){const f=messages.slice(after).find(pred);if(f)return Promise.resolve(f);return new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error(`timeout ${label}`)),timeout);waiters.push({pred,res:v=>{clearTimeout(timer);res(v)}})})}};ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch(_){return}messages.push(m);for(let i=waiters.length-1;i>=0;i--)if(waiters[i].pred(m)){const w=waiters.splice(i,1)[0];w.res(m)}});ws.once('open',()=>resolve(c));ws.once('error',reject)})}
async function moveTo(c,from,to){let cur={x:from.x,z:from.z},seq=1,guard=0;while(Math.hypot(to.x-cur.x,to.z-cur.z)>.35){if(guard>900)throw Error(`rota travou em ${JSON.stringify(cur)}`);const d=Math.hypot(to.x-cur.x,to.z-cur.z),step=Math.min(1.8,d),next={x:cur.x+(to.x-cur.x)/d*step,z:cur.z+(to.z-cur.z)/d*step},before=c.messages.length,s=seq++;c.send({t:'input',seq:s,x:next.x,y:0,z:next.z,ry:0,arma:0});await sleep(145);const corr=c.messages.slice(before).find(m=>m.t==='correcao'&&m.seq===s);cur=corr?{x:corr.x,z:corr.z}:next}return cur}
(async()=>{let server,client;try{removeDb();seedDb();server=startServer();await waitHealth();client=await connect();client.send({t:'hello',token:tokenFor(KEY),nome:'Casa Teste',aparelhoId:`house-${process.pid}`});await client.waitFor(m=>m.t==='sessao',7000,'sessão');const lote=await client.waitFor(m=>m.t==='lote_atribuido',7000,'lote');const estado=await client.waitFor(m=>m.t==='estado'&&m.estoque?.some(x=>Number(x.id)===7101),7000,'estoque');assert.ok(lote.lote.estacoes.secagem&&lote.lote.estacoes.cura&&lote.lote.estacoes.embalagem,'snapshot sem três estações');client.send({t:'portao',id:lote.lote.portaoId});await client.waitFor(m=>m.t==='portao_estado'&&m.aberto===true,5000,'portão');let pos=lote.posicao;const etapas=[['secagem','sec','cura'],['cura','cura','embalagem'],['embalagem','embalagem','pronto']];for(const [nome,antes,depois] of etapas){const centro=lote.lote.estacoes[nome],alvo={x:centro.x,z:centro.z+1.45};pos=await moveTo(client,pos,alvo);await sleep(150);client.send({t:'lote_estagio',id:7101});const fim=await client.waitFor(m=>m.t==='estado'&&m.estoque?.some(x=>x.id===7101&&x.estagio===depois),7000,`avanço ${nome}`);assert.ok(fim.estoque.some(x=>x.id===7101&&x.estagio===depois),`etapa ${nome} não virou ${depois}`)}
 console.log('CASA_ESTACOES_DINAMICA_OK',JSON.stringify({estacoes:['secagem','cura','embalagem'],pipeline:['sec','cura','embalagem','pronto']}));
}catch(e){console.error('CASA_ESTACOES_DINAMICA_FAILED:',e.stack||e.message);process.exitCode=1}finally{try{if(client)client.ws.close()}catch(_){}if(server){server.kill('SIGTERM');await new Promise(r=>setTimeout(r,150))}removeDb()}})();

