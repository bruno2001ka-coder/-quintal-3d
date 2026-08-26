const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.match(
  html,
  /if\(!mpConnected&&x\.dono==='rival'&&rivais===0\)tomarPonto\(x\)/,
  'captura automática de território deve permanecer somente no modo offline legado'
);
assert.doesNotMatch(
  html,
  /if\(x\.dono==='rival'&&rivais===0\)tomarPonto\(x\)/,
  'o cliente não pode disparar captura/áudio de território em todos os frames online'
);
assert.match(
  html,
  /const possuida=G\.bank\.filter\(e=>e\.s&&e\.s\.nome===s\.nome\)/,
  'a banca deve calcular a quantidade da semente base já presente no inventário'
);
assert.match(
  html,
  /possuida\?`COMPRAR MAIS · \$\{possuida\}x`:'COMPRAR'/,
  'a banca deve diferenciar comprar de comprar mais'
);
assert.match(
  html,
  /no inventário: \$\{possuida\}x/,
  'a banca deve exibir a quantidade possuída junto da oferta base'
);

console.log('CLIENT_UI_REGRESSION_OK');
