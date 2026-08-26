# Pesquisa técnica: evolução visual e desempenho no Three.js

Data: 2026-08-26

## Fontes consultadas

1. [Three.js LOD — documentação oficial](https://threejs.org/docs/#LOD)
2. [Three.js WebGLRenderer.setPixelRatio — documentação oficial](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.setPixelRatio)

## Conclusões aplicadas ao Quintal 3D

A documentação oficial de `THREE.LOD` descreve a troca entre objetos de diferentes níveis de detalhe conforme a distância da câmera. Para este jogo, isso confirma que não basta reduzir uma escala global: os estágios da planta precisam usar silhuetas e quantidade de elementos realmente diferentes, enquanto objetos mais distantes devem usar uma representação mais simples.

A documentação do renderer confirma que `setPixelRatio()` afeta o tamanho físico do framebuffer. Como o custo de pixels cresce com a área renderizada, limitar o pixel ratio é uma correção de GPU diferente de reduzir a geometria. A configuração atual usava até 1,35 no modo Alto, enquanto a captura mostrava o jogo com aproximadamente 1.900 chamadas e mais de 29 mil triângulos; portanto a otimização precisa atuar nas duas frentes: geometria/draw calls e resolução/sombras.

## Diagnóstico comparado com o código

`buildPlant()` cria uma planta-base adulta inteira para cada canteiro, com caule, até 10 leques, ramos laterais e várias meshes individuais de cálices, pistilos e sugar leaves. `aplicarFormaPlanta()` apenas oculta parte dos leques e altera uma escala global. Isso explica por que a alteração anterior apenas deixou o mesmo modelo menor: a silhueta não era reconstruída por estágio.

A nova solução deve construir ou selecionar formas compactas por estágio, reduzir meshes auxiliares nos modos Médio/Baixo, manter a planta online orientada pelo `prog` e alternar LOD por distância apenas como otimização visual. O servidor continua sendo a única fonte de `prog`, `estagio`, água, saúde e genética.

A documentação oficial de `THREE.InstancedMesh` informa que ele é apropriado para muitos objetos com a mesma geometria e material, reduzindo draw calls. Isso é aplicável às folhas e cálices repetidos das plantas, mas não deve ser usado indiscriminadamente para cada genética/estágio se isso obrigar a reconstruir toda a cena. A solução escolhida deve compartilhar geometria/material onde há repetição e manter poucas meshes por planta.

O manual oficial de otimização mantém uma seção específica para muitos objetos e recomenda avaliar o custo de objetos repetidos, atualização e renderização, em vez de apenas diminuir o tamanho visual. Portanto, o jogo deve medir `renderer.info.render.calls`, triângulos e FPS depois da alteração.

Fontes adicionais consultadas:

3. [Three.js InstancedMesh — documentação oficial](https://threejs.org/docs/#InstancedMesh)
4. [Three.js Manual — Optimizing Lots of Objects](https://threejs.org/manual/#en/optimize-lots-of-objects)

## Pesquisa de arte de crescimento

A busca encontrou o trabalho acadêmico [Propagate: An individual-based modeling approach for plant growth in digital games](https://escholarship.org/uc/item/57x8098m), cujo resumo indica que o estágio de crescimento determina qual malha 3D é usada. A página exigiu verificação humana no navegador, então não tratei o conteúdo integral como confirmado; usei apenas a informação do resumo retornado pela busca.

A decisão segura para o Quintal 3D é, portanto, gerar artes separadas por estágio e integrá-las como referências visuais controladas pelo progresso authoritative, em vez de tentar fazer uma única planta adulta parecer diferente somente com escala.

## Evidência acadêmica acessível

O artigo [CropCraft: Inverse Procedural Modeling for 3D Reconstruction of Crop Plants](https://arxiv.org/html/2411.09693v1) descreve um modelo de planta composto por caule principal, nós, folhas e ramos, com parâmetros que mudam conforme maturidade, condições de cultivo e cultivar. O texto destaca que a forma agregada da copa é mais importante que reproduzir cada folha individualmente. Para o jogo, isso reforça um desenho com silhuetas claramente distintas por estágio e poucos elementos bem escolhidos, em vez de duplicar a mesma planta adulta inteira e apenas escalá-la.

A fonte é um estudo de reconstrução de culturas agrícolas, não uma regra específica de cannabis nem uma licença para copiar modelos; foi usada apenas como referência de estrutura visual e controle de complexidade.

## Imagens dentro do mundo HTML/WebGL

A [documentação oficial de `THREE.Sprite`](https://threejs.org/docs/#Sprite) define sprite como um plano que sempre encara a câmera e informa que sprites não projetam sombras. O [manual oficial de billboards](https://threejs.org/manual/#en/billboards) mostra o mesmo padrão para etiquetas e objetos sempre voltados para a câmera.

Isso permite usar imagens transparentes de estágio com custo baixo, mas não deve ser apresentado como um modelo 3D completo: de lado, a planta fica plana e não projeta sombra. Para a câmera atual do Quintal 3D, a proposta correta é usar imagens transparentes de estágio como camada visual leve, apoiadas por um pequeno volume procedural de base/caule para manter a leitura 3D; a troca da imagem é determinada pelo estágio authoritative. As imagens do catálogo continuam apenas no inventário.

## Referência botânica para a sequência visual

A ficha governamental canadense [The Biology of Cannabis sativa L.](https://inspection.canada.ca/en/plant-varieties/plants-novel-traits/applicants/directive-94-08/biology-documents/cannabis-sativa) descreve que, durante o crescimento vegetativo, a aparência é dominada por caule, ramos e folhas; a maior parte das flores surge depois da fase vegetativa, em agrupamentos densos. A fonte também diferencia flores agrupadas e folhas com folíolos, características úteis para a silhueta do jogo.

A referência do artigo de morfologia encontrada na busca ([Morphological Characterization of Cannabis sativa L.](https://pmc.ncbi.nlm.nih.gov/articles/PMC10610221/)) ficou protegida por verificação automática no navegador e não foi usada como evidência integral. O resumo da busca apenas sugere aumento progressivo da complexidade dos folíolos; não há cópia de imagens ou texto dessa página.

Consequência para as artes: a sequência terá um estágio inicial de solo/semente, um broto com dois folíolos simples, um estágio vegetativo com folhas maiores e sem bud, um início de floração com pequenos agrupamentos e um estágio pronto com agrupamentos densos e compactos. Não será apenas a mesma planta redimensionada.
