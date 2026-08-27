# Validação visual dos funcionários

## Fixture

Foi usada uma fixture SQLite descartável na porta local 19118, sem Render e sem conta real. A fixture continha uma conta temporária, um funcionário zelador persistido, um lote aberto e uma planta com água baixa/praga para gerar trabalho authoritative.

## Reprodução

O cliente HTML entrou no mundo pelo login da fixture e recebeu saldo, lote, sementes e o estado do jogador. O servidor carregou o funcionário por `funcs` e transmitiu a entidade nos snapshots AOI com `id`, `cargo`, `nome`, `x`, `z`, `ry` e `estado`.

A inspeção do código mostrou duas lacunas reais no cliente: o rótulo remoto usava apenas o nome, acrescentando somente um marcador genérico para funcionários de outro lote; e não existia uma função de atualização de `mpFuncs` no loop principal. Assim, o servidor podia mover o funcionário, mas o cliente não interpolava sua posição nem animava caminhada/trabalho.

A correção adicionou o cargo legível ao rótulo (`Nego Du · Zelador`, `Val · Colhedora`, `Seu Bené · Caseiro`), criou `mpTickFuncs(dt)`, interpolou as posições recebidas e animou pernas durante `indo` e braços durante `trabalhando`. O estado continua vindo do snapshot authoritative; a animação é apenas a representação visual.

## Regressões

`node testes/test-regressao-client-ui.js` passou com `CLIENT_UI_REGRESSION_OK`. `npm run test:modulos` passou com contratação, persistência, visibilidade AOI, tarefa de colheita, cruzamento e venda. A bateria completa de CI anterior também passou antes desta alteração visual.
