# Vulnerabilidades críticas no `servidor-1.js`

**Escopo:** análise estática do arquivo fornecido. As correções abaixo são recomendações técnicas; o servidor não foi alterado nesta etapa.

> **Resumo:** a base de validação é boa, mas algumas rotas ainda confiam em dados enviados pelo cliente ou aceitam ações sem confirmar identidade, posição, propriedade, cadência e origem do recurso. Os riscos mais graves estão em identidade/posse, geração de estoque, venda, combate e autoridade da vida do jogador.

## Classificação rápida

| Prioridade | Vulnerabilidade | Impacto |
|---|---|---|
| P0 | Identidade persistente enviada pelo cliente | Pode permitir assumir carteira/lote se a chave for descoberta ou forjada |
| P0 | Entidades protegidas aceitas sem dono em determinados momentos | Portões podem ser alterados sem autorização antes do `hello` ou enquanto não têm dono |
| P0 | `colher_local` aceita planta/genética do cliente sem existência server-side | Geração artificial de estoque e dinheiro |
| P0 | Venda aceita demanda/localização declaradas pelo cliente | Multiplicação do valor e venda fora da estação |
| P0 | `tiro_bot` não valida munição, arma, cadência ou origem do tiro | Dano ilimitado, abate instantâneo e farming de bots |
| P0 | Imóveis, territórios, XP, armadura, morte e parte da economia não existem no servidor | Cliente modificado pode criar progressão e consequências econômicas falsas |
| P1 | Primeira posição é aceita sem validar spawn, colisão ou propriedade | Teleporte inicial e entrada em áreas indevidas |
| P1 | Movimento posterior valida posição enviada, não intenção de movimento | Speed-hack dentro do limite e manipulação de `y` |
| P1 | Funcionários só têm existência server-side | Funcionários desaparecem após reinício e não possuem trabalho/diária autoritativos |
| P1 | Persistência e inicialização têm janelas de inconsistência | Perda de progresso, atribuição errada de lote e IDs não duráveis |
| P1 | Rotas legadas por índice coexistem com rotas por ID | Superfície duplicada e regras diferentes de autorização |

## 1. Identidade e posse dependem de uma chave enviada pelo cliente — P0

### Evidência

No `hello`, o servidor faz `j.chave = str(m.persistId, 40) || id` e usa essa chave para `atribuirLote()` e `carteiraDe()` (`servidor-1.js:973-1003`). O cliente envia `persistId` a partir do navegador (`quintal-cidade.html:4337-4338`). A chave é armazenada no ambiente do cliente e não é uma autenticação criptográfica.

### Exploração possível

Se um atacante obtiver ou adivinhar a chave persistente de outro jogador, poderá conectar-se usando a mesma identidade lógica e acessar a carteira/lote associado. Mesmo sem descobrir outra chave, o modelo não prova que o socket pertence ao proprietário: qualquer cliente pode declarar qualquer `persistId`.

### Correção

A identidade deve ser criada por um sistema de conta autenticada ou por um token assinado pelo servidor. O fluxo recomendado é:

1. O cliente autentica-se por uma conta.
2. O servidor emite um token assinado contendo `userId` e expiração.
3. O cliente envia o token no handshake.
4. O servidor verifica assinatura, expiração e revogação.
5. `userId` do token, e não `persistId` do JSON, torna-se a chave da carteira e da propriedade.

Também é necessário impedir múltiplos `hello` no mesmo socket. Depois do primeiro handshake válido, um novo `hello` deve ser recusado ou exigir encerramento e nova conexão. Para uma versão provisória sem contas, a chave persistente pode continuar identificando a sessão, mas deve ser tratada apenas como identificador não confiável, sem permitir acesso a progresso valioso.

## 2. Portões e entidades sem dono podem ser manipulados — P0

### Evidência

