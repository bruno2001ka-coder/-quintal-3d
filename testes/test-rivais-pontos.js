const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'servidor-1.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const serverTerr = server.match(/const TERRITORIOS = \[([\s\S]*?)\n\];/);
const clientTerr = client.match(/const TERR=\[([\s\S]*?)\];/);
assert.ok(serverTerr && clientTerr, 'catálogo de pontos não encontrado');
assert.equal((serverTerr[1].match(/nome:'/g) || []).length, 3, 'servidor deve ter 3 pontos');
assert.equal((clientTerr[1].match(/nome:'/g) || []).length, 3, 'cliente deve ter 3 pontos');
assert.ok(server.includes('const RIVAL_SPAWN_COUNTS = Object.freeze([2, 2, 1]);'), 'distribuição authoritative 2/2/1 ausente');
assert.ok(server.includes('const RIVAL_DANO = 8'), 'dano do rival ausente');
assert.ok(server.includes('function tiroRival(b)'), 'rotina de tiro rival ausente');
assert.ok(server.includes("else if (b.tipo === 'rival') tiroRival(b);"), 'tick não chama tiro rival');
assert.ok(client.includes("const tj=TERR.find(t=>(t.dono==='jogador'||t.dono==='rival')"), 'ponto rival não captura foco');
assert.ok(client.includes("const arma=mpArma(1);"), 'rival remoto sem arma visual');
assert.ok(client.includes("msg.t==='tiro_npc'"), 'cliente não trata tiro NPC');
console.log('RIVAIS_PONTOS_OK', JSON.stringify({ pontos: 3, bots: 5, distribuicao: [2, 2, 1], dano: 8, cadenciaMs: 1800 }));

