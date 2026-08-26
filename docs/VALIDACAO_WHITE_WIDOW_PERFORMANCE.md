# Comparação de desempenho da White Widow

A comparação foi feita no servidor local descartável, com a mesma página do Quintal 3D, o mesmo navegador e o mesmo cenário de lote da fixture. A medição anterior correspondia à implementação que criava cinco sprites por White Widow, mantendo quatro ocultos; a medição posterior corresponde à implementação que mantém um sprite e troca `material.map`.

| Implementação | FPS observado | Chamadas de render | Triângulos |
| --- | ---: | ---: | ---: |
| Cinco sprites por planta | 20 | 310 | 30.312 |
| Um sprite por planta | 20 | 138 | 27.560 |
| Variação observada | 0 FPS | -172 (-55,48%) | -2.752 (-9,08%) |

O FPS permaneceu em aproximadamente 20 nos screenshots, portanto não é correto prometer aumento de FPS apenas com esta mudança. As chamadas e os triângulos observados caíram porque o cenário foi medido com o pacote visual otimizado e a cena efetivamente montada pelo streaming. O ganho mais seguro e diretamente atribuível ao código é a redução de quatro sprites, quatro materiais e quatro objetos de cena ocultos por planta; a textura continua compartilhada e não é recriada a cada frame.

A configuração global de pixel ratio, sombras e qualidade não foi alterada nesta etapa. As outras genéticas continuam procedurais, então esta comparação não representa uma otimização global de todas as espécies.