Os lotes e portões são registrados antes de qualquer jogador e começam com `dono: null` (`servidor-1.js:404-409`). A função `entidadeDoJogador()` só recusa quando `ent.dono` existe e é diferente do jogador (`servidor-1.js:413-428`). Logo, uma entidade protegida sem dono passa pela validação. O caso `portao` não exige que o jogador tenha concluído `hello` nem que o portão pertença a um lote atribuído (`servidor-1.js:1309-1321`).

### Exploração possível

Um cliente pode enviar uma ação de portão antes do handshake ou tentar operar um portão cuja entidade ainda está sem proprietário. Além disso, a operação não verifica distância física ao portão.

### Correção

Separar entidades públicas de entidades protegidas. Para qualquer portão, lote, planta, funcionário ou estoque que exija posse, a validação deve exigir simultaneamente:

- handshake autenticado concluído;
- `ent.dono` não nulo;
- `ent.dono === userId`;
- entidade ainda existente;
- jogador dentro do raio de interação;
- lote/área correspondente ao jogador.

A regra não deve ser `if (ent.dono && ent.dono !== chave)`. Deve ser conceitualmente `if (!ent.dono || ent.dono !== userId)`, quando a entidade for privada. Para portões, o servidor deve calcular distância até a posição oficial do portão e rejeitar qualquer acionamento remoto.

## 3. `colher_local` permite fabricar estoque — P0

### Evidência

O caso `colher_local` recebe `strain` e `saude` do cliente (`servidor-1.js:1159-1213`). O servidor limita formato, quantidade, intervalo e número aproximado de canteiros, mas não verifica que a planta exista, pertença ao jogador, esteja pronta, esteja em uma propriedade válida ou tenha sido cultivada naquele lote.

### Exploração possível

O atacante pode enviar uma genética válida inventada, declarar saúde alta e, respeitando os intervalos, criar estoque server-side sem plantar nem esperar crescimento real. Esse estoque pode avançar para cura e ser vendido por dinheiro real dentro do jogo.

### Correção

Remover gradualmente `colher_local`. Todos os canteiros devem existir no servidor com um registro semelhante a:

```text
plantId, propertyId, ownerId, plotId, environment,
seedId/strain, plantedAt, progress, health, water,
stage, pests, yield, harvestedAt
```

A colheita deve receber apenas `plantId` ou `plotId`. O servidor deve localizar a planta, verificar proprietário, estágio, tempo, posição/área, capacidade do estoque e então calcular quantidade e qualidade exclusivamente com dados server-side. O cliente não deve enviar `strain`, `saude`, quantidade nem qualidade como resultado final.

## 4. Venda com preço e local escolhidos pelo cliente — P0

### Evidência

O caso `vender` valida que o lote existe na carteira e está pronto, mas usa `m.onde` para escolher a fórmula e aceita `m.demanda` entre `0.5` e `2.5` (`servidor-1.js:1244-1267`). Não há validação de posição do jogador, estação, comprador ou demanda real.

### Exploração possível

O cliente pode vender sem estar no balcão e declarar a demanda máxima. Também pode declarar `onde: 'ponto'` para selecionar outra fórmula de preço. A posse do estoque está protegida, mas o contexto econômico da transação não está.

### Correção

A mensagem deve conter uma referência a uma estação server-side, por exemplo `stationId`, e não um texto livre como `onde`. O servidor precisa:

1. localizar a estação pelo ID;
2. confirmar que ela pertence à propriedade ou é uma estação pública válida;
3. verificar distância do jogador;
4. confirmar porta/acesso, quando aplicável;
5. localizar o comprador-NPC server-side;
6. calcular demanda, preço e quantidade com dados do servidor;
7. executar remoção do estoque e crédito em uma operação atômica;
8. emitir um `transactionId` para impedir repetição.

A demanda deve ser estado da estação/comprador, nunca um multiplicador fornecido pelo cliente. A mensagem do cliente deve declarar somente a intenção: `vender {stockId, stationId, quantity}`.

## 5. Tiro contra bots sem munição, cadência ou origem server-side — P0

### Evidência

