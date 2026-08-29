'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'servidor-1.js');
let s = fs.readFileSync(file, 'utf8');

const spawn = /function spawnNaPortaDoLote\(lote\) \{.*?\n\}/s;
const spawnNew = `function spawnNaPortaDoLote(lote) {
  // Mapa compacto 8x7: nasce na calçada, logo além do portão frontal.
  return { x: lote.x, y: 12, z: lote.z + LOTE_D / 2 + 1.25, ry: 0 };
}`;
if (!spawn.test(s)) throw new Error('spawnNaPortaDoLote não encontrado');
s = s.replace(spawn, spawnNew);

const coll = /const COL_LOTE_REL = \[.*?\n\];\nconst IDX_PORTAO = 5;/s;
const collNew = `const COL_LOTE_REL = [
  [-4.0, 4.0, -3.625, -3.375], // fundo
  [-4.0, -3.75, -3.5, 3.5],     // lateral esquerda
  [3.75, 4.0, -3.5, 3.5],       // lateral direita
  [-4.0, -1.6, 3.375, 3.625],   // frente esquerda
  [1.6, 4.0, 3.375, 3.625],     // frente direita
  [-1.6, 1.6, 3.375, 3.625]     // portão central
];
const IDX_PORTAO = 5;`;
if (!coll.test(s)) throw new Error('COL_LOTE_REL antigo não encontrado');
s = s.replace(coll, collNew);

const before = s.length;
s = s.replace(/modelo\.traverse\(o=>\{if\(o\.isMesh\)\{o\.castShadow=true;o\.receiveShadow=true;o\.frustumCulled=true\}\}\);/, "modelo.traverse(o=>{if(o.isMesh){o.visible=true;o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false}});");
if (s.length === before) console.log('Aviso: regra de culling já estava corrigida ou não existe nesta versão.');

fs.writeFileSync(file, s, 'utf8');
console.log('MAP_RECONCILIATION_APPLIED');
console.log('spawn=+1.25m');
console.log('lot_colliders=8x7_compact');
