# Referências externas consultadas

## Vídeo sobre WebSockets e servidor authoritative

Título: Building a Multi-player Game with WebSockets

URL: https://www.youtube.com/watch?v=cXxEiWudIUY

O vídeo apresenta um jogo multiplayer no navegador usando WebSockets e o modelo server-authoritative, no qual o estado do jogo fica no servidor e o WebSocket transporta as mensagens entre servidor e clientes. Essa referência é relevante para revisar movimento, entidades compartilhadas e validação de ações do Quintal 3D.

## Referências encontradas para consulta

Título: Three.js Multiplayer Game Tutorial Ready Player Me

URL: https://www.youtube.com/watch?v=DUOrkfsLNow

O resultado da busca indica um tutorial de jogo multiplayer com Three.js, integração de avatar e sincronização de movimento.

Título: Create a 3D Multi-player Game using THREE.js and SOCKET.io - part 1

URL: https://www.youtube.com/watch?v=HDZ8r-WYLEU

O resultado da busca indica um tutorial de jogo 3D multiplayer com Three.js e Socket.IO.

Título: Client-Side Prediction and Server Reconciliation | Web Game Dev

URL: https://www.webgamedev.com/backend/prediction-reconciliation

A página descreve prediction no cliente e reconciliation com o servidor authoritative como técnicas para manter a resposta local e corrigir divergências sem permitir que o cliente seja a fonte final da verdade.

## Análise técnica do vídeo

A análise identificou as seguintes práticas aplicáveis: o servidor deve ser a única fonte da verdade; o cliente envia intenções ou inputs, não valores finais; cada conexão precisa de um identificador estável; as mensagens devem ter um campo de tipo/método; o handshake deve associar a conexão ao jogador e à partida; entidades devem ser indexadas por ID; mudanças devem ser agrupadas por tick quando isso reduzir tráfego; conflitos devem ser decididos sequencialmente no servidor; e o cliente deve tratar snapshots incompletos sem apagar entidades por um pacote temporariamente vazio.

Para o Quintal 3D, isso reforça a necessidade de separar `input` de `posição`, manter o lote e as entidades no servidor, enviar snapshots por AOI e fazer o cliente reconciliar a posição sem bloquear o controle local durante uma reconexão.

## Client prediction e server reconciliation

Título: Client-Side Prediction and Server Reconciliation — Gabriel Gambetta

URL: https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html

A referência explica que um cliente que apenas espera o servidor pode parecer travado por causa da latência. A solução é enviar inputs numerados, prever localmente o resultado para manter resposta imediata e, quando chegar o estado authoritative com o último input processado, reconciliar a posição e reaplicar somente os inputs ainda não reconhecidos. O servidor continua sendo a fonte da verdade; a previsão existe apenas para a sensação de resposta.

Aplicação ao Quintal 3D: o cliente atualiza a posição visual local, mas o protocolo existente envia apenas posição final e o servidor devolve correções sem número de sequência. Isso pode explicar congelamento aparente ou saltos quando há reconexão, colisão ou mensagens atrasadas. A revisão deve adicionar sequência de input ou, no mínimo, distinguir claramente `posição prevista`, `posição authoritative` e `correção`, sem deixar uma correção antiga bloquear o movimento atual.

## Controles de primeira pessoa

Título: PointerLockControls — three.js docs

URL: https://threejs.org/docs/#PointerLockControls

A documentação oficial descreve `PointerLockControls` como adequado para jogos 3D em primeira pessoa e mostra a separação entre ativar o lock, reagir aos eventos `lock`/`unlock` e controlar a interface. Isso reforça que olhar/câmera não deve bloquear o estado do movimento e que a UI precisa ser reativada quando o ponteiro é liberado.

## WebSocket no navegador

Título: WebSocket — MDN Web Docs

URL: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

A documentação confirma os eventos `open`, `message`, `error` e `close`, a propriedade `readyState` e `bufferedAmount`. Também alerta que a API WebSocket não aplica backpressure automaticamente; mensagens chegando mais rápido que o processamento podem acumular memória ou CPU e deixar o dispositivo sem resposta. Isso reforça a necessidade de limitar snapshots, respeitar `bufferedAmount`, descartar estado antigo substituível e nunca usar uma fila de posições que possa congelar o cliente.

## Vídeo sobre server authority e client prediction

Título: Server Authority & Client Prediction (Game Networking Basics Part 4) — Developers Hub

URL: https://www.youtube.com/watch?v=9BZ3ln-qPeA

A análise do vídeo reforça cinco práticas: o servidor deve calcular a posição e validar colisões; o cliente pode prever o movimento para eliminar a sensação de atraso; a posição authoritative deve corrigir a previsão de maneira suave; inputs precisam de sequência ou timestamp para que correções antigas não vençam inputs novos; e o servidor deve manter os checks anti-teleporte mesmo quando há previsão visual no cliente.

Aplicação ao Quintal 3D: a correção não deve apenas aumentar a tolerância de distância. O protocolo precisa carregar sequência de input e o cliente precisa evitar que uma mensagem antiga de `correcao` substitua o movimento atual. A validação server-side continua obrigatória para velocidade e paredes.

## Verificação da publicação

A URL `https://bruno2001ka-coder.github.io/-quintal-3d/` retornou GitHub Pages 404. Portanto, o repositório possui o HTML e o servidor no GitHub, mas não há um site GitHub Pages configurado nessa URL. Os prints do usuário provavelmente vêm de uma prévia/ambiente diferente, então a validação final deve incluir o arquivo HTML atualizado e o endpoint real do servidor, sem assumir que o Pages é a publicação do jogo.