Em `tiro_bot`, o servidor localiza o bot, verifica HP, distância e linha de visão, mas aceita dano enviado pelo cliente, limitado apenas a `1..60` (`servidor-1.js:1335-1359`). Não há validação de arma comprada, munição, intervalo mínimo entre tiros, direção real, sequência de disparo ou consumo de munição.

### Exploração possível

Um cliente modificado pode enviar mensagens de tiro continuamente, sempre com dano máximo, sem possuir arma ou munição. Pode matar bots rapidamente e acionar os eventos de morte repetidas vezes conforme o fluxo de respawn.

### Correção

O servidor deve manter, por jogador:

```text
weaponOwned, selectedWeapon, magazine, reserveAmmo,
lastShotAt, fireSequence, reloadState
```

A mensagem deve conter apenas intenção e, idealmente, direção/origem aproximadas. O servidor deve decidir arma, dano, cadência, munição, alcance, dispersão e linha de visão. A operação deve rejeitar tiro quando a arma não está equipada, a munição acabou, a cadência não permite novo disparo ou a geometria não corresponde. O dano nunca deve ser recebido como autoridade; no máximo, o cliente envia `shotId` e direção.

Também é necessário impedir que a recompensa de morte seja decidida localmente no cliente. O servidor deve registrar `killerId`, loot e recompensa, mesmo que o sistema de loot ainda não esteja implementado.

## 6. Vida, armadura, morte, respawn e economia de combate são locais — P0

### Evidência

A polícia server-side envia `levou_tiro`, mas o cliente aplica `dano()` localmente (`servidor-1.js:784-794`; `quintal-cidade.html:4465-4468`). No cliente, `dano()`, `morrer()` e o ganho de dinheiro por rival abatido alteram `G.hp`, `G.armor` e `G.cash` (`quintal-cidade.html:2556-2592`). O servidor não mantém HP, armadura, morte ou respawn do jogador.

### Exploração possível

O cliente pode ignorar tiros policiais, impedir a própria morte, evitar a perda de dinheiro ou alterar armadura e munição. O estado visual de cada navegador pode divergir.

### Correção

Mover para o servidor `hp`, `maxHp`, `armor`, `wanted`, `dead`, `respawnAt`, perdas e recompensas. O servidor deve processar dano, morte e respawn em uma transição de estado única. O cliente recebe eventos como `player_damaged`, `player_dead` e `player_respawned` e apenas anima o resultado. O saldo nunca deve ser reduzido ou aumentado por `G.cash` em resposta a combate local.

## 7. Imóveis, territórios, XP e progressão não são protegidos — P0

### Evidência

`comprarImovel()` debita `G.cash`, marca o imóvel como comprado e libera canteiros diretamente no cliente (`quintal-cidade.html:2858-2874`). `ganharXP()` e `tomarPonto()` também são locais (`quintal-cidade.html:2564-2574`). O servidor não possui casos equivalentes nem campos persistidos para imóveis, territórios, XP e nível.

### Exploração possível

Um cliente alterado pode desbloquear fazenda e casa nova, subir de nível, tomar territórios e alterar o placar sem pagar nem cumprir requisitos. Essa é uma vulnerabilidade de progressão e economia, ainda que a função não esteja em `servidor-1.js`, porque o servidor não oferece uma autoridade que a substitua.

### Correção

Criar no servidor estruturas persistentes para `properties`, `territories`, `level`, `xp` e eventos de recompensa. Toda compra deve ser `purchase {itemId}`; o servidor verifica nível, saldo, pré-requisitos e propriedade. Toda captura deve resultar de um evento server-side validado, como morte confirmada ou interação em ponto, nunca de um pedido `claim` aceito isoladamente. O placar deve ser uma leitura do banco/server state, não um objeto gravado pelo cliente.

## 8. Primeira posição e movimento ainda confiam demais no cliente — P1 alto

### Evidência

