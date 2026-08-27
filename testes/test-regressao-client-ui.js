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
assert.match(html, /function escalaPlantaCultivada\(prog,mesh\)/,
  'a escala da planta deve aceitar o modo de arte por estágio e permanecer compartilhada');
assert.match(html, /P\.mesh\.scale\.setScalar\(escalaPlantaCultivada\(progVis,P\.mesh\)\)/,
  'o visual online deve usar a escala compartilhada');
assert.match(html, /lote\.producaoMarkers/,
  'a bancada de cada lote deve ter marcadores próprios de produção');
assert.match(html, /if\(hit\)\{dist=Math\.max\(\.55,s-\.35\);break\}\}/,
  'a câmera não deve manter distância mínima que atravesse muros');
const objetivo = html.slice(html.indexOf('function objetivoAtual()'), html.indexOf('function atualizarRota'));
assert.ok(objetivo.indexOf("G.lotes.some(l=>l.stage==='sec'||l.stage==='cura')") < objetivo.indexOf('const vazio=lote.plots.find'),
  'a rota deve priorizar a bancada quando há produto secando ou curando');
assert.match(html, /id="menuBtn"[^>]*aria-controls="gameMenu"/,
  'o celular deve ter um botão de menu recolhível');
assert.match(html, /id="gameMenu"[^>]*aria-label="Menu do jogo"/,
  'o menu mobile deve ter uma área própria e identificável');
assert.match(html, /function inicializarMenuMobile\(\)/,
  'a montagem do menu deve ser centralizada em uma função única');
assert.match(html, /\['topBar','stats','daybox','zone','perfBox'\]/,
  'ações, estatísticas, zona e configurações devem ser movidas para o menu');
assert.match(html, /body\.touch #hud > #topBar\{display:none\}/,
  'a barra cheia de ações não pode permanecer sobre o jogo no celular');
assert.match(html, /body\.touch\.gameStarted #menuBtn\{display:block/,
  'o botão MENU não deve ficar visível e bloqueado sobre a tela inicial');
assert.match(html, /body\.menuOpen #touch\{display:none!important\}/,
  'abrir o menu deve liberar a tela de toque e impedir comandos acidentais');
assert.match(html, /perfBox\.style\.display=\(!isTouch&&!outroModal\)\|\|\(isTouch&&menuAberto\)\?'block':'none'/,
  'FPS e configurações devem ficar ocultos no celular até abrir o menu');
assert.match(html, /cashQuickValue/,
  'o celular deve manter apenas o saldo resumido fora do menu');
