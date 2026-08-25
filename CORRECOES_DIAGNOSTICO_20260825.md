# Correções do diagnóstico de plantas, multiplayer e desempenho

## Resultado da rodada

Esta rodada consolidou o multiplayer online em uma única fonte de verdade: os 16 plots de cada lote mantidos pelo servidor. O cliente não simula uma segunda cópia dos canteiros enquanto está conectado.

## O que foi corrigido

| Área | Correção aplicada | Efeito esperado |
|---|---|---|
| Plantas e crescimento | Atualizações de crescimento agrupadas por lote em `lotes_update`; o cliente aplica os pacotes por plot. | Menos mensagens, menos serialização e crescimento igual para os jogadores próximos. |
| Lote próprio | Removida a representação especial nos seis canteiros legados. O lote próprio usa os 16 plots de `lotesOnline`, como os demais lotes. | Elimina duplicação visual e evita que os plots 6–15 desapareçam. |
| Ambientes locais | Sol, estufa, grow, fazenda e Casa Nova são ocultados durante o multiplayer. | Não há duas simulações concorrentes para a mesma propriedade. No modo offline eles continuam locais. |
| AOI do servidor | Lotes enviam plantas completas somente quando entram no alcance de interesse; bots, funcionários e clientes usam grade espacial. | Menos varreduras lineares e menos dados enviados para quem está longe. |
| Backpressure | Sockets com buffer acima do limite são pulados naquele snapshot; o próximo retrato substitui o anterior. | Evita que um cliente lento acumule memória e trave o loop. |
| Áudio | Buffer de ruído reutilizado, ganho mestre, limite de vozes simultâneas e controle Ativo/Mudo. | Evita criar áudio pesado em rajadas de tiros/efeitos e oferece um modo imediato para máquinas problemáticas. |
| Reconexão | A última posição authoritative é guardada por até 15 segundos e reaplicada no novo handshake; o cliente fica parado até receber a posição do lote. | Evita andar num mundo local durante a queda e depois voltar bruscamente ao nascimento. |
| Movimento durante handshake | O jogador pode andar enquanto o primeiro handshake termina; o envio ao servidor só começa depois da posição authoritative. Durante reconexão, o movimento permanece congelado. | Evita o bloqueio percebido no primeiro carregamento sem reabrir o retorno indevido após queda. |
| HUD mobile | Inventário e demais modais ficam acima do painel de métricas, ocupam uma área segura da tela e escondem AÇÃO/MIRA/TIRO/PULO/RECAR enquanto abertos. | Os controles não cobrem as linhas de sementes nem o botão FECHAR. |
| Gráficos | Seletor Alto/Médio/Baixo, pixel ratio limitado, sombras configuráveis, painel com FPS, chamadas e triângulos, além de LOD de plantas. | Permite preservar detalhe no modo Alto e reduzir custo quando necessário. |
| Avatar | Catálogo inicial Carmo/Verde/Azul/Roxo, seletor na tela, sincronização server-side, persistência compatível com carteiras antigas e atualização remota. | Os jogadores próximos veem o mesmo avatar; inventário, dinheiro e itens continuam privados. |
| Privacidade | Snapshots de clientes e funcionários deixaram de carregar chaves persistentes de proprietário; usam `loteIndex`. | Reduz exposição desnecessária de identificadores internos. |

## Estado compartilhado e privado

O mundo compartilhado inclui posição dos jogadores, plantas e lotes próximos, portões, bots, polícia, funcionários e clientes-NPC. Cada jogador continua com carteira, sementes, estoque, armas, munição, armadura, roupas/avatar escolhido e upgrades próprios. Um observador vê a aparência e a arma visível autorizadas, mas não recebe o inventário do outro jogador.

## Testes executados

| Teste | Resultado |
|---|---|
| `node --check servidor-1.js` | passou |
| `node --check` dos testes e JSON do projeto | passou |
| checker do `index.html` + `node --check` do JavaScript inline | passou |
| `npm test` / integração de segurança | `SECURITY_INTEGRATION_OK` |
| `npm run test:aoi` / dois jogadores, avatar, plantio e isolamento | `MULTIPLAYER_AOI_OK` |
| `npm run test:carga` / 24 conexões | `LOAD_24_OK`, cerca de 2.172–2.184 snapshots, tick máximo observado de 3,1–3,68 ms e zero descartes por backpressure |
| `npm run test:reconexao` / queda curta | `RECONNECTION_POSITION_OK` |
| análise estática do layout mobile | seletores de modal, toque e cliente validados |

Os testes foram executados em servidores locais isolados, com banco SQLite temporário e segredo de teste. Nenhum segredo real foi incluído no relatório ou no repositório.

## Limitações conhecidas

A fazenda e a Casa Nova continuam sendo propriedades locais quando o jogador está offline; elas apenas ficam ocultas no modo online para não fingirem ser compartilhadas. A próxima etapa necessária é criar essas propriedades e seus plots no servidor, se o objetivo for que outros jogadores também as vejam.

Ainda não há gato nem modelos externos de personagens no código ou nos arquivos recebidos. Para integrar personagens reais, é necessário enviar os arquivos GLB/GLTF/FBX ou sprites/PNG, informar se existem animações, escala, orientação e licença. O catálogo atual é uma ponte determinística, não uma substituição dos assets do usuário.