A primeira mensagem `input` aceita diretamente `nx`, `ny` e `nz` e define `j.x`, `j.y`, `j.z` sem checar distância, spawn permitido ou colisão (`servidor-1.js:1017-1053`). Nas mensagens seguintes, a colisão horizontal é validada, mas `y` continua sendo recebido diretamente e não existe simulação server-side de velocidade vertical, salto ou gravidade.

### Exploração possível

O cliente pode nascer em qualquer ponto permitido pelos limites numéricos e alterar a altura para voar, atravessar barreiras verticais ou obter vantagem de combate. Depois do primeiro pacote, ainda pode escolher posições dentro do limite `VEL_MAX` em vez de enviar intenção de movimento.

### Correção

O servidor deve decidir o spawn com base em `propertyId`, posição de portão e pontos válidos. A primeira posição enviada deve ser ignorada ou comparada com uma tolerância pequena ao spawn oficial. Para o movimento, a solução mais robusta é receber vetor de intenção, estado de teclas ou direção e simular velocidade, gravidade, salto e colisão no servidor. Como etapa intermediária, validar `y`, velocidade vertical, salto, sequência de input e tempo monotônico, além de reduzir a folga do limite horizontal.

## 9. Funcionários têm contratação protegida, mas não têm autoridade completa — P1

### Evidência

A contratação server-side valida cargo, preço, saldo, duplicidade, ID e dono (`servidor-1.js:1270-1307`). Porém, funcionários ficam em arrays/mappings de memória (`servidor-1.js:698-705`), não são salvos, não têm propriedade formal, tarefas, alvo, posição autoritativa ou diária. O cliente ainda executa `tickFuncs()` e decide ações (`quintal-cidade.html:2793-2857`).

### Impacto

A e B podem ver o mesmo funcionário apenas enquanto ele estiver presente no processo do servidor e próximo pela AOI. Após reinício, ele desaparece. A lógica de trabalho pode divergir e o cliente pode fazer rega/colheita em nome do funcionário sem existir uma máquina de estados server-side.

### Correção

Persistir `funcId`, `ownerId`, `propertyId`, cargo, custo, diária, posição, tarefa, alvo, estado e `lastPaidAt`. O servidor deve escolher o alvo e executar as ações usando as mesmas funções internas de validação das ações do jogador. O cliente deve remover `tickFuncs()` no modo online e apenas interpolar snapshots.

## 10. Persistência e inicialização podem produzir estado inconsistente — P1

### Evidência

O servidor pode cair para memória quando SQLite/Postgres não está disponível (`servidor-1.js:168-245`). No PostgreSQL, `carregarLotes()` é disparado de forma assíncrona após a criação das tabelas (`servidor-1.js:204-220`), mas o WebSocket já é criado e aceita conexões depois do carregamento do módulo (`servidor-1.js:928-949`). O salvamento periódico ocorre a cada 20 segundos para carteiras e a cada 60 segundos para lotes (`servidor-1.js:1493-1502`).

### Impacto

Um jogador pode conectar antes de o mundo persistido terminar de carregar e receber atribuição baseada em lotes ainda vazios. Uma queda pode perder alterações recentes. IDs de estoque e sequência de entidades são contadores em memória, não identificadores duráveis.

### Correção

Transformar o boot em uma função assíncrona que aguarda banco, migrações e carregamento de lotes antes de chamar `listen()` e aceitar WebSocket. Operações econômicas devem ser transações no banco ou fila de comandos durável. Salvar apenas a cada intervalo não deve ser a única proteção para compras, vendas e colheitas: cada transação importante deve confirmar persistência antes de emitir o resultado definitivo. Usar UUID/ULID server-side para entidades que sobrevivem a reinícios.

## 11. Rotas legadas por índice mantêm uma segunda política de autorização — P1

### Evidência

`regar` e `colher` aceitam tanto ID quanto índice (`servidor-1.js:1079-1099` e `1362-1402`). O caminho por ID usa `entidadeDoJogador()`, enquanto o caminho antigo acessa diretamente o lote atribuído e o índice recebido.

### Correção