assert.match(html, /const temProducao=G\.lotes\.some\(/,
  'o painel de produção deve aparecer somente quando houver produção');
assert.match(html, /id="authUser"[^>]*autocomplete="username"/,
  'a tela inicial deve pedir um usuário individual');
assert.match(html, /id="authPass"[^>]*type="password"/,
  'a tela inicial deve pedir senha sem expô-la');
assert.match(html, /t:tipo,usuario,senha,nome/,
  'login e cadastro devem usar o mesmo WebSocket authoritative');
assert.match(html, /localStorage\.setItem\('quintal3d-account-token',mpToken\)/,
  'o token da conta deve sobreviver a recarregamento e troca de aba');
assert.match(html, /msg\.t==='login_required'/,
  'o cliente deve bloquear o jogo até a conta ser reconhecida');
assert.match(html, /lote\.curaPotes=\[\]/,
  'cada lote deve reservar seus próprios potes físicos de cura');
assert.match(html, /const emCura=itens\.filter\(l=>l\.stage==='cura'\|\|l\.stage==='pronto'\)/,
  'os potes da bancada devem representar cura e produto pronto');
assert.match(html, /new THREE\.CylinderGeometry\(\.16,\.18,\.32,12\)/,
  'a bancada individual deve criar a geometria 3D do pote');
assert.match(html, /slot\.g\.visible=true/,
  'a atualização do estoque deve tornar visível o pote da cura');
assert.match(html, /lote\.curaPotes=null/,
 'os potes devem ser liberados quando a casa é desmontada');
assert.match(html, /const cargosVisiveis=\{zelador:'Zelador',colhedor:'Colhedora',caseiro:'Caseiro'\}/,
 'o funcionário deve exibir cargo legível junto do nome');
assert.match(html, /const lbl=mpLabel\(\(F\.nome\|\|'Funcionário'\)\+' · '\+cargoNome\)/,
 'o rótulo do funcionário deve mostrar nome e cargo');
assert.match(html, /function mpTickFuncs\(dt\)/,
 'o cliente deve ter um loop dedicado para atualizar funcionários');
assert.match(html, /f\.estado=F\.estado\|\|f\.estado\|\|'parado'/,
 'o cliente deve guardar o estado de trabalho enviado pelo servidor');
assert.match(html, /if\(f\.estado==='trabalhando'\)/,
 'o estado authoritative trabalhando deve acionar animação visível');
assert.match(html, /mpTickFuncs\(dt\)/,
 'o loop principal deve atualizar funcionários a cada frame');
assert.match(html, /const vaoEstufa=1\.4,ladoEstufa=\(ew-vaoEstufa\)\/2/,
  'cada estufa deve reservar uma abertura de entrada');
assert.match(html, /addColLocal\(ex-ew\/2,ex-vaoEstufa\/2,ez\+ed\/2-\.1,ez\+ed\/2\+\.1\)/,
  'o colisor esquerdo da frente deve terminar antes da porta');
assert.match(html, /addColLocal\(ex\+vaoEstufa\/2,ex\+ew\/2,ez\+ed\/2-\.1,ez\+ed\/2\+\.1\)/,
  'o colisor direito da frente deve começar depois da porta');

const geneticAssetSlugs=[
 'northern-lights','white-widow','skunk-1','hindu-kush','amnesia-haze','sour-diesel','blue-dream','og-kush',
 'purple-haze','jack-herer','critical','gorilla-glue','lsd-25-auto','auto-69','critical-auto','northern-auto'
];
assert.match(html,/const GENETICA_ART=Object\.freeze\(/,
 'o catálogo deve mapear as artes das genéticas sem duplicar a fonte de nomes');
assert.match(html,/function artGenetica\(s,cls='geneticArt'\)/,
 'o HTML deve ter um renderer único para as artes das genéticas');
for(const slug of geneticAssetSlugs){
 const asset=path.join(__dirname,'..','public','assets','geneticas',`${slug}.jpg`);
 assert.ok(fs.existsSync(asset),`asset ausente: ${slug}.jpg`);
 assert.match(html,new RegExp(`/assets/geneticas/${slug}\\.jpg`),`asset não referenciado no HTML: ${slug}.jpg`);
}
const plantStageSlugs=['stage-0-semente','stage-1-broto','stage-2-vegetativa','stage-3-floracao','stage-4-pronta'];
assert.match(html,/const PLANT_STAGE_ART=Object\.freeze\(\[/,
 'o cliente deve declarar o pacote de artes dos cinco estágios');
assert.match(html,/function buildPlantArt\(s\)/,
 'a planta deve ter um construtor leve baseado em imagem por estágio');
assert.match(html,/return s&&String\(s\.nome\)==='White Widow'\?buildPlantArt\(s\):buildPlantProcedural\(s\)/,
 'somente a genética com pacote aprovado deve usar as artes novas');
for(const slug of plantStageSlugs){
 const asset=path.join(__dirname,'..','public','assets','plantas-estagios','white-widow',`${slug}.webp`);
 assert.ok(fs.existsSync(asset),`arte de estágio ausente: ${slug}.webp`);
 assert.match(html,new RegExp(`/assets/plantas-estagios/white-widow/${slug}\\.webp`),`arte de estágio não referenciada: ${slug}.webp`);
}
assert.match(html,/g\.userData=\{art:sp,stageSprite:sp,artMats:\[mat\]/,
 'cada White Widow deve manter um único sprite compartilhado');
assert.match(html,/const mapa=plantArtTextures\[e\]\|\|null/,
 'o estágio authoritative deve trocar somente o mapa do sprite');
assert.match(html,/sp\.visible=true/,
 'o sprite único deve permanecer visível após aplicar o estágio');
assert.doesNotMatch(html,/ud\.art\.forEach\(\(sp,i\)=>\{sp\.visible=i===e;\}\)/,
 'a planta não deve manter cinco sprites por instância');

console.log('CLIENT_UI_REGRESSION_OK');
