const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'servidor-1.js'), 'utf8');

const serverBlock = server.match(/const CATALOGO_SEMENTES = \[(.*?)\n\]\.map/s)?.[1];
assert.ok(serverBlock, 'catálogo do servidor não encontrado');
const serverSeeds = [...serverBlock.matchAll(/\{ id:(\d+), nome:'([^']+)', cor:(0x[0-9a-f]+), auto:(true|false), nivelMin:(\d+), qualidade:(\d+),[^\n]*t:\[([^\]]+)\] \}/g)]
  .map(m => ({ id:Number(m[1]), nome:m[2], cor:Number(m[3]), auto:m[4] === 'true', nivelMin:Number(m[5]), qualidade:Number(m[6]), traits:m[7].split(',').map(Number) }));
assert.equal(serverSeeds.length, 8, 'o servidor deve ter exatamente oito entradas');

const clientCalls = [...client.matchAll(/mk[AS]\('([^']+)',(0x[0-9a-f]+),\{([^}]+)\}/g)];
assert.equal(clientCalls.length, 8, 'o cliente deve ter exatamente oito entradas');
const clientSeeds = clientCalls.map((m, i) => {
  const traits = Object.fromEntries([...m[3].matchAll(/(ritmo|rendimento|resistencia|aroma|brilho):(\d+)/g)].map(x => [x[1], Number(x[2])]));
  return { id:i + 1, nome:m[1], cor:Number(m[2]), auto:/mkA\(/.test(m[0]), traits };
});

assert.deepEqual(clientSeeds.map(s => s.id), serverSeeds.map(s => s.id), 'IDs cliente/servidor devem coincidir');
assert.deepEqual(clientSeeds.map(s => s.nome), serverSeeds.map(s => s.nome), 'nomes cliente/servidor devem coincidir');
for (let i = 0; i < 8; i++) {
  assert.equal(clientSeeds[i].cor, serverSeeds[i].cor, `cor divergente em ${serverSeeds[i].nome}`);
  assert.equal(clientSeeds[i].auto, serverSeeds[i].auto, `tipo auto/fotoperíodo divergente em ${serverSeeds[i].nome}`);
  assert.deepEqual(Object.values(clientSeeds[i].traits), serverSeeds[i].traits, `atributos divergentes em ${serverSeeds[i].nome}`);
}

const clientById = new Map(clientSeeds.map(s => [s.id, s]));
const accepted = serverSeeds.filter(s => {
  const local = clientById.get(s.id);
  return local && local.nome === s.nome && local.cor === s.cor && local.auto === s.auto;
});
assert.equal(accepted.length, 8, 'as oito respostas authoritative devem ser reconhecidas pelo cliente');
assert.deepEqual(serverSeeds.filter(s => s.nivelMin === 10).map(s => s.auto), [true, true, false, false]);
assert.deepEqual(serverSeeds.filter(s => s.nivelMin === 11).map(s => s.auto), [true, true, false, false]);

function cycle(seed) {
  return seed.auto ? 86 - seed.traits[0] * .45 : 150 - seed.traits[0] * .95;
}
const cycles = serverSeeds.map(s => ({ id:s.id, nome:s.nome, ciclo:cycle(s) }));
assert.ok(cycles.every(s => Number.isFinite(s.ciclo) && s.ciclo > 0), 'todo ciclo deve ser positivo');
assert.equal(new Set(cycles.map(s => s.ciclo)).size, 8, 'as oito genéticas devem ter ciclos distinguíveis');

function stageFor(prog) {
  return prog >= 100 ? 4 : prog >= 75 ? 3 : prog >= 50 ? 2 : prog >= 25 ? 1 : 0;
}
function simulateGrowth(seed) {
  let prog = 0, agua = 1, saude = 1, stage = 0;
  const transitions = [];
  const ciclo = cycle(seed);
  for (let second = 1; second <= 180 && stage < 4; second++) {
    const luz = seed.auto ? Math.max(.82, 1.05) : 1.05; // grow room sem LED extra
    agua = Math.max(0, agua - .0045 * (.6 + (100 - seed.traits[2]) / 100 * .9) * (0.55 + luz * .85));
    const aguaF = .35 + Math.min(.65, Math.max(0, agua) * 1.7);
    const taxa = (100 / ciclo) * 1.35 * luz * aguaF * (.55 + saude * .45);
    prog = Math.min(100, prog + taxa);
    const next = stageFor(prog);
    if (next !== stage) { stage = next; transitions.push({ stage, second, prog:Number(prog.toFixed(2)) }); }
  }
  return { id:seed.id, nome:seed.nome, auto:seed.auto, ciclo:Number(ciclo.toFixed(2)), finalStage:stage, transitions };
}
const growth = serverSeeds.map(seed => simulateGrowth({ ...seed, traits: seed.traits }));
for (const result of growth) {
  assert.deepEqual(result.transitions.map(t => t.stage), [1, 2, 3, 4], `estágios incompletos em ${result.nome}`);
  assert.equal(result.finalStage, 4, `${result.nome} deve chegar ao estágio pronto`);
  assert.ok(result.transitions.every((t, i) => i === 0 || t.second > result.transitions[i - 1].second), `estágios devem ser monotônicos em ${result.nome}`);
}
const autos = growth.filter(s => s.auto).sort((a, b) => a.ciclo - b.ciclo);
const photos = growth.filter(s => !s.auto).sort((a, b) => a.ciclo - b.ciclo);
assert.ok(autos.every(s => s.ciclo < photos[0].ciclo), 'automáticas devem ter ciclos mais rápidos que as fotoperíodo');
assert.match(server, /pl\.estagio = pl\.prog >= 100 \? 4 : pl\.prog >= 75 \? 3 : pl\.prog >= 50 \? 2 : pl\.prog >= 25 \? 1 : 0/);
assert.match(client, /function estagioDe\(prog\)\{return prog>=100\?4:prog>=75\?3:prog>=50\?2:prog>=25\?1:0\}/);
console.log('EIGHT_GENETICS_CLIENT_SERVER_OK', JSON.stringify({ total:8, nivel10:4, nivel11:4, accepted:accepted.length, growth }));