Adicionar versão de protocolo, registrar métricas de uso das mensagens antigas e migrar o cliente. Após o período de compatibilidade, rejeitar mensagens por índice. Se a compatibilidade for inevitável, ambos os caminhos devem chamar a mesma função interna, que resolve o índice para a entidade, valida dono, distância, estágio e propriedade.

## O que já está correto e deve ser preservado

O servidor já tem várias defesas importantes: limite de payload, rate limit por socket, parsing protegido, limite de valores numéricos, heartbeat, IDs server-side para plantas/lotes/portões, validação central de tipo/dono no caminho novo, crescimento de plantas online no servidor, verificação de tempo de secagem/cura, colisão horizontal com subpassos e linha de visão para bots e polícia (`servidor-1.js:22-30`, `515-627`, `1017-1057`, `1224-1267`, `1335-1349`). Essas estruturas devem ser mantidas e ampliadas, não substituídas por lógica local.

## Ordem recomendada de correção

| Ordem | Correção | Motivo |
|---:|---|---|
| 1 | Corrigir entrypoint e inicialização do banco | Sem servidor inicializado corretamente, os demais testes não são confiáveis |
| 2 | Fechar handshake, identidade e `hello` único | Evita troca de identidade e acesso indevido a carteira/lote |
| 3 | Corrigir autorização de entidades e validar distância | Fecha portões/plantas/estações operáveis remotamente |
| 4 | Remover `colher_local` e tornar todos os canteiros server-side | Elimina fabricação de estoque |
| 5 | Tornar venda uma transação com estação e comprador server-side | Protege o dinheiro do jogo |
| 6 | Validar arma, munição, cadência e dano no servidor | Elimina tiro infinito e farming |
| 7 | Migrar HP, morte, respawn, XP, imóveis e territórios | Fecha progressão e consequências econômicas |
| 8 | Persistir funcionários e mover sua IA para o servidor | Garante entidades realmente compartilhadas |
| 9 | Remover rotas legadas | Reduz a duplicidade de regras |
| 10 | Criar testes de cliente modificado e testes de dois jogadores | Confirma que uma correção não cria outra divergência |

## Cenários mínimos de teste após a correção

| Teste | Resultado esperado |
|---|---|
| Enviar `hello` duas vezes com chaves diferentes | Segunda tentativa recusada ou socket encerrado |
| Operar portão antes de `hello` | Recusado |
| Operar portão de outro jogador | Recusado |
| Operar portão a 100 metros | Recusado |
| Enviar `colher_local` com genética inventada | Mensagem removida ou recusada |
| Vender com `demanda: 2.5` forçada | Valor definido pelo comprador/servidor |
| Vender longe do balcão | Recusado |
| Enviar 100 tiros sem munição | Apenas tiros válidos causam dano |
| Alterar `dano` para 60 com punho | Dano calculado pela arma oficial |
| Ignorar `levou_tiro` | Servidor ainda registra dano/morte |
| Comprar imóvel alterando `G.cash` local | Servidor não concede imóvel |
| Nascer em coordenada arbitrária | Servidor reposiciona para spawn oficial |
| Reiniciar servidor com funcionário contratado | Funcionário reaparece uma única vez, com mesmo ID |
| Dois clientes observando a mesma entidade | Mesmo ID, estado e sequência de eventos |

## Conclusão

As falhas mais perigosas não estão na colisão ou na linha de visão — essas duas áreas já possuem uma base server-side razoável. O risco principal está nas operações em que o cliente ainda envia o **resultado** em vez da **intenção**: genética/saúde da colheita local, demanda da venda, dano do tiro, progressão, morte e identidade. A correção deve priorizar esses fluxos e preservar o cliente como renderizador, nunca como autoridade econômica ou de gameplay.

## Referências

[1]: `/home/ubuntu/upload/servidor-1.js` — servidor WebSocket e estado autoritativo auditado.
[2]: `/home/ubuntu/upload/quintal-cidade.html` — cliente HTML/JavaScript auditado.
[3]: `/home/ubuntu/upload/package.json` — scripts e dependências do projeto.
