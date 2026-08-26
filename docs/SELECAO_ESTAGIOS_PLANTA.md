# Seleção visual dos estágios da planta

## Sequência escolhida

A sequência que mais combina entre as imagens enviadas é a linha **roxa/verde compacta**, porque mantém a mesma linguagem de folhas, cor, enquadramento e aparência de planta de jogo. A ordem escolhida é:

| Estágio | Arquivo enviado | Novo nome sugerido | Motivo |
|---|---|---|---|
| 0 — Semente/broto inicial | `/home/ubuntu/upload/Seedling_growing_short_green_stem_202608261843.webp` | `stage-0-semente.webp` | É o menor estágio, com caule curto e poucas folhas. O fundo quadriculado precisa ser removido ou substituído por transparência real. |
| 1 — Broto | `/home/ubuntu/upload/Purple_cannabis_seedling_isolate…_202608261904.jpeg` | `stage-1-broto.webp` | Tem poucos nós e folhas grandes, ainda claramente jovem. O fundo quadriculado é apenas visual de edição e precisa virar alpha transparente. |
| 2 — Vegetativa | `/home/ubuntu/upload/Purple_cannabis_plant_cutout_202608261904.jpeg` | `stage-2-vegetativa.webp` | É a planta mais cheia de folhas e ainda não mostra flores densas; funciona como crescimento vegetativo. O fundo branco precisa ser removido. |
| 3 — Início da floração | `/home/ubuntu/upload/Purple_cannabis_plant_flowering_202608261905.jpeg` | `stage-3-floracao.webp` | Mostra flores roxas em agrupamentos visíveis, mas ainda com estrutura de planta inteira. É a transição natural para a floração. |
| 4 — Pronta | `/home/ubuntu/upload/Purple_cannabis_plant_flowering_202608261904.jpeg` | `stage-4-pronta.webp` | Tem flores mais densas e aparência mais madura. O fundo quadriculado precisa virar transparência real. |

## Observações de compatibilidade

A imagem `Cannabis_plant_game_asset_2K_202608261906.jpeg` é bonita, mas não combina tão bem com a sequência roxa porque tem outra silhueta, outro tratamento de folhas e flores muito mais alongadas. As imagens douradas, verdes neon e de caule isolado também foram deixadas fora da sequência principal porque quebram a continuidade visual entre os estágios.

As imagens escolhidas não devem ser integradas diretamente enquanto ainda tiverem fundo branco ou quadriculado. O quadriculado não é transparência; ele precisa ser removido por recorte/alpha. O fundo branco também precisa ser removido sem apagar as partes claras das flores. Depois da limpeza, os cinco arquivos devem ser convertidos para PNG ou WebP transparente, redimensionados para no máximo 512×512 e comprimidos para manter o jogo leve.

## Uso no jogo

O cliente poderá escolher os cinco arquivos conforme o progresso authoritative recebido do servidor, sem alterar a genética, o preço, o tempo de crescimento ou a economia. A faixa recomendada é `0–24%` para o estágio 0, `25–49%` para o estágio 1, `50–74%` para o estágio 2, `75–99%` para o estágio 3 e `100%` para o estágio 4.

Antes da integração, confirmar visualmente os cinco PNGs/WebPs limpos e manter a mesma base inferior, escala e centro de enquadramento. A imagem madura de referência original não deve entrar como estágio intermediário.
