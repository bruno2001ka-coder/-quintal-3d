# Diagnóstico da evolução visual das plantas

Data: 2026-08-26

## Evidências

O servidor authoritative já calcula crescimento contínuo. A função `crescer()` em `servidor-1.js` atualiza `prog` a cada segundo, com estágios em 0/25/50/75/100%, e o loop envia `lotes_update` quando o progresso muda pelo menos 0,7 ponto ou quando o estágio muda. O teste `test-multiplayer-aoi.js` também cobre progresso maior após o plantio.

No cliente, `aplicarPlotOnline()` recebe os dados e usa `escalaPlantaCultivada(prog)` e `aplicarFormaPlanta()`. A reprodução local em `http://127.0.0.1:19001/` confirmou conexão online, lote próprio e interação no canteiro; portanto o problema não é ausência do servidor ou inexistência do plantio.

A representação visual atual cria sempre uma planta adulta-base com caule de 1,6 m e todos os ramos/buds já modelados. O crescimento apenas altera a escala global e oculta alguns leques por estágio. Isso causa uma evolução pouco legível: a planta nasce como um pequeno pedaço de uma planta adulta, cresce de forma linear e, na captura do usuário, os exemplares ficam com silhuetas muito altas/esparsas e buds pouco compactos. Além disso, os 16 canteiros online são montados todos com a mesma caixa de terra, embora o servidor diferencie sol, estufa e grow.

A correção deve ser visual e mínima: manter `prog`, `estagio`, água, saúde e genética vindos do servidor; ajustar a silhueta compacta por estágio, destacar o crescimento progressivo dos nós/buds e alinhar visualmente os ambientes sem criar uma segunda simulação local.

## Não alterar

Não alterar catálogo authoritative, preços, economia, regras de plantio/colheita, casa inicial/Jogador 1, banco ou protocolo de crescimento.

## Reprodução no navegador

A cópia local entrou no mundo e mostrou o próprio lote com canteiros online. O foco chegou a um canteiro e a interface exibiu `E plantar aqui (seu lote online)`. A tentativa de ação via teclado não foi suficiente para capturar uma planta na câmera, então a alteração será validada por testes WebSocket e por um cenário visual determinístico local antes do push.

A imagem fornecida pelo usuário confirma o defeito visual: exemplares com caule muito alto e pouca massa foliar, enquanto a evolução por progresso fica pouco perceptível. O ajuste será aplicado à geometria de crescimento do cliente, não à física do servidor.

## Validação após a primeira correção

A cópia local recompilada abriu e entrou no mundo normalmente após as mudanças. A suíte completa continuou verde: HTTP, segurança, P0/P1, AOI, login, carga, reconexão, plantio, clientes, movimento, estufas, UI, persistência, colheita e Render config.
