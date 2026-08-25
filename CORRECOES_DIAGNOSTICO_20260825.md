# Correções do diagnóstico de plantas, multiplayer e desempenho

## Resultado da rodada

Esta rodada consolidou o multiplayer online em uma única fonte de verdade: os **16 plots de cada lote mantidos pelo servidor**. O cliente não simula uma segunda cópia dos canteiros enquanto está conectado. Além disso, o fluxo de cada propriedade agora é separado: o cliente-NPC nasce na rua do lote do dono, entra pelo vão do portão, chega à bancada daquela casa e sai pelo mesmo caminho; secagem, cura e venda são validadas contra a carteira e o lote do jogador.

## O que foi corrigido

| Área | Correção aplicada | Efeito esperado |
|---|---|---|
| Plantas e crescimento | Atualizações de crescimento agrupadas por lote em `lotes_update`; o cliente aplica os pacotes por plot. | Menos mensagens, menos serialização e crescimento igual para os jogadores próximos. |
| Crescimento visual online | A escala da planta continua baseada somente no `prog` recebido do servidor. Foi acrescentada interpolação visual entre atualizações, animação de folhas, brotos, praga, gota de água e balanço. | A planta cresce de forma perceptível e suave sem criar uma simulação concorrente no navegador. |
| Lote próprio | Removida a representação especial nos seis canteiros legados. O lote próprio usa os 16 plots de `lotesOnline`, como os demais lotes. | Elimina duplicação visual e evita que os plots 6–15 desapareçam. |
| Ambientes locais | Sol, estufa, grow, fazenda e Casa Nova são ocultados durante o multiplayer. | Não há duas simulações concorrentes para a mesma propriedade. No modo offline eles continuam locais. |
| Clientes por propriedade | Cada cliente-NPC carrega `dono`, `loteIndex`, rota de entrada e rota de saída. O caminho usa o vão do portão e dois waypoints internos antes da bancada. | O cliente entra na casa correta, não corta diagonalmente o muro frontal e não fica concentrado em um balcão público. |
| Bancada e atendimento | A bancada de cada lote fica em `lote.x + 6.8, lote.z + 3.6`. O foco do cliente tem prioridade quando ele está sendo atendido, e o foco da estação é usado apenas quando não há cliente próximo. | Atendimento, secagem e cura ficam visualmente separados por casa. |
| Secagem e cura | `lote_estagio` valida a distância até a bancada do próprio lote e consulta o estoque privado do jogador. | O estágio não pode ser alterado na bancada de outro jogador ou em um ponto público. |
| Venda | `vender` exige estoque pronto, `onde:'balcao'` e `clienteId` pertencente ao mesmo dono. Depois da venda, o cliente recebe rota de saída. | Uma venda não pode consumir a carteira de outro jogador nem deixar o cliente preso na bancada. |
| Rega legada | O caminho por índice deixou de usar `paraTodos`; agora transmite apenas por `paraInteresse` no lote correto. | Evita vazamento global e duplicação de atualizações. |
| AOI do servidor | Lotes enviam plantas completas somente quando entram no alcance de interesse; bots, funcionários e clientes usam grade espacial. | Menos varreduras lineares e menos dados enviados para quem está longe. |
| Backpressure | Sockets com buffer acima do limite são pulados naquele snapshot; o próximo retrato substitui o anterior. | Evita que um cliente lento acumule memória e trave o loop. |
| Áudio | Buffer de ruído reutilizado, ganho mestre, limite de vozes simultâneas e controle Ativo/Mudo. | Evita criar áudio pesado em rajadas de tiros/efeitos e oferece um modo imediato para máquinas problemáticas. |
| Reconexão | A última posição authoritative é guardada por até 15 segundos e reaplicada no novo handshake; o cliente fica parado até receber a posição do lote. | Evita andar num mundo local durante a queda e depois voltar bruscamente ao nascimento. |
| Movimento durante handshake | O jogador pode andar enquanto o primeiro handshake termina; o envio ao servidor só começa depois da posição authoritative. Durante reconexão, o movimento permanece congelado. | Evita o bloqueio percebido no primeiro carregamento sem reabrir o retorno indevido após queda. |
| Parede após queda | A retomada valida a última posição com o raio do jogador; se ela estiver inválida, usa spawn oficial seguro. Ao reconectar, o cliente aplica a posição server-side e libera o andar somente depois do lote. | Evita ficar dentro ou encostado num colisor inválido após perder a conexão. |
| HUD mobile | Inventário e demais modais ficam acima do painel de métricas, ocupam uma área segura da tela e escondem AÇÃO/MIRA/TIRO/PULO/RECAR enquanto abertos. | Os controles não cobrem as linhas de sementes nem o botão FECHAR. |
| Gráficos | Seletor Alto/Médio/Baixo, pixel ratio limitado, sombras configuráveis, painel com FPS, chamadas e triângulos, além de LOD de plantas. | Permite preservar detalhe no modo Alto e reduzir custo quando necessário. |
| Avatar | Catálogo inicial Carmo/Verde/Azul/Roxo, seletor na tela, sincronização server-side, persistência compatível com carteiras antigas e atualização remota. | Os jogadores próximos veem o mesmo avatar; inventário, dinheiro e itens continuam privados. |
| Privacidade | Snapshots de clientes e funcionários deixaram de carregar chaves persistentes de proprietário; usam `loteIndex`. | Reduz exposição desnecessária de identificadores internos. |

