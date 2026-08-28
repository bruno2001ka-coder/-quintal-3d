const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const oficiais = {
  'Blueberry Auto': 'assets/plantas-estagios-real/blueberry-auto',
  'Amnesia Haze Auto': 'assets/plantas-estagios-real/amnesia-haze-auto',
  'Northern Lights': 'assets/plantas-estagios-real/northern-lights',
  'White Widow': 'assets/plantas-estagios/white-widow',
  'Northern Light Auto': 'assets/plantas-estagios-real/northern-light-auto',
  'White Widow Auto': 'assets/plantas-estagios-real/white-widow-auto',
  'OG Kush': 'assets/plantas-estagios-real/og-kush',
  'Sour Diesel': 'assets/plantas-estagios-real/sour-diesel'
};
const stages = ['stage-0-semente', 'stage-1-broto', 'stage-2-vegetativa', 'stage-3-floracao', 'stage-4-pronta'];
for (const [nome, pasta] of Object.entries(oficiais)) {
  const encontrados = stages.map(stage => `${pasta}/${stage}.webp`);
  assert.ok(html.includes(`'${nome}':Object.freeze([`), `${nome} precisa ter matriz própria no catálogo`);
  for (const ref of encontrados) {
    assert.ok(html.includes(`'${ref}'`), `${nome}: referência ausente ${ref}`);
    assert.ok(fs.existsSync(path.join(root, 'public', ref)), `${nome}: arquivo ausente ${ref}`);
  }
  assert.equal(encontrados.length, 5);
}
assert.doesNotMatch(html, /Northern Light Auto'.*assets\/geneticas\/northern-auto\.jpg/,
  'Northern Light Auto não pode voltar a usar imagem única de catálogo');
assert.doesNotMatch(html, /White Widow Auto'.*assets\/geneticas\/white-widow\.jpg/,
  'White Widow Auto não pode reutilizar a arte da White Widow');
assert.doesNotMatch(html, /OG Kush'.*assets\/geneticas\/og-kush\.jpg/,
  'OG Kush não pode ficar apenas com imagem de catálogo');
assert.doesNotMatch(html, /Sour Diesel'.*assets\/geneticas\/sour-diesel\.jpg/,
  'Sour Diesel não pode ficar apenas com imagem de catálogo');
console.log('GENETIC_ASSETS_OK', JSON.stringify({ geneticas: 8, estagiosPorGenetica: 5, arquivosVerificados: 40 }));
