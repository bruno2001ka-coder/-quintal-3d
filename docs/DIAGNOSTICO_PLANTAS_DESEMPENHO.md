# Diagnóstico inicial — plantas, compartilhamento e desempenho

## Escopo confirmado

O jogo tem dois processos diferentes: um cliente Three.js dentro de `index.html` e um servidor Node.js autoritativo em `servidor-1.js`. O cliente mantém sistemas offline e online ao mesmo tempo, ativando um ou outro conforme `mpConnected`.

## Plantas e crescimento

| Área | Estado atual | Visível para outros jogadores? | Autoridade atual |
|---|---|---:|---|
| 6 canteiros de sol do quintal principal | Marcados com `online=true` | Sim, quando entram no snapshot/lote correto | Servidor |
| 4 canteiros de sol extras em `[-14,-2]`, `[-11.5,-2]`, `[-14,-4.2]`, `[-11.5,-4.2]` | Locais | Não | Cliente/localStorage |
| 4 canteiros da estufa | Locais | Não | Cliente/localStorage |
| 6 canteiros do grow room | Locais | Não | Cliente/localStorage |
| 12 canteiros da fazenda | Locais | Não | Cliente/localStorage |
| 6 canteiros da Casa Nova | Locais | Não | Cliente/localStorage |
| 16 plots dos lotes server-side | Dados no servidor; `PLOTS_POR_LOTE=16` | Sim, dentro do AOI | Servidor |

O servidor atualiza o crescimento de todos os plots persistidos a cada segundo. Quando há mudança de progresso ou água, usa `paraTodos({t:'lote_update', ...})`. Isso não torna a planta pública em termos de posse, mas envia o evento a todos os sockets, inclusive jogadores que não estão perto e que não têm relação com o lote. Esse fan-out é um dos pontos que podem deixar a rede e o processo pesados.

O cliente espelha os dados server-side em `aplicarPlotOnline`, mas mantém uma cópia visual do próprio lote nos canteiros locais e outra cópia potencial no lote montado. Ao mudar de estágio, remove e reconstrói a malha da planta. Esse desenho pode causar duplicação visual e picos de CPU/GPU se o mesmo lote for representado pelos dois caminhos.

## Possível interpretação de “gato”

Não foi encontrada uma entidade de gato no código atual. As buscas retornam apenas referências a `gatilho` da arma e comentários relacionados. Se “gato” significar um personagem/animal que o usuário possui fora deste repositório, ele ainda precisa ser enviado para podermos integrar o asset.

## Equipamentos e roupas

Armas, munição, armadura, propriedades, XP e territórios já possuem espelho server-side para o jogador autenticado. Armas e equipamentos dos outros jogadores são representados por um modelo simplificado no cliente, a partir do campo `arma` do snapshot. Roupas não são estado multiplayer: os avatares remotos recebem cores aleatórias quando `mpAddPlayer` cria o humanoide, portanto dois jogadores podem aparecer com roupas diferentes para observadores diferentes. Para que roupa, skin e personagem sejam compartilhados de modo consistente, o servidor precisa enviar um `avatarId`/`outfitId` validado e o cliente deve usar um catálogo determinístico.

## Principais fontes de peso no servidor

1. O snapshot de cada jogador varre todos os jogadores, bots, funcionários e clientes-NPC. Com muitos jogadores, isso cresce aproximadamente de forma quadrática.
2. `paraTodos` serializa e envia eventos globais sem filtro espacial, sem verificar `ws.bufferedAmount` e sem descartar snapshots obsoletos de clientes lentos.
3. O crescimento dispara `lote_update` potencialmente para cada planta a cada segundo; o progresso contínuo aumenta a frequência de mensagens.
4. A colisão usa listas lineares extensas; bots, funcionários e clientes também chamam movimentação com subpassos.
5. A persistência de lotes em PostgreSQL dispara uma consulta por lote, e carteiras podem ser gravadas em sequência durante os flushes.

## Principais fontes de peso no cliente

1. Renderer Three.js com antialias, sombras PCFSoftShadowMap de 1024², pixel ratio de até 1.5, ACES tone mapping e muitas malhas procedurais com sombras.
2. `buildPlant` cria várias folhas, cálices, pistilos, sugar leaves e partículas por planta, com materiais próprios; plantas maduras são particularmente caras.
3. `montarLote` cria casas, muros, estufas, grow room, árvores, objetos e materiais por lote. `desmontarLote` libera geometrias e materiais agressivamente, podendo provocar picos ao entrar e sair do raio de streaming.
4. O loop de render roda clima, iluminação, chuva, HUD, radar, movimento, IA offline, crescimento local e interpolação. Mesmo no modo online há verificações e sistemas locais coexistindo.
5. A lista `colliders` e várias listas de entidades são percorridas repetidamente em cada frame.
6. O modelo `humanoid` é composto por muitas meshes e materiais. Cada jogador, funcionário, cliente e bot remoto pode criar sua própria cópia.

## Correções que devem vir primeiro

A primeira correção funcional deve definir uma regra única: **plantas, crescimento, colheita e estoque de todos os ambientes compráveis precisam ser server-side e privados ao proprietário; somente a representação do lote deve ser compartilhada por AOI**. O modo offline deve continuar separado, mas não pode ser usado enquanto a sessão multiplayer estiver ativa.

A primeira otimização deve trocar o broadcast global de `lote_update` por entrega ao dono e aos jogadores dentro do AOI do lote. Em seguida, deve ser introduzido um grid espacial para snapshots, entidades e eventos. No cliente, convém reduzir sombras por dispositivo, reutilizar geometrias e materiais, limitar reconstruções de plantas a mudanças reais de estágio e enviar identidade de avatar/roupa como dados server-side determinísticos.

## Asset de personagens

O repositório não contém modelos ou imagens de personagens. Para integração real, será necessário receber arquivos `.glb/.gltf`, sprites ou imagens, de preferência com informação sobre animações disponíveis, escala, orientação, textura e licença de uso. Sem isso, só é possível melhorar os personagens procedurais existentes ou gerar uma substituição conceitual, não incorporar “os personagens que o usuário já tem”.
