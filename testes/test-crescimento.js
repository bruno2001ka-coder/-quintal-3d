const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'servidor-1.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.match(server, /const PLANTA_DRENO_AGUA = 0\.0045/,
  'o servidor deve usar drenagem de água compatível com o tempo de jogo');
assert.match(server, /const PLANTA_AGUA_SECA = 0\.35/,
  'a planta deve manter crescimento residual sem rega imediata');
assert.match(server, /const PLANTA_CRESCIMENTO_MULT = 0\.15/,
  'o ciclo authoritative deve ser jogável');
assert.match(server, /pl\.agua = Math\.max\(0, pl\.agua - dt \* PLANTA_DRENO_AGUA/,
  'a drenagem authoritative deve usar a constante nova');
assert.match(server, /const aguaF = PLANTA_AGUA_SECA \+ Math\.min\(1 - PLANTA_AGUA_SECA/,
  'a água não pode zerar a taxa de crescimento');
assert.match(server, /const taxa = \(100 \/ ciclo\) \* PLANTA_CRESCIMENTO_MULT/,
  'a taxa authoritative deve aplicar o multiplicador de crescimento');

assert.match(client, /const PLANTA_DRENO_AGUA=\.0045,PLANTA_AGUA_SECA=\.35,PLANTA_CRESCIMENTO_MULT=\.15/,
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
assert.match(client, /sp\.visible=carregada/,
  'o sprite só deve aparecer quando a textura estiver realmente carregada');
assert.match(client, /artFallback:fallback/,
  'a planta com arte deve ter fallback visual procedural');
assert.match(client, /ud\.artFallback\.visible=!carregada/,
  'o fallback deve aparecer enquanto a textura estiver indisponível');
assert.doesNotMatch(client, /ud\.art\.forEach\(\(sp,i\)=>\{sp\.visible=i===e;\}\)/,
  'a planta não deve criar cinco sprites ocultos por instância');

const sementes = [
  { nome: 'Blueberry Auto', auto: true, ritmo: 82, resistencia: 78 },
  { nome: 'Amnesia Haze Auto', auto: true, ritmo: 84, resistencia: 66 },
  { nome: 'Northern Lights', auto: false, ritmo: 66, resistencia: 88 },
  { nome: 'White Widow', auto: false, ritmo: 58, resistencia: 74 },
  { nome: 'Northern Light Auto', auto: true, ritmo: 88, resistencia: 86 },
  { nome: 'White Widow Auto', auto: true, ritmo: 86, resistencia: 76 },
  { nome: 'OG Kush', auto: false, ritmo: 46, resistencia: 58 },
  { nome: 'Sour Diesel', auto: false, ritmo: 44, resistencia: 56 }
];
function simulaCiclo(semente, local, manterAgua = true, multiplicador = .15) {
  let prog = 0, agua = 1, saude = 1, relogio = 360;
  const estagios = [0, null, null, null, null];
  for (let segundo = 1; segundo <= 7200 && prog < 100; segundo++) {
    relogio = (relogio + 1440 / 600) % 1440;
    const h = (relogio / 60) % 24;
    const dayT = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
    const luzBase = local === 'indoor' ? 1.05 : ((h >= 6 && h < 18) ? .35 + dayT * .85 : 0);
    const luz = semente.auto ? Math.max(.82, luzBase) : luzBase;
    const sede = .55 + luz * .85;
    agua = manterAgua ? 1 : Math.max(0, agua - .0045 * (.6 + (100 - semente.resistencia) / 100 * .9) * sede);
    if (agua < .12) saude = Math.max(.12, saude - .05 * (1.4 - semente.resistencia / 100));
    else if (agua > .35) saude = Math.min(1, saude + .013);
    const aguaF = .35 + Math.min(.65, Math.max(0, agua) * 1.7);
    const ciclo = (semente.auto ? 86 : 150) - semente.ritmo * (semente.auto ? .45 : .95);
    const taxa = (100 / ciclo) * multiplicador * luz * aguaF * (.55 + saude * .45);
    prog = Math.min(100, prog + taxa);
    const estagio = prog >= 100 ? 4 : prog >= 75 ? 3 : prog >= 50 ? 2 : prog >= 25 ? 1 : 0;
    if (estagios[estagio] === null) estagios[estagio] = segundo;
  }
  return { estagios, total: estagios[4] };
}
function minutos(segundos) { return segundos / 60; }
function validarResultado(resultado, semente, local) {
  assert.ok(resultado.estagios.every(t => Number.isFinite(t)),
    `os cinco estágios devem existir em ${semente.nome} (${local})`);
  assert.ok(resultado.estagios.every((t, i) => i === 0 || t > resultado.estagios[i - 1]),
    `os estágios devem avançar em ordem em ${semente.nome} (${local})`);
  assert.ok(resultado.total > 0 && resultado.total <= 7200,
    `${semente.nome} deve chegar à colheita sem congelar (${local})`);
}
const indoor = sementes.map(s => ({ s, r: simulaCiclo(s, 'indoor'), local: 'indoor' }));
const sol = sementes.map(s => ({ s, r: simulaCiclo(s, 'sol'), local: 'sol' }));
for (const { s, r, local } of [...indoor, ...sol]) validarResultado(r, s, local);
for (const { s, r } of indoor) {
  const minutosTotais = minutos(r.total);
  const faixa = s.auto ? [4.5, 6.5] : [8, 13];
  assert.ok(minutosTotais >= faixa[0] && minutosTotais <= faixa[1],
    `${s.nome} indoor deve durar ${faixa[0]}–${faixa[1]} min em condições normais; obtido ${minutosTotais.toFixed(1)} min`);
}
for (const { s, r } of sol) {
  const minutosTotais = minutos(r.total);
  const faixa = s.auto ? [4.5, 7] : [18, 26];
  assert.ok(minutosTotais >= faixa[0] && minutosTotais <= faixa[1],
    `${s.nome} no sol deve durar ${faixa[0]}–${faixa[1]} min em condições normais; obtido ${minutosTotais.toFixed(1)} min`);
}
const autosIndoor = indoor.filter(({ s }) => s.auto).map(({ r }) => r.total);
const fotosIndoor = indoor.filter(({ s }) => !s.auto).map(({ r }) => r.total);
const autosSol = sol.filter(({ s }) => s.auto).map(({ r }) => r.total);
const fotosSol = sol.filter(({ s }) => !s.auto).map(({ r }) => r.total);
assert.ok(Math.max(...autosIndoor) < Math.min(...fotosIndoor),
  'as automáticas devem terminar antes das fotoperíodo no indoor');
assert.ok(Math.max(...autosSol) < Math.min(...fotosSol),
  'as automáticas devem terminar antes das fotoperíodo no sol');
const blueberry = sementes[0];
const tempoNovo = simulaCiclo(blueberry, 'indoor').total;
const tempoAntigo = simulaCiclo(blueberry, 'indoor', true, 1.35).total;
assert.ok(tempoAntigo < tempoNovo / 7,
  '0.15 deve deixar o ciclo claramente mais lento que o multiplicador antigo 1.35');

console.log('GROWTH_REGRESSION_OK');
