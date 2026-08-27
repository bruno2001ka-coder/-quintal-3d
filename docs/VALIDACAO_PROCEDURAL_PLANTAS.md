# Validação da correção do renderer procedural

## Problema reproduzido

A partir do screenshot do usuário, foi montada uma fixture local descartável com Critical, LSD 25 Auto e Northern Lights no estágio authoritative 4. O WebSocket confirmou seis registros de planta, todos com `prog: 100` e `estagio: 4`; portanto, o problema não estava no crescimento nem no pacote de dados recebido pelo cliente.

Na reprodução visual em qualidade Baixo, o renderer antigo mostrava hastes estreitas, poucas folhas e flores pequenas. A causa estava no LOD procedural: apenas três folíolos por fan, dois nós, duas camadas de cálices, cálices de raio pequeno e sugar leaves desligadas no modo Baixo. Esse conjunto deixava a planta com aparência esquelética, exatamente como no screenshot.

## Correção aplicada

O LOD Baixo passou a manter quatro nós, cinco folíolos e três camadas com três cálices, ainda sem sombras e com apenas um spark. As folhas foram alargadas, os caules e ramos receberam espessura mínima maior, os cálices e pistilos ficaram mais visíveis e as sugar leaves deixaram de ser removidas no modo Baixo. A altura da planta e o limite compacto dos buds foram preservados.

A White Widow com cinco assets não foi substituída nem misturada com o renderer procedural. O servidor continua decidindo `prog` e `estagio`; a alteração só afeta a forma desenhada das genéticas que ainda usam o renderer procedural.

## Comparação local

| Estado | FPS observado | Chamadas | Triângulos | Aparência |
| --- | ---: | ---: | ---: | --- |
| Antes | 20 | 269 | 29.662 | Haste fina, folhas esparsas e buds pequenos |
| Depois | 20 | 290 | 29.640 | Folhas mais largas, caule mais legível e buds compactos visíveis |

O FPS permaneceu em aproximadamente 20. As chamadas aumentaram porque a qualidade Baixo agora desenha mais componentes mínimos, enquanto os triângulos permaneceram praticamente estáveis; isso foi intencional para trocar o visual esquelético por uma silhueta legível sem transformar a planta em um modelo pesado.

A captura final da fixture foi mantida fora do repositório em `/tmp/procedural-plants-after.png`. Ela mostra Critical verde e LSD 25 Auto roxa com mais volume de folhas e buds. O enquadramento ainda contém elementos do lote e dicas do jogo, porque a captura usa a cena real do cliente; não é uma ilustração isolada.
