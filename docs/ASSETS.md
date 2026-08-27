# Direção visual da fazenda

## Referência de direção

A imagem `docs/assets/farm-visual-target.webp` define a direção visual da fazenda: uma pequena propriedade rural brasileira, organizada, quente e legível a partir da câmera em terceira pessoa. A composição usa uma avenida central de terra, canteiros elevados em filas, bordas de madeira, solo escuro, mangueiras de irrigação, cercas baixas, lanternas, árvores frutíferas, galpão de processamento e áreas de secagem/cura sob cobertura.

## Decisões para a implementação atual

A cena do jogo continuará usando geometria procedural leve, sem modelos 3D pesados. Os elementos novos serão reutilizáveis e instanciados em quantidade controlada: canteiro elevado, borda de madeira, sulcos, mangueira, placa de lote, poste/lanterna, caixa de produção, árvore e galpão/balcão. Plantas e estados de produção continuarão sendo renderizados a partir dos dados enviados pelo servidor; a arte não criará estado local nem alterará crescimento, colheita, estoque ou economia.

A referência é conceitual e não representa uma tela final nem uma promessa de modelo 3D completo. Ela orienta paleta, densidade, escala e hierarquia visual. O HTML atual não deverá receber textos gerados na imagem; placas e rótulos continuarão sendo criados no cliente para permanecerem legíveis e controláveis.

## Arquivo

- `docs/assets/farm-visual-target.webp` — referência 16:9 gerada para a direção de arte.
