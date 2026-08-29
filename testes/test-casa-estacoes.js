const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '..', 'servidor-1.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.match(server, /const ESTACOES_CASA_REL = Object\.freeze\(\{[\s\S]*secagem: \{ x: 2\.6, z: 2\.15, raio: 1\.7 \},[\s\S]*cura: \{ x: 0, z: 2\.15, raio: 1\.7 \},[\s\S]*embalagem: \{ x: -2\.6, z: 2\.15, raio: 1\.7 \}/,
  'servidor deve ter três estações domésticas distintas');
assert.match(server, /function estacaoCasaValida\(j, nome\)/, 'servidor deve validar a estação por nome');
assert.match(server, /const esperado = lote\.estagio === 'sec' \? 'secagem' : lote\.estagio === 'cura' \? 'cura' : lote\.estagio === 'embalagem' \? 'embalagem'/,
  'servidor deve mapear estoque para estação correta');
assert.match(server, /if \(esperado === 'secagem'\) lote\.estagio = 'cura';[\s\S]*else if \(esperado === 'cura'\) lote\.estagio = 'embalagem';[\s\S]*else lote\.estagio = 'pronto';/,
  'servidor deve completar as três etapas na ordem');
assert.match(server, /bancadaPos: estacoes\.secagem, estacoes/, 'snapshot deve enviar as posições');
assert.match(client, /const estacoes=\{secagem:\{x:2\.6,z:2\.15\},cura:\{x:0,z:2\.15\},embalagem:\{x:-2\.6,z:2\.15\}\}/,
  'cliente deve montar as três estações nas mesmas coordenadas');
assert.match(client, /const etapa=focus\.station\|\|'secagem'/, 'cliente deve identificar a estação focada');
assert.match(client, /pedirAoServidor\(\{t:'lote_estagio',id:l\.id\}\)/, 'cliente deve pedir avanço ao servidor');
console.log('CASA_ESTACOES_OK', JSON.stringify({ estacoes:['secagem','cura','embalagem'], pipeline:['sec','cura','embalagem','pronto'] }));

