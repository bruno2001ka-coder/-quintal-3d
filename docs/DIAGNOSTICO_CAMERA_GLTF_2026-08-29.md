# Diagnóstico técnico da câmera e do GLB

## Fontes consultadas

1. [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html): o carregamento retorna `scene` e um array separado de `animations`; o modelo precisa ser adicionado à cena e o `AnimationMixer` deve ser associado ao objeto carregado.
2. [Three.js Animation System](https://threejs.org/manual/en/animation-system.html): animações são atualizadas por `AnimationMixer.update(delta)` e os transformes do grafo de cena devem ser tratados em seus nós/pivôs corretos.
3. [Three.js Forum — third-person view com obstáculos](https://discourse.threejs.org/t/navigation-in-third-person-view-with-obstacles-and-occluders-looking-for-ideas/46540): o padrão prático é testar o segmento entre o avatar e a câmera e posicionar a câmera antes do obstáculo; não basta apenas ignorar obstáculos próximos, pois isso coloca a câmera atrás da parede. Sistemas robustos distinguem paredes de objetos pequenos e podem usar múltiplos raios.

## Evidência do arquivo TheBoss

O GLB é válido, tem rig Mixamo, uma skin, onze meshes e nove animações. A altura geométrica combinada observada no arquivo é aproximadamente 1,995 m, mas o nó `Armature` possui escala interna `0,01`. Portanto, medir a caixa antes de normalizar e depois aplicar uma escala externa pode produzir um resultado diferente do esperado se a origem/pivô não for reorganizada.

## Evidência no projeto

O personagem antigo usa um grupo `player` como pivô de física. A câmera aponta para esse grupo, enquanto a arma está em outro grupo de cena. O GLB foi inserido como filho do mesmo `player`, e os meshes antigos são ocultados depois do carregamento. A câmera usa um alvo derivado de `player.position` e um resolvedor de colisão baseado em AABB.

O ponto crítico identificado é a combinação entre: (a) o pivô de física do grupo `player`; (b) a origem transformada do rig Mixamo; (c) o alvo da câmera; e (d) a regra de colisão que reduz a distância. As alterações anteriores ajustaram apenas a distância mínima, sem verificar o pivô visual no espaço mundial nem usar um ponto de foco derivado do bounding box do modelo. Por isso a câmera pode continuar dentro da malha ou atrás de uma parede mesmo quando o tamanho do avatar parece correto.

## Direção segura para a correção

A correção deve criar um pivô visual explícito dentro de `player`, centralizar o GLB nesse pivô usando `Box3` após `updateMatrixWorld(true)`, calcular a altura e o ponto de foco do modelo em coordenadas locais, e fazer a câmera mirar nesse foco. O teste de obstrução deve partir do foco do avatar até a posição desejada da câmera e reduzir a câmera até antes do primeiro colisor, sem ignorar todos os obstáculos abaixo de uma distância arbitrária. A arma deve continuar independente do modelo para preservar o sistema authoritative atual.
