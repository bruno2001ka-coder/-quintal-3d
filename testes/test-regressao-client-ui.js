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
assert.match(html, /<span class="ttl">PRODUÇÃO DO LOTE<\/span>/,
  'o HUD deve identificar a produção do lote, não apenas o estoque pronto');
assert.match(html, /const ESTAGIO_UI=\{sec:\['SECANDO'/,
  'a UI deve ter rótulo explícito para secagem');
assert.match(html, /cura:\['CURANDO'/,
  'a UI deve ter rótulo explícito para cura');
assert.match(html, /function linhasProducao\(lotes,limite=6\)/,
  'HUD e inventário devem usar uma renderização única dos estágios de produção');
assert.match(html, /levados para a bancada do seu lote para secar/,
  'a confirmação de colheita deve explicar o destino da produção');
assert.match(html, /function escalaPlantaCultivada\(prog\)/,
  'a escala da planta deve ser compartilhada entre local e online');
assert.match(html, /P\.mesh\.scale\.setScalar\(escalaPlantaCultivada\(progVis\)\)/,
  'o visual online deve usar a escala compartilhada');
assert.match(html, /lote\.producaoMarkers/,
  'a bancada de cada lote deve ter marcadores próprios de produção');
assert.match(html, /if\(hit\)\{dist=Math\.max\(\.55,s-\.35\);break\}\}/,
  'a câmera não deve manter distância mínima que atravesse muros');
const objetivo = html.slice(html.indexOf('function objetivoAtual()'), html.indexOf('function atualizarRota'));
assert.ok(objetivo.indexOf("G.lotes.some(l=>l.stage==='sec'||l.stage==='cura')") < objetivo.indexOf('const vazio=lote.plots.find'),
  'a rota deve priorizar a bancada quando há produto secando ou curando');

console.log('CLIENT_UI_REGRESSION_OK');
