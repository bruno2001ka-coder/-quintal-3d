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
assert.match(html, /id="wep"[^>]*aria-label="Equipar ou trocar arma"/,
  'o celular deve ter um controle explícito para equipar ou trocar arma');
assert.match(html, /function equiparArma\(indice\)/,
  'equipar arma deve passar por uma função única e validada');
assert.match(html, /bindHold\(\$\('wep'\),\(\)=>\{trocarArma\(\)\}\)/,
  'o botão touch de arma deve acionar a troca sem depender de teclado');
assert.match(html, /if\(e\.code==='KeyQ'\)trocarArma\(\)/,
  'o atalho de teclado deve compartilhar a mesma troca do celular');
assert.match(html, /d\.arma!==undefined/,
  'o cliente deve aceitar a arma equipada enviada pelo servidor');
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
assert.match(html, /fazendaVisualDetalhada/,
  'a fazenda deve possuir uma camada visual procedural identificável');
assert.match(html, /detalheCanteiro/,
  'os canteiros da fazenda devem receber detalhes visuais próprios');
assert.match(html, /patioProcessamentoVisual/,
  'a fazenda deve reservar visualmente um pátio de processamento');
assert.match(html, /placaLote\('6 MESAS'/,
  'o pátio deve mostrar visualmente as seis mesas de produção');
assert.match(html, /Não adicionamos colliders nesta camada/,
  'o passe visual não deve criar colisões que quebrem a navegação');
assert.match(html, /const FARM_MAX_PLAYERS=6,FARM_PLOTS_PER_PLAYER=12/,
  'o cliente deve espelhar o limite de seis jogadores e doze canteiros');
assert.match(html, /const farmSlotsOnline=FARM_SLOT_SPOTS\.map/,
  'os setores da fazenda devem ser estruturas online únicas');
assert.match(html, /portaoId:null,portaoAberto:false/,
  'cada setor deve iniciar com estado de porteira vindo do servidor');
assert.match(html, /function farmAtualizarPortao\(slot\)\{const aberto=!!slot\.portaoAberto/,
  'o colisor do setor deve seguir o estado authoritative da porteira');
assert.match(html, /const farmTablesOnline=FARM_TABLE_SPOTS\.map/,
  'as seis mesas devem ser representadas pelo estado do servidor');
assert.match(html, /farmSlotIndex:stationId/,
  'cada mesa deve estar associada ao bloco/lote de mesmo índice');
assert.match(html, /function farmMesasVisiveis\(\)\{return Number\.isInteger\(meuFarmSlotIndex\)\?farmTablesOnline\.filter/,
  'o cliente deve filtrar o menu para a mesa do lote comprado');
assert.match(html, /const mesasDoLote=farmMesasVisiveis\(\)/,
  'o menu de produção deve usar apenas as mesas do lote do jogador');
assert.match(html, /const farmTableVisuals=\[\]/,
  'cada mesa deve guardar referências de suas placas e indicadores visuais');
assert.match(html, /function atualizarFarmMesaVisual\(t\)/,
  'o visual da mesa deve refletir livre, fila ou operação authoritative');
assert.match(html, /ref\.placa\.material\.map=T\(placaLote\(texto,cor\)\)/,
  'a placa da mesa deve ser atualizada sem criar estado local de produção');
assert.match(html, /if\(focus\?\.t==='farmTable'\)abrirPainelFarmMesa\(focus\.mesa\)/,
  'aproximar-se de uma mesa deve abrir o painel do galpão');
assert.match(html, /focus\.t==='farmPlotOnline'/,
  'o foco deve diferenciar canteiro da fazenda dos lotes urbanos');
assert.match(html, /focus\.t==='farmTable'/,
  'o foco deve diferenciar mesa interna do galpão');
assert.match(html, /t:'farm_job',stationId:table\.stationId,operation:op,stockId:l\.id/,
  'a UI deve solicitar jobs com estação, operação e lote authoritative');
assert.match(html, /cada lote comprado tem uma mesa própria/i,
  'a UI deve explicar que cada lote recebe uma mesa própria');
assert.match(html, /const FARM_GATE_W=10/,
  'a abertura visual da porteira externa deve ter largura explícita');
assert.match(html, /const FARM_APPROACH_W=16/,
  'a estrada da fazenda deve ter uma faixa de recuperação navegável');
assert.match(html, /const FARM_LOT_PRICES=\[26000,28000,30000,32000,34000,36000\]/,
  'o cliente deve exibir preços individuais para os seis lotes');
assert.match(html, /const FARM_LOT_CATALOG=FARM_LOT_PRICES\.map/,
  'o cliente deve ter catálogo visual dos lotes da fazenda');
assert.match(html, /focus\.t==='farmLoteVenda'/,
  'a entrada de lote disponível deve oferecer compra individual');
assert.match(html, /pedirAoServidor\(\{t:'comprar_farm_lote',slotIndex:l\.slotIndex\}\)/,
  'a compra do lote deve ser enviada ao servidor sem desconto local');
assert.doesNotMatch(html, /nome:'Fazenda na saída da cidade'/,
  'o cliente não deve mostrar a Fazenda como imóvel global comprável');
assert.match(html, /if\(farmGateCol\)farmGateCol\.active=false/,
  'o portão externo da fazenda deve ser público para qualquer jogador');
assert.match(html, /focus\.t==='farmPortao'/,
  'o foco deve detectar as porteiras privadas dos setores');
assert.match(html, /pedirAoServidor\(\{t:'portao',id:slot\.portaoId\}\)/,
  'a abertura do setor deve ser solicitada ao servidor');
assert.match(html, /x0:-FARM_APPROACH_W,x1:FARM_APPROACH_W,z0:CITY\.z1-1,z1:FAZ\.z0\+1/,
  'o corredor de retorno deve permanecer conectado à porteira');
const farmGateDecl=html.indexOf('const FARM_GATE_W=10;');
const farmGateUse=html.indexOf('FARM_GATE_W/2');
assert.ok(farmGateDecl>=0&&farmGateUse>farmGateDecl,
  'FARM_GATE_W deve ser declarado antes da montagem visual da porteira');
assert.match(html, /slot\.gateCol=col\(x-1\.6,x\+1\.6/,
  'cada setor deve ter uma porteira física com colisor próprio');
assert.match(html, /FARM_GATE_W\/2,FAZ\.z0-\.3/,
  'o colisor da porteira externa deve acompanhar sua abertura visual');
assert.match(html, /col\(FAZ\.x0, -FARM_GATE_W\/2, FAZ\.z0-\.3/,
  'o lado esquerdo da porteira externa deve continuar bloqueando fora do vão');
assert.match(html, /Number\.isInteger\(msg\.farmSlotIndex\)/,
  'o cliente deve aplicar eventos de abertura dos setores sem confundir com portões urbanos');
assert.match(html, /msg\.t==='farm_lote_comprado'/,
  'o cliente deve aplicar a confirmação authoritative da compra do lote');
assert.match(html, /col\(FARM_GATE_W\/2, FAZ\.x1, FAZ\.z0-\.3/,
  'o lado direito da porteira externa deve continuar bloqueando fora do vão');
assert.match(html, /setModoMultiplayerVisual\(true\)/,
  'o modo online deve desativar o visual legado que poderia duplicar canteiros');

const geneticNames=['Blueberry Auto','Amnesia Haze Auto','Northern Lights','White Widow','Northern Light Auto','White Widow Auto','OG Kush','Sour Diesel'];
assert.match(html,/const GENETICA_ART=Object\.freeze\(/,
 'o catálogo deve mapear as artes das oito genéticas sem duplicar a fonte de nomes');
assert.match(html,/function artGenetica\(s,cls='geneticArt'\)/,
 'o HTML deve ter um renderer único para as artes das genéticas');
for(const nome of geneticNames)assert.ok(html.includes(`'${nome}'`),`genética ausente no catálogo visual: ${nome}`);
assert.ok((html.match(/metaSemente\(10,/g)||[]).length >= 4,'quatro genéticas devem liberar no nível 10');
assert.ok((html.match(/metaSemente\(11,/g)||[]).length >= 4,'quatro genéticas avançadas devem liberar após o nível 10');
assert.match(html,/const PLANT_STAGE_ART_BY_NAME=Object\.freeze\(/,
 'o cliente deve declarar pacotes de arte por genética');
assert.match(html,/const plantArtTexturesByName=Object\.freeze\(/,
 'o cliente deve carregar texturas de estágio por genética');
assert.match(html,/function buildPlantArt\(s\)/,
 'a planta deve ter um construtor leve baseado em imagem por estágio');
assert.match(html,/return PLANT_STAGE_ART_BY_NAME\[String\(s&&s\.nome\)\]\?buildPlantArt\(s\):buildPlantProcedural\(s\)/,
 'a seleção de arte deve depender da genética, sem usar a imagem de outra variedade');
const stagePackages={
 'blueberry-auto':'png','amnesia-haze-auto':'png','northern-lights':'png',
 'white-widow':'webp'
};
for(const [slug,ext] of Object.entries(stagePackages)){
 for(const stage of ['stage-0-semente','stage-1-broto','stage-2-vegetativa','stage-3-floracao','stage-4-pronta']){
  const dir=slug==='white-widow'?'plantas-estagios':'plantas-estagios-real';
  const asset=path.join(__dirname,'..','public','assets',dir,slug,`${stage}.${ext}`);
  assert.ok(fs.existsSync(asset),`arte de estágio ausente: ${slug}/${stage}.${ext}`);
  if(ext==='png'){
   const png=fs.readFileSync(asset);
   assert.equal(png.toString('ascii',1,4),'PNG',`arquivo não é PNG: ${asset}`);
   assert.equal(png[25],6,`PNG sem canal alpha RGBA: ${asset}`);
  }
  assert.match(html,new RegExp(`${dir}/${slug}/${stage}\\.${ext}`),`arte de estágio não referenciada: ${slug}/${stage}.${ext}`);
 }
}
assert.match(html,/g\.userData=\{art:sp,stageSprite:sp,artMats:\[mat\]/,
 'cada planta com arte deve manter um único sprite compartilhado');
assert.match(html,/const mapa=\(ud\.artTextures\|\|plantArtTextures\)\[e\]\|\|null/,
 'o estágio authoritative deve trocar somente o mapa do pacote da própria genética');
assert.match(html,/sp\.visible=true/,
 'o sprite único deve permanecer visível após aplicar o estágio');
assert.doesNotMatch(html,/ud\.art\.forEach\(\(sp,i\)=>\{sp\.visible=i===e;\}\)/,
 'a planta não deve manter cinco sprites por instância');

console.log('CLIENT_UI_REGRESSION_OK');