## Estado compartilhado e privado

O mundo compartilhado inclui posição dos jogadores, plantas e lotes próximos, portões, bots, polícia, funcionários e clientes-NPC. Cada jogador continua com carteira, sementes, estoque, armas, munição, armadura, roupas/avatar escolhido e upgrades próprios. Um observador vê a aparência e a arma visível autorizadas, mas não recebe o inventário do outro jogador.

A regra prática ficou assim: **o servidor decide o estado; o cliente apenas mostra o estado recebido**. Em particular, a interpolação visual do progresso não aumenta `prog`, não muda estágio e não cria uma planta nova. Quando uma planta é colhida, o ID da entidade e o mesh também são limpos, inclusive se a casa estava fora do streaming.

## Testes executados

| Teste | Resultado |
|---|---|
| `node --check servidor-1.js` | passou |
| `node --check` dos testes e JSON do projeto | passou |
| checker do `index.html` + `node --check` do JavaScript inline | passou |
| `npm test` / integração de segurança | `SECURITY_INTEGRATION_OK` |
| `npm run test:aoi` / dois jogadores, avatar, plantio, crescimento server-side e isolamento | `MULTIPLAYER_AOI_OK` |
| `npm run test:carga` / 24 conexões | `LOAD_24_OK`, cerca de 2.172–2.184 snapshots, tick máximo observado de 3,1–3,68 ms e zero descartes por backpressure |
| `npm run test:reconexao` / queda curta | `RECONNECTION_POSITION_OK` |
| `npm run test:clientes` / portão, entrada por waypoints e chegada à bancada do lote | `CLIENTE_CASA_OK`, distância observada menor que 0,9 m |
| análise estática do layout mobile | seletores de modal, toque e cliente validados |
| `test-reconexao` perto de parede | `RECONNECTION_POSITION_OK` com movimento após retomada |

Os testes foram executados em servidores locais isolados, com banco SQLite temporário e segredo de teste. O teste de clientes usa `CLIENTE_FIRST_S=1`, `CLIENTE_MIN_S=1` e `CLIENTE_MAX_S=1` somente para reduzir o tempo de espera da validação. Nenhum segredo real foi incluído no relatório ou no repositório.

## Limitações conhecidas

A fazenda e a Casa Nova continuam sendo propriedades locais quando o jogador está offline; elas ficam ocultas no modo online para não fingirem ser compartilhadas. Os lotes multiplayer principais, porém, já têm 10 propriedades server-side com 16 plots cada, bancada, portão, clientes e fluxo privado por dono. Criar a fazenda e a Casa Nova como novas propriedades multiplayer exigiria ampliar o catálogo de lotes do servidor e a atribuição de propriedade.

Ainda não há gato nem modelos externos de personagens no código ou nos arquivos recebidos. Para integrar personagens reais, é necessário enviar os arquivos GLB/GLTF/FBX ou sprites/PNG, informar se existem animações, escala, orientação e licença. O catálogo atual é uma ponte determinística, não uma substituição dos assets do usuário.

