# Validação visual da fazenda

## Estado atual

Foi criada uma camada procedural de acabamento para a fazenda, com caminhos internos, cerca baixa decorativa, detalhes dos canteiros, irrigação visual, treliças, lanternas, caixas, pedras, portal e um pátio visual com seis mesas.

## Prévia local

A cena foi aberta em uma prévia local descartável com os canteiros revelados e a câmera deslocada para a fazenda. O layout central apareceu, mas a primeira inspeção com luz de meio-dia mostrou superfícies muito claras em grandes áreas do terreno. Esse resultado ainda não está aprovado para publicação: é necessário identificar se o efeito vem de sobreposição/z-fighting dos pisos existentes ou de exposição/material antes de concluir.

## Regra de segurança

A camada nova usa apenas cenário procedural e não adiciona colliders. Não modifica estado authoritative, crescimento, colheita, estoque, processamento, economia, lote ou WebSocket.

## Segunda inspeção

Com a câmera próxima ao norte da fazenda, o pátio com seis mesas, a placa de processamento, as lanternas, a cerca e o portal apareceram na cena. O solo continuou com aparência clara/tan sob o sol de meio-dia mesmo após a primeira redução de cor; foi criada uma textura específica de solo agrícola mais escura para evitar depender da textura geral de terra.

Os canteiros ainda não ficaram claramente visíveis nos enquadramentos usados. A prévia descartável foi instrumentada para expor a contagem e a visibilidade dos objetos no console, a fim de separar um problema de enquadramento de uma ocultação real por alguma rotina de estado. Essa instrumentação não pertence ao código publicado.

## Diagnóstico de enquadramento

A instrumentação confirmou 12 canteiros, todos com `visible: true` e sete filhos visuais cada. A câmera estava em `x=14, y=3.98, z=201.2`; os canteiros das colunas mais afastadas foram projetados para coordenadas horizontais muito além do viewport, enquanto os mais próximos ficaram no limite ou atrás da composição. Portanto, a ausência nos screenshots não era uma falha de criação dos canteiros, mas um enquadramento estreito e baixo para uma fazenda de 46 m de largura.

## Visão panorâmica

Uma prévia com câmera a 25 m confirmou que a fazenda é extensa demais para avaliar detalhes nessa distância: a névoa exponencial do jogo reduz a leitura e deixa os objetos pequenos. A visão próxima é a mais adequada para validar canteiros, enquanto o mapa e os caminhos servem para a leitura global. A implementação não será alterada para forçar uma câmera panorâmica, pois isso poderia prejudicar a jogabilidade e o desempenho.

## Validação próxima concluída

Com a tentativa WebSocket desativada corretamente apenas na cópia de prévia, a inspeção confirmou que os canteiros estavam sendo ocultados pelo `setModoMultiplayerVisual(true)` da tentativa de conexão contra o servidor HTTP, não por erro de criação. Após a correção da fixture, os canteiros apareceram em distância de gameplay com bordas elevadas, solo interno, irrigação, postes de treliça e rótulos `CANTEIRO`. A mesma cena mostrou o pátio visual com seis mesas em enquadramento voltado para o galpão.
