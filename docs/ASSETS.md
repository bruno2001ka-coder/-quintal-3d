# Direção visual da fazenda

## Referência de direção

A imagem `docs/assets/farm-visual-target.webp` define a direção visual da fazenda: uma pequena propriedade rural brasileira, organizada, quente e legível a partir da câmera em terceira pessoa. A composição usa uma avenida central de terra, canteiros elevados em filas, bordas de madeira, solo escuro, mangueiras de irrigação, cercas baixas, lanternas, árvores frutíferas, galpão de processamento e áreas de secagem/cura sob cobertura.

## Decisões para a implementação atual

A cena do jogo continuará usando geometria procedural leve, sem modelos 3D pesados. Os elementos novos serão reutilizáveis e instanciados em quantidade controlada: canteiro elevado, borda de madeira, sulcos, mangueira, placa de lote, poste/lanterna, caixa de produção, árvore e galpão/balcão. Plantas e estados de produção continuarão sendo renderizados a partir dos dados enviados pelo servidor; a arte não criará estado local nem alterará crescimento, colheita, estoque ou economia.

A referência é conceitual e não representa uma tela final nem uma promessa de modelo 3D completo. Ela orienta paleta, densidade, escala e hierarquia visual. O HTML atual não deverá receber textos gerados na imagem; placas e rótulos continuarão sendo criados no cliente para permanecerem legíveis e controláveis.

## Arquivos

- `docs/assets/farm-visual-target.webp` — referência 16:9 gerada para a direção de arte.
- `docs/assets/plant-style-reference.png` — referência quadrada de escala, iluminação e aparência das plantas; fica fora de `public` e não é baixada pelo jogador.
- `public/assets/plantas-estagios-real/` — quinze texturas WebP 512×512, divididas em cinco estágios para Blueberry Auto, Amnesia Haze Auto e Northern Lights.
- `public/assets/plantas-estagios/white-widow/` — cinco texturas WebP legadas da White Widow.
- `public/assets/geneticas/` — somente as quatro imagens de catálogo ainda usadas no cliente: Northern Light Auto, OG Kush, Sour Diesel e White Widow.

Os PNGs de 1920×1920 e as imagens JPEG do catálogo antigo foram removidos do caminho publicado depois de validar que não havia referências no cliente nem nos testes. A troca preserva o quadrado e o canal alpha, mas reduz o peso das texturas reais de aproximadamente 56 MB para aproximadamente 860 KB.