## Próximo passo operacional

Após esta rodada, os arquivos atualizados devem ser sincronizados para o clone de publicação, a suíte completa deve ser executada novamente no clone e somente então o commit deve ser enviado para `main`. O HTML atualizado e o servidor atualizado serão entregues junto com o resultado final para teste direto.

**Autor:** Manus AI

## Correção adicional: plantio no próprio quintal

A mensagem `longe do território` não era gerada pelo plantio. Ela pertence exclusivamente à ação de capturar um território público. Durante o handshake, o cliente já estava conectado (`mpConnected=true`), mas ainda não tinha recebido `lote_atribuido` (`mpReady=false`). Nesse intervalo, o cenário antigo continuava jogável e a tecla `E` podia manter foco em uma ação pública de território.

O HTML agora não exibe foco de interação nem executa `doAction` enquanto o lote e a posição authoritative ainda estão sendo carregados. Depois de `lote_atribuido`, o jogador é reposicionado no próprio lote, os 16 canteiros online ficam disponíveis e o comando de plantio volta a enviar somente `plantar` para o plot do proprietário. O servidor já valida novamente o dono do lote, o índice do plot, a distância e a semente pertencente à carteira.

Essa proteção evita que a tela inicial no quintal antigo seja confundida com o quintal multiplayer e impede que plantar seja desviado para `capturar_territorio`.

O teste adicional `npm run test:plantio` foi executado em banco isolado e passou como `PLANTIO_PROPRIO_OK`, confirmando plantio no `loteIndex` atribuído, no plot 5, com criação de uma única entidade de planta e sem qualquer recusa relacionada a território.

## Correção adicional: dano dentro da casa e entidades multiplayer

O servidor não tinha uma regra explícita de zona segura antes de aplicar dano da polícia. A linha de visão e a colisão impediam parte dos tiros através da parede, mas não impediam dano quando o jogador ainda estava dentro da área do lote. Foi adicionada uma proteção authoritative para a propriedade: enquanto o jogador estiver dentro de um lote, `aplicarDanoJogador` não altera vida nem armadura e `tiroPM` não dispara contra ele. A polícia continua sendo atualizada na fronteira externa, sem entrar na casa.

Também foi corrigido o agendamento de clientes. Antes cada novo cliente escolhia um lote dono aleatoriamente, permitindo que uma casa ficasse sem atendimento enquanto outra acumulava compradores. Agora o servidor prioriza o lote dono que está sem cliente ativo. Policiais não expiram enquanto o nível de procurado do alvo continua ativo, evitando que desapareçam durante a perseguição.

O teste `npm run test:entidades` passou como `PROTECAO_ENTIDADES_OK`, confirmando que a polícia aparece no snapshot, não causa `levou_tiro` dentro da propriedade, permanece visível enquanto o procurado está ativo e que o cliente do lote continua presente em snapshots sucessivos.

### Suíte final desta rodada

A suíte completa pós-correção passou: `SECURITY_INTEGRATION_OK`, `MULTIPLAYER_AOI_OK`, `LOAD_24_OK` com 24 jogadores, tick máximo de 4,56 ms e zero descartes, `RECONNECTION_POSITION_OK`, `CLIENTE_CASA_OK`, `PLANTIO_PROPRIO_OK` e `PROTECAO_ENTIDADES_OK`. A checagem de sintaxe do servidor, testes Node e JavaScript inline também passou.

## Correção adicional: áudio estável

O mixer do cliente foi reforçado para limitar vozes simultâneas a 16, acompanhar as fontes ativas e liberar cada oscilador ou buffer também por timeout de segurança quando o navegador não dispara `ended`. Ao selecionar `Mudo`, as fontes ativas são interrompidas e o volume mestre é zerado, evitando sons presos e sobreposição depois de reativar.

O `AudioContext` agora é retomado após `pointerdown`, teclado e retorno da aba. Contextos fechados ou interrompidos são descartados com segurança e recriados no próximo efeito. O som mudo não cria nem retoma contexto desnecessariamente. A sintaxe do HTML e do script inline passou após essa alteração.
