# Validação local da White Widow por estágios

## Escopo

Foi usada uma fixture descartável fora do Render, com SQLite em `/tmp`, contendo cinco entidades White Widow no lote do jogador: progresso 0, 25, 50, 75 e 100. A fixture não altera `servidor-1.js`, o banco de produção, a economia ou o banco SQLite original do repositório.

## Evidências

O cliente WebSocket recebeu `loteIndex: 1`, posição authoritative `{x: 2, y: 0, z: 35.8, ry: 0}` e cinco plantas com `nome: White Widow`, IDs server-side distintos e estágios 0, 1, 2, 3 e 4. Como o servidor continua crescendo plantas ativas, os progressos observados logo após a conexão foram aproximadamente 5.05, 30.05, 55.05, 80.05 e 100; isso confirma que os limiares authoritative continuam funcionando.

As cinco URLs finais foram solicitadas pelo navegador e retornaram os WebPs compartilhados: `stage-0-semente.webp`, `stage-1-broto.webp`, `stage-2-vegetativa.webp`, `stage-3-floracao.webp` e `stage-4-pronta.webp`. O contact sheet mostra uma silhueta realmente diferente em cada estágio: semente/cotilédones, broto pequeno, vegetativa compacta, início de floração e planta pronta.

A primeira integração usava cinco `THREE.Sprite` por planta, com quatro ocultos. Após a medição e revisão do código, a implementação foi reduzida para um único sprite por planta. O servidor continua sendo a fonte de `prog` e `estagio`; o cliente troca apenas `material.map` para a textura do estágio recebido.

## Limitação da captura em primeira pessoa

A captura dentro do mundo carregou a fixture e mostrou o lote próprio, mas a câmera ficou obstruída por uma árvore e pelo avatar em primeiro plano; por isso não é usada como prova visual dos detalhes dos cinco sprites. A prova visual da sequência é o contact sheet, e a prova funcional de integração é o snapshot WebSocket mais a solicitação das cinco texturas. Não foi feita nenhuma ação no Render durante essa validação.

## Estado

A White Widow é a única genética com pacote artístico integrado neste lote. As demais genéticas continuam no renderer procedural até receberem seus próprios cinco assets aprovados.
