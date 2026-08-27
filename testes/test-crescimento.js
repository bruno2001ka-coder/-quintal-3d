const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'servidor-1.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.match(server, /const PLANTA_DRENO_AGUA = 0\.0045/,
  'o servidor deve usar drenagem de água compatível com o tempo de jogo');
assert.match(server, /const PLANTA_AGUA_SECA = 0\.35/,
  'a planta deve manter crescimento residual sem rega imediata');
assert.match(server, /const PLANTA_CRESCIMENTO_MULT = 1\.35/,
  'o ciclo authoritative deve ser jogável');
assert.match(server, /pl\.agua = Math\.max\(0, pl\.agua - dt \* PLANTA_DRENO_AGUA/,
  'a drenagem authoritative deve usar a constante nova');
assert.match(server, /const aguaF = PLANTA_AGUA_SECA \+ Math\.min\(1 - PLANTA_AGUA_SECA/,
  'a água não pode zerar a taxa de crescimento');
assert.match(server, /const taxa = \(100 \/ ciclo\) \* PLANTA_CRESCIMENTO_MULT/,
  'a taxa authoritative deve aplicar o multiplicador de crescimento');

assert.match(client, /const PLANTA_DRENO_AGUA=\.0045,PLANTA_AGUA_SECA=\.35,PLANTA_CRESCIMENTO_MULT=1\.35/,
  'o fallback local deve espelhar as constantes authoritative');
assert.equal((client.match(/const aguaF=PLANTA_AGUA_SECA\+Math\.min\(1-PLANTA_AGUA_SECA/g) || []).length, 2,
  'o catch-up e o loop local devem usar o mesmo piso de crescimento');
assert.equal((client.match(/PLANTA_CRESCIMENTO_MULT\*luz\*aguaF/g) || []).length, 2,
  'o catch-up e o loop local devem usar o mesmo multiplicador');
assert.doesNotMatch(client, /dt\*\.022\*\(\.6\+\(100-s\.t\.resistencia\)/,
  'o cliente não deve manter a drenagem que congelava a planta');
assert.match(client, /const cal=new THREE\.Mesh\(new THREE\.IcosahedronGeometry\(\.072\*c\.s/,
  'o cálice do bud deve permanecer compacto');
assert.match(client, /const sl=new THREE\.Mesh\(leafletGeo\(\.105\*c\.s,\.024\*c\.s\)/,
  'a sugar leaf deve permanecer compacta');
assert.match(client, /ud\.buds\.scale\.setScalar\(\.34\+/,
  'a escala dos buds deve ter limite compacto');
assert.match(client, /const H=1\.38/,
  'a planta adulta deve permanecer compacta no lote');
assert.match(client, /e===0\?2:e===1\?4:e===2\?8:ud\.fans\.length/,
  'os estágios devem revelar pares simétricos de folhas');
assert.match(client, /if\(est===4\)\{toast\(`\$\{s\.nome\} pronta pra colher`/,
  'a mensagem de colheita só pode aparecer no estágio pronto');
assert.doesNotMatch(client, /if\(est===3\)\{toast\(`\$\{s\.nome\} pronta pra colher`/,
  'o estágio adulto ainda não pode ser tratado como pronto');
assert.match(client, /function escalaPlantaCultivada\(prog,mesh\)\{return mesh&&mesh\.userData&&mesh\.userData\.art\?\.28\+clamp\(Number\(prog\)\|\|0,0,100\)\/100\*\.72:\.07\+clamp\(Number\(prog\)\|\|0,0,100\)\/100\*\.65\}/,
  'a escala deve crescer continuamente também nas artes WebP e manter o fallback procedural compacto');
assert.match(client, /const PLANT_STAGE_ART_BY_NAME=Object\.freeze\(/,
  'o cliente deve declarar pacotes de artes dos cinco estágios por genética');
assert.match(client, /let sid=1;/,
  'os IDs das genéticas no cliente devem começar em 1 e coincidir com o servidor');
assert.equal(client.includes("'/assets/"), false,
  'as artes devem usar caminho relativo para funcionar no GitHub Pages e no Render');
assert.equal(client.includes('plantas-estagios-real/blueberry-auto/stage-1-broto.webp'), true,
  'o pacote de arte da planta deve apontar para um asset existente');
assert.match(client, /const mapa=\(ud\.artTextures\|\|plantArtTextures\)\[e\]\|\|null/,
  'a planta deve trocar o mapa do pacote da própria genética conforme o estágio authoritative');
assert.match(client, /sp\.visible=true/,
  'o sprite único deve permanecer visível conforme o estágio');
assert.doesNotMatch(client, /ud\.art\.forEach\(\(sp,i\)=>\{sp\.visible=i===e;\}\)/,
  'a planta não deve criar cinco sprites ocultos por instância');

function simulaCiclo(segundos) {
  let prog = 0, agua = 1, saude = 1, relogio = 360;
  const ritmo = 66, resistencia = 88;
  for (let i = 0; i < segundos; i++) {
    const h = (relogio / 60) % 24;
    const dayT = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
    const luz = (h >= 6 && h < 18) ? (.35 + dayT * .85) : 0;
    const sede = .55 + luz * .85;
    agua = Math.max(0, agua - .0045 * (.6 + (100 - resistencia) / 100 * .9) * sede);
    const aguaF = .35 + Math.min(.65, Math.max(0, agua) * 1.7);
    const ciclo = 150 - ritmo * .95;
    prog = Math.min(100, prog + (100 / ciclo) * 1.35 * luz * aguaF * (.55 + saude * .45));
    relogio = (relogio + 1440 / 600) % 1440;
  }
  return prog;
}
const prog100 = simulaCiclo(100);
const prog70 = simulaCiclo(70);
assert.ok(prog100 >= 100, 'uma planta saudável deve chegar à colheita em até 100s no canteiro de sol');
assert.ok(prog70 >= 50, 'uma planta saudável deve chegar ao estágio jovem em até 70s no canteiro de sol');

console.log('GROWTH_REGRESSION_OK');
