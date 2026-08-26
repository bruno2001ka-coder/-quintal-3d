# Seleção final — sequência White Widow

A primeira sequência aprovada para o Quintal 3D é a linha **verde-clara/prateada com flores brancas**, coerente com a identidade visual escolhida para a White Widow. As linhas roxa, dourada, laranja, azul e neon permanecem fora deste pacote; elas devem formar sequências próprias para não trocar a identidade fenotípica da planta durante o crescimento.

| Estágio authoritative | Aparência comunicada | Asset final integrado |
| --- | --- | --- |
| 0 | Semente/cotilédones, quase no nível do substrato | `stage-0-semente.webp` |
| 1 | Broto pequeno com caule curto e primeiras folhas | `stage-1-broto.webp` |
| 2 | Vegetativa compacta, com mais folhas e silhueta claramente maior | `stage-2-vegetativa.webp` |
| 3 | Início de floração, com primeiros agrupamentos claros sem parecer uma planta já pronta | `stage-3-floracao.webp` |
| 4 | Planta pronta, mais alta e densa, com flores brancas/prateadas | `stage-4-pronta.webp` |

Os cinco arquivos ficam em `public/assets/plantas-estagios/white-widow/`, têm canvas transparente padronizado e são usados no cliente como texturas WebP compartilhadas. Os intermediários do Flow, PNGs de processamento e contact sheet foram removidos do `public` para evitar peso e ambiguidade no deploy.

A integração não altera genética, preço, economia, tempo de crescimento, estado de água, saúde, praga ou coleta. O servidor continua enviando `prog` e `estagio` authoritative; o cliente escolhe o mapa correspondente ao estágio e mantém um único `THREE.Sprite` por planta. White Widow usa esta sequência; as demais genéticas continuam no renderer procedural até que seus cinco assets sejam produzidos e aprovados.

> **Limitação técnica:** são sprites billboard voltados para a câmera. Eles são uma solução leve para comunicar a evolução visual e não modelos 3D completos; portanto, não projetam a mesma sombra volumétrica de uma malha tridimensional.

## Referências internas

[1] [Pesquisa visual e de desempenho](PESQUISA_VISUAL_PERFORMANCE.md)
[2] [Validação local da fixture White Widow](VALIDACAO_WHITE_WIDOW_FIXTURE.md)
[3] [Comparação de desempenho](VALIDACAO_WHITE_WIDOW_PERFORMANCE.md)
