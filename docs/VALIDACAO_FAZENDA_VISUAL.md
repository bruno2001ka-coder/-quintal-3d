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

## Verificação da implementação authoritative — 2026-08-27

A fixture local foi iniciada com SQLite descartável, `DATABASE_URL` vazio e conta de teste no nível 10 com o imóvel `fazenda`. A regressão WebSocket confirmou seis setores, 12 canteiros por jogador, bloqueio do sétimo jogador, entrada no galpão, seis mesas e as três etapas de processamento.

A inspeção do HTML no navegador confirmou que a cena carrega sem tela branca. O navegador isolado desta sessão não alcançou o WebSocket em `127.0.0.1`; o endereço proxied aceitou handshake WebSocket por um cliente Node, mas o navegador proxied permaneceu offline, indicando limitação do ambiente de pré-visualização e não uma falha reproduzida no fluxo da fixture. Por isso, a inspeção visual end-to-end do interior do galpão não é declarada como concluída nesta sessão. A verificação visual automatizada ficou limitada à presença dos elementos no HTML e aos testes authoritative do servidor.

## Regressão de saída e retorno — 2026-08-27

A reprodução no cliente proxied com uma conta descartável nível 10 confirmou que o servidor permaneceu online e sem correções de posição durante a caminhada. O jogador que se aproxima pelo eixo central pode encostar no poste esquerdo ou direito se tentar avançar fora do vão de 10 m; a posição `x≈-5.32,z≈173.5` foi observada junto à borda do poste. O movimento inverso funcionou, portanto não havia teleporte nem perda de conexão.

A regressão authoritative foi ampliada para acompanhar correções e percorreu entrada, porta do setor, saída e retorno pelos seis setores. Para evitar falso positivo, a rota atravessa primeiro o vão central e só depois se desloca lateralmente. O fluxo completo passou.

No cliente, a faixa válida da estrada entre cidade e fazenda foi ampliada para 16 m como área de recuperação, e os dois trechos laterais da porteira externa passaram a ter colisores permanentes alinhados com o servidor. O vão central continua sendo a única passagem autorizada para dentro e fora da fazenda. A alteração não libera atravessamento de cerca: apenas evita que uma chegada desalinhada fique presa na borda do caminho.
