const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('public/index.html', 'utf8');

assert.match(html, /function normalizarTecla\(e\)/,
  'o cliente deve aceitar eventos de teclado por code ou key');
assert.match(html, /addEventListener\('keyup',e=>\{keys\[normalizarTecla\(e\)\]=false\}\)/,
  'o keyup deve liberar a mesma tecla normalizada do keydown');
assert.match(html, /closeAll\(\);Object\.keys\(keys\)\.forEach\(k=>\{keys\[k\]=false\}\)/,
  'a entrada no mundo deve remover modal invisível e tecla presa');
assert.match(html, /const aguardandoPrimeiroLote=!offlineAtivo\(\)&&\(!mpConnected\|\|!mpReady\|\|!estadoDoServidor\)/,
  'somente o online sem estado authoritative deve aguardar antes de mover');

assert.match(html, /id="offlineBtn"[^>]*>TESTAR OFFLINE<\//,
  'o overlay deve oferecer o botão explícito do sandbox offline');
assert.match(html, /let modoOfflineDev=false;/,
  'o cliente deve ter uma flag separada para o sandbox');
assert.match(html, /const offlineAtivo=\(\)=>modoOfflineDev&&!mpConnected/,
  'offline só pode ser ativo sem conexão online');
assert.match(html, /function iniciarSandboxOffline\(\)/,
  'o sandbox precisa de uma entrada explícita');
assert.match(html, /function criarPlantasDemoOffline\(\)/,
  'o sandbox deve ter uma vitrine visual de plantas sem usar dados da conta');
assert.match(html, /criarPlantasDemoOffline\(\);\s*player\.position\.set/,
  'as plantas de demonstração devem ser criadas na entrada offline');
assert.match(html, /const demos=\[\{plot:casaNovaPlots\[0\],prog:28\},\{plot:casaNovaPlots\[1\],prog:58\},\{plot:casaNovaPlots\[2\],prog:100\}\]/,
  'a vitrine offline deve mostrar três fases diferentes na Casa Nova');
assert.match(html, /player\.position\.set\(CN\.x,0,CN\.z\+5\.2\)/,
  'o sandbox não deve nascer novamente na casa antiga');
assert.match(html, /fazPlots\.forEach\(p=>\{p\.locked=false;p\.group\.visible=true\}\)/,
  'a fazenda deve ficar visível no sandbox para testar seus canteiros');
assert.match(html, /modoOfflineDev=true;mpReconnecting=false/,
  'a entrada offline deve interromper a reconexão automática');
assert.match(html, /if\(modoOfflineDev\|\|!MP_URL\)return;/,
  'o cliente não pode abrir outro WebSocket depois de entrar no sandbox');
assert.match(html, /if\(!offlineAtivo\(\)&&\(!mpConnected\|\|!mpReady\|\|!estadoDoServidor\)\)/,
  'o online continua exigindo estado authoritative');
assert.match(html, /id="offlineBtn"[\s\S]*?iniciarSandboxOffline\(\)/,
  'o botão offline deve chamar apenas a entrada do sandbox');
assert.match(html, /function loadRaw\(\)\{[\s\S]*?return null;/,
  'o sandbox não pode restaurar carteira ou progresso local');
assert.match(html, /if\(!offlineAtivo\(\)&&\(!mpConnected\|\|!mpReady\|\|!estadoDoServidor\)\)\s*\{\s*toast\('sem conexão com o servidor'/,
  'ações fora do sandbox devem continuar bloqueadas sem servidor');
assert.match(html, /if\(offlineAtivo\(\)\)\{[\s\S]*?G\.cash-=c;bankAdd\(s,1\);[\s\S]*?return;\s*\}\s*\/\/ O preço/,
  'compra offline de semente deve ser local e terminar antes do pedido online');
assert.match(html, /if\(offlineAtivo\(\)\)\{[\s\S]*?G\.cash-=u\.custo;G\.up\[u\.k\]=true;[\s\S]*?return;\s*\}\s*if\(!pedirAoServidor\(\{t:'comprar',oq:'upg'/,
  'melhoria offline deve ser local e o caminho online deve continuar separado');
assert.match(html, /if\(offlineAtivo\(\)\)\{[\s\S]*?G\.cash-=preco;[\s\S]*?return;\s*\}\s*if\(!pedirAoServidor\(\{t:'comprar',oq:'arma'/,
  'compra offline de arma deve ser local e não enviar pedido');
assert.match(html, /if\(offlineAtivo\(\)\)\{[\s\S]*?G\.cash-=520;G\.armor=100;[\s\S]*?return;\s*\}\s*if\(!pedirAoServidor\(\{t:'comprar',oq:'colete'/,
  'colete offline deve ser local e não enviar pedido');
assert.match(html, /if\(offlineAtivo\(\)\)\{[\s\S]*?G\.func\[f\.k\]=\{def:f,g:h\.g,[\s\S]*?return;\s*\}\s*\/\/ O servidor decide/,
  'funcionário offline deve ser somente visual/local e terminar antes do caminho online');
assert.match(html, /if\(offlineAtivo\(\)\)\{[\s\S]*?G\.lotes\.push\(\{id:'offline-'[\s\S]*?\}\s*else pedirAoServidor\(\{t:'colher_local'/,
  'colheita offline deve criar lote de teste local, mantendo pedido online separado');
assert.match(html, /function tickFuncs\(dt\)\{[\s\S]*?if\(!offlineAtivo\(\)\)return;/,
  'funcionários não podem simular trabalho depois de sair do sandbox');
assert.match(html, /Object\.values\(G\.func\|\|\{\}\)\.forEach\(f=>\{if\(f&&f\.g\)scene\.remove\(f\.g\)\}\);/,
  'entrar novamente no sandbox deve remover funcionários visuais antigos');
assert.match(html, /if\(!offlineAtivo\(\)\)plots\.forEach\(p=>\{if\(p\.group\)p\.group\.visible=false\}\);\s*setModoMultiplayerVisual\(offlineAtivo\(\)\?false:true\);/,
  'o start só deve esconder os grupos legados no online e mostrar canteiros no sandbox');
assert.match(html, /\$\('alive'\)\.textContent=plots\.filter\(p=>p\.plant\)\.length/,
  'o HUD deve contar cada canteiro uma única vez');
assert.doesNotMatch(html, /plots\.concat\(fazPlots,casaNovaPlots\)/,
  'os arrays especializados não podem duplicar canteiros já registrados em plots');

console.log('OFFLINE_SANDBOX_STATIC_OK');
