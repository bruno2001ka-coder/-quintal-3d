const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');

function extrairLiteral(nome) {
  const re = new RegExp(`const\\s+${nome}\\s*=\\s*([^;]+);`);
  const m = html.match(re);
  assert.ok(m, `constante ${nome} não encontrada`);
  return Function(`"use strict"; return (${m[1]});`)();
}
const Q = extrairLiteral('Q');
const C = extrairLiteral('C');
const CITY = extrairLiteral('CITY');
const FAZ = extrairLiteral('FAZ');
const LOTES = extrairLiteral('LOTE_SPOTS');
const ruasMatch = html.match(/const\s+RUAS_Z\s*=\s*(\[[^;\n]+?\])/);
assert.ok(ruasMatch, 'RUAS_Z não encontrada');
const ruasZ = Function(`"use strict"; return (${ruasMatch[1]});`)();

const sobrepoe = (a0, a1, b0, b1) => a0 <= b1 && b0 <= a1;
const centroDentro = (x, z, a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1;

assert.ok(sobrepoe(Q.z1 - .4, C.z1 + .4, Q.z1 - .4, C.z1 + .4), 'fundos e corredor não se encontram');
assert.ok(sobrepoe(C.z1 - .4, C.z1 + 2.0, C.z1 + 1.2, CITY.z1 - 1), 'portão e cidade não se encontram');
assert.ok(sobrepoe(CITY.z1 - 1, FAZ.z0 + 1, CITY.z1, FAZ.z0), 'estrada não liga cidade e fazenda');
assert.ok(C.x0 < C.x1 && CITY.x0 < CITY.x1 && FAZ.x0 < FAZ.x1, 'eixos principais inválidos');

assert.equal(LOTES.length, 10, 'o mapa deve ter dez lotes multiplayer');
for (const [x, z] of LOTES) {
  assert.ok(centroDentro(x, z, CITY), `lote fora da cidade: ${x},${z}`);
  assert.ok(x - 10 > CITY.x0 && x + 10 < CITY.x1, `lote encosta no limite lateral: ${x},${z}`);
  assert.ok(!ruasZ.some(rz => Math.abs(z - rz) < 12), `lote invade rua: ${x},${z}`);
}

console.log('MAPA_CONEXOES_OK', JSON.stringify({
  fundos: Q, corredor: C, cidade: CITY, fazenda: FAZ,
  lotes: LOTES.length, ruas: ruasZ.length,
  caminho: 'fundos -> corredor -> cidade -> estrada -> fazenda'
}));
