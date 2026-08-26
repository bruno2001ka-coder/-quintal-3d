# Auditoria tripla do Quintal 3D

Data: 25 de agosto de 2026

## Primeira revisão — mapa e ligações

O mapa possui uma ligação física básica entre os fundos do quintal (`Q`, z -13 a 0), o corredor (`C`, z 0 a 10,5), a cidade (`CITY`, z 11 a 150) e a fazenda (`FAZ`, z 172 a 268) por uma estrada no eixo x -6 a 6. Também existem dez lotes multiplayer em três colunas e quatro faixas principais, com a casa principal em cada lote e 16 plots server-side.

O problema não é apenas a existência de áreas: faltam guias de navegação e objetivos visuais que expliquem ao jogador como sair do quintal, localizar sua casa, ir à bancada, seguir para a cidade e chegar à fazenda. A cidade tem ruas e pontos de território, mas o HUD mostra principalmente `CIDADE` ou `longe do território`, sem um objetivo contextual. O mapa precisa ligar visualmente os pontos com placas, rotas, marcos e um objetivo atual, além de manter os mesmos corredores na colisão do cliente e do servidor.

As coordenadas de lotes e de estrada estão coerentes em princípio, mas a validação precisa ser testada por rota: spawn do lote → canteiros → estufa/grow room → bancada → portão → rua → cidade → estrada → fazenda. O cliente monta colisores dos lotes somente quando estão no streaming, enquanto o servidor mantém colisores de todas as propriedades. Essa diferença pode produzir bloqueio local ou correção server-side quando o jogador chega ao limite de um lote ainda não montado.

## Defeitos concretos encontrados

O servidor envia `loteIndex` nos resumos de cliente, mas `mpAddCliente` e o atualizador de snapshots do `index.html` não copiavam esse campo. Por isso a tela imprimia `cliente do lote NaN`. Esse defeito é visual, porém também fazia a interface parecer que o atendimento estava no lugar errado.

O movimento local é calculado a cada frame, mas o cliente envia somente a posição final aproximadamente dez vezes por segundo. O servidor valida distância e colisão sem receber número de sequência de input, e o cliente aplica uma correção atrasada parcialmente. Essa arquitetura mantém autoridade do servidor, mas pode parecer congelar ou puxar o jogador para trás em latência, reconexão ou divergência de colisores. A próxima revisão deve separar input, posição predicted e posição authoritative.

O foco usa `longe do território` como estado vazio geral, mesmo quando a ação atual é um lote ou uma entidade multiplayer. Isso confunde território de facção com propriedade do jogador. A mensagem deve ser contextual: `aguarde seu lote`, `você está no seu lote`, `siga para a bancada`, `cliente da casa X` ou `vá pela estrada da fazenda`.

## Critério para as revisões seguintes

Uma versão funcional deve permitir iniciar, receber o lote, andar sem congelar, abrir o portão, plantar em um dos 16 plots, observar crescimento vindo do servidor, usar a bancada do próprio lote, atender o cliente correto, sair pela rua, alcançar cidade e fazenda e voltar sem teleporte indevido. Cada etapa deve ter teste automatizado ou uma verificação observável no cliente.
