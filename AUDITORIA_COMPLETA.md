# Auditoria completa — Quintal 3D

**Escopo:** leitura do briefing, `package.json`, `quintal-cidade.html` e `servidor-1.js`. Nenhum arquivo do jogo foi alterado. A análise abaixo distingue o que é realmente server-side, o que é cliente/local, o que é híbrido e o que ainda não existe.

> **Conclusão executiva:** o projeto já possui uma base real de servidor autoritativo para jogadores, lotes, portões, plantas dos lotes, carteira/estoque, rivais, polícia e existência de funcionários. Porém, ele ainda não é um mundo compartilhado completo: clientes-NPC, imóveis, territórios, progressão, parte da cadeia produtiva, vida do jogador, munição, armadura e funcionários em sua lógica de trabalho continuam locais ou incompletos. Há também uma incompatibilidade de entrada que impede `npm start` de usar o único arquivo de servidor enviado.

## 1. Estado geral da arquitetura

O servidor roda WebSocket em 20 Hz, mantém jogadores em `Map`, envia snapshots com sequência de tick e aplica AOI de 70 metros. Também possui heartbeat, limite de payload, rate limit e validações numéricas. O cliente envia posição periodicamente, interpola jogadores, bots e funcionários e desenha os estados recebidos. Essa parte é uma fundação multiplayer legítima, não apenas uma simulação local.

A migração, contudo, foi feita em etapas e deixou dois modelos coexistindo: um modelo online autoritativo e um modelo offline/local. Isso é aceitável como estratégia de compatibilidade, mas exige que cada sistema declare explicitamente qual modo está ativo. Hoje, em alguns casos, o cliente altera o estado visual/local antes da confirmação do servidor; em outros, ele ainda executa lógica de jogo mesmo quando a mesma entidade existe no servidor.

| Área | Situação real | Classificação |
|---|---|---|
| Jogadores e movimento | Servidor recebe `input`, valida velocidade e usa `moverComColisao`; cliente apenas envia e corrige a posição | **Server-side real** |
| Jogadores visíveis | Snapshots com AOI e interpolação no cliente | **Sincronizado por proximidade** |
| Lotes e portões | IDs server-side, dono por chave persistente e estado do portão no servidor | **Server-side real** |
| Plantas dos 16 canteiros de cada lote | Crescimento, água, saúde, estágio, ID, dono e remoção no servidor | **Server-side real** |
| Carteira, banco, sementes e estoque | Catálogos e operações principais no servidor | **Server-side real, com lacunas** |
| Rivais e polícia | Spawn, movimento, visão, tiro policial, dano ao jogador e morte dos bots no servidor | **Server-side real, mas vida do jogador não** |
| Funcionários | Existência, custo, ID e dono no servidor; tarefas e diária não | **Parcial/híbrido** |
| Clientes do balcão | Criados, movimentados e vendidos pelo cliente | **Visual/local** |
| Imóveis | Comprados e desbloqueados somente no cliente | **Visual/local** |
| Territórios | Captura e placar continuam em armazenamento do cliente | **Visual/local** |
| Save/load | Carteiras/lotes têm persistência server-side; muitos estados continuam em `localStorage`/`window.storage` | **Híbrido** |
| Entrada do servidor | `package.json` aponta para `servidor.js`, mas só foi enviado `servidor-1.js` | **Bloqueio operacional** |

## 2. Inventário técnico dos sistemas

A tabela usa “não existe” quando não há implementação correspondente no servidor, e “parcial” quando há apenas uma parte da responsabilidade.

| Sistema | Onde existe | Autoridade | ID server-side | Dono server-side | Sincronização | Risco principal |
|---|---|---|---|---|---|---|
| Jogador | `servidor-1.js:877-1057`; cliente: envio em `4523-4530` | Servidor | ID de conexão; identidade persistente em `chave` | Não há posse de jogador como entidade persistida | Snap/AOI | Primeira posição é aceita sem validar nascimento, área ou lote; cliente ainda escolhe `y` e rotação |
| Identidade | `hello` em `973-1007`; `persistId` no cliente em `4337-4338` | Servidor aceita a chave enviada | Não há autenticação criptográfica | Chave usada para lote/carteira | Indireta | `persistId` é gerado pelo navegador e pode ser forjado; não é autenticação de conta |
| Lote | `lotes` e `atribuirLote` em `73-105`; IDs em `406-409` | Servidor | `lt_N` | Sim, por `donoChave` | `welcome`, `lote_atribuido`, visual por cliente | A atribuição ocorre por chave enviada pelo cliente; sem login, posse depende de segredo local não confiável |
| Portão | `portaoId`, `portaoAberto`, caso `portao` em `1309-1321` | Servidor | `pt_N` | Sim | Broadcast `portao_estado` | A checagem de dono existe, mas a ação não exige distância do jogador ao portão |
| Planta online | `lote.plots`, caso `plantar`, `regar`, `colher` | Servidor | `pl_N` | Sim | `lote_update` para todos | Caminhos legados por `plot` continuam aceitos e não usam ID/dono em `regar` e `colher` |
| Crescimento | `crescer` em `117-145`; tick em `1464-1491` | Servidor para lotes online | Planta recebe ID | Lote determina dono | Broadcast global de `lote_update` | Plantas locais continuam existindo e são colhidas por endpoint especial sem prova de existência |
| Sementes | Carteira server-side; UI cliente | Servidor nas compras | IDs da genética não são IDs de item persistente uniforme | Carteira | `estado` | `cruzar` recebe `filho` inteiro do cliente; servidor valida forma, mas aceita genética/atributos fornecidos pelo cliente |
| Estoque | `carteiras.estoque`, casos `colher`, `lote_estagio`, `vender` | Servidor | `proxLoteId`, mas contador apenas em memória | Implícito pela carteira | `estado` | IDs podem reiniciar após restart; venda aceita `demanda` enviada pelo cliente, embora limitada |
| Secagem/cura | Servidor mede `desde` e estágio | Servidor | Lote de estoque | Carteira | `estado` | Não existe etapa formal de embalagem; “pronto” é alcançado após cura |
| Venda | Caso `vender` em `1244-1267`; UI em `2173-2191` | Servidor calcula valor | ID do lote | Carteira do jogador | `venda_ok` + `estado` | Venda no “balcão” local usa cliente-NPC local, mas servidor só recebe `onde`/`demanda`; não valida estação, proximidade ou cliente específico |
| Funcionário | Caso `contratar_func` e `funcionarios` em `683-710`, `1270-1307` | Existência: servidor | `fn_N` | Sim | Snapshot AOI e `func_contratado` | Sem persistência, movimento server-side, tarefa, diária ou vínculo a propriedade; UI não registra o funcionário em `G.func` |
| Cliente-NPC | `spawnCliente` e tick em `2409`, `3538-3576` | Cliente | Não | Não | Não | Cada navegador cria clientes diferentes; venda e permanência também são locais |
| Rival | Servidor em `729-874`; modelo visual no cliente | Servidor | `b_N` | Território do bot, não jogador | Snapshot AOI e eventos | Não há loot server-side; recompensa econômica por matar rival só é local/offline |
| Polícia | Servidor em `758-796`, `1324-1332`, tick em `1422-1433` | Servidor para spawn/tiro | `p_N` | Não aplicável | Snapshot/eventos globais | `crime` é uma declaração do cliente; servidor aceita o peso limitado e não valida o ato criminoso |
| Vida do jogador | Dano de polícia chega por `levou_tiro`; `dano` é client-side | Cliente | Não | Não | Não | Vida, armadura, morte, perda de dinheiro e respawn não são autoridade do servidor |
| Imóveis | `comprarImovel` em `2858-2874`; save local | Cliente | Não | Não | Não | Qualquer cliente modificado pode desbloquear fazenda/casa nova e alterar renda sem cobrança server-side |
| Territórios | `tomarPonto`, `claimTerritoryOnline`, `window.storage` | Cliente/armazenamento compartilhado do app | ID é `meuId` local | Não | Não é snapshot do servidor | Captura, dono e placar podem ser falsificados e não são estado único do mundo |
| Colisão | Servidor: `COL_ESTATICOS`, `COL_LOTE_REL`, `moverComColisao`, `temVisao` | Servidor para jogador/bots | Não aplicável | Não aplicável | Cliente tem colisores próprios | Geometria duplicada e hardcoded em dois arquivos pode divergir; primeira posição do jogador é exceção |
| AOI | Servidor: `AOI_RAIO=70`, snapshot em `1434-1461` | Servidor | IDs presentes | Conforme entidade | Sim, por proximidade | Não é “todos veem tudo”; entidades fora de 70 m não são enviadas, corretamente por performance |
| Save/load | Cliente: `3161-3273`; servidor: SQLite/Postgres/memória | Dividida | IDs locais/server-side misturados | Dividido | Parcial | Botão SALVAR não equivale a salvar servidor; dados locais podem reaparecer antes do `estado` inicial |

## 3. Fluxo real cliente → servidor → clientes

### Movimento

O cliente envia `input` aproximadamente a cada 50 ms com `x`, `y`, `z`, `ry` e arma. O servidor aceita a primeira posição sem validar distância ou propriedade; depois calcula distância, aplica limite de velocidade e passa o trajeto por `moverComColisao`. Se houver obstáculo, envia `correcao` e mantém a posição resultante. Em seguida, o snapshot distribui os jogadores próximos. Portanto, colisão server-side existe e é usada pelo jogador, mas o nascimento inicial ainda é uma confiança explícita.

### Plantio, rega e colheita de lote

O cliente envia o índice do canteiro ou, quando disponível, o ID da planta. O servidor cria a planta, gera `pl_N`, associa a `loteIndex` e `plotIndex`, calcula crescimento em tick e transmite `lote_update`. A colheita por ID valida dono, estágio, capacidade do estoque, remove a planta e cria o lote de estoque. Essa é a parte mais próxima do modelo desejado.

Existe, porém, compatibilidade legada. `regar` sem ID busca diretamente o lote do jogador e o índice recebido; `colher` sem ID faz o mesmo. Esses caminhos não passam pela validação central `entidadeDoJogador`. Eles ainda não permitem tomar a planta de outro lote, porque o lote é escolhido pela chave do próprio jogador, mas mantêm uma superfície duplicada e devem ser eliminados depois de migrar todos os clientes.

### Funcionários

O cliente envia somente `{t:'contratar_func', cargo}`. O servidor escolhe catálogo, preço, verifica saldo, cria `fn_N`, associa dono e transmite no snapshot AOI. Logo, A e B podem ver o mesmo funcionário enquanto o processo do servidor não reiniciar.

O cliente, entretanto, não incorpora `func_contratado` em `G.func`; esse evento apenas mostra toast e redesenha a banca. Os funcionários aparecem em `mpFuncs` pelo snapshot, mas a tela de negócios continua calculando `tem=!!G.func[f.k]`. A proteção contra duplicidade existe no servidor, porém a UI fica inconsistente. Além disso, `tickFuncs` ainda movimenta e decide tarefas de funcionários locais; para canteiros online ele apenas dispara pedidos de rega/colheita a partir de uma IA local. O servidor não decide alvo, posição, estado de trabalho, diária nem persistência.

### Clientes-NPC

`spawnCliente()` cria um humanoide diretamente na cena, grava o objeto em `G.clientes` e coloca todos os dados de personalidade, destino, espera e compra no navegador. O loop local cria novos clientes em função de `cliTimer`, move-os ao `COUNTER` fixo, decide desistência e marca `done`. Na venda, o cliente calcula preço visual e envia somente o ID do lote, quantidade, `onde` e demanda. O servidor não possui caso para criar, mover, identificar ou resolver um cliente-NPC. Portanto, este requisito é **não existe server-side**.

### Combate

Contra bots do servidor, o cliente faz seleção visual de alvo e envia `tiro_bot`. O servidor valida existência do bot, distância, linha de visão e dano limitado, e transmite dano/morte. A validação de parede funciona nos dois sentidos para tiros implementados no servidor: jogador contra bot e polícia contra jogador usam `temVisao`.

O cliente ainda simula inimigos/polícia offline, aplica dano local, concede dinheiro por rival abatido, captura território e perde dinheiro ao morrer. Online, o evento `levou_tiro` apenas chama `dano()` no navegador; o servidor não guarda HP, armadura, morte ou respawn do jogador. Assim, o tiro policial é uma entidade compartilhada, mas o resultado econômico e de sobrevivência do alvo não é.

## 4. Auditoria da cadeia produtiva

| Etapa | Implementação real | Autoridade | Diagnóstico |
|---|---|---|---|
| Semente | Compra no servidor; carteira enviada em `estado` | Servidor na compra | Parcialmente correta |
| Planta | Lotes online guardam planta com ID e dono | Servidor | Correta no modo online |
| Crescimento | `crescer()` no tick de 1 segundo | Servidor | Correta para plantas online |
| Colheita | Caso `colher` calcula quantidade no servidor | Servidor | Correta para ID/plantas online |
| Secagem | Estoque recebe estágio `sec` e `desde` | Servidor | Existe |
| Cura | Caso `lote_estagio` avança após tempo mínimo | Servidor | Existe |
| Embalagem | Não há entidade/ação/caso separado | Não existe | **Não existe como etapa real** |
| Estoque | Lote server-side dentro da carteira | Servidor | Existe, mas ID é volátil após restart |
| Cliente | Cliente-NPC é local | Cliente | Não compartilhado |
| Venda | Dinheiro e remoção do estoque no servidor | Servidor | Parcial: estação/cliente/proximidade não são validados |

O servidor usa `limparStrain()` para limitar tipos e intervalos de genética, mas isso não significa que a genética seja legítima. No cruzamento, o cliente constrói `filho` e o servidor apenas valida o formato e adiciona duas unidades. Um cliente modificado pode fornecer uma genética artificial dentro dos limites. Se a genética tiver valor econômico, o servidor deve calcular o filho a partir de duas sementes que pertençam à carteira, e não aceitar o resultado final.

A colheita `colher_local` é explicitamente uma compensação temporária: o servidor não prova que a planta existiu; recebe genética e saúde, impõe intervalo e limita a quantidade. Isso reduz abuso, mas não atende à autoridade desejada. O caminho correto é migrar estufa, grow room, fazenda e casa nova para o mesmo modelo de planta server-side, com IDs e propriedade.

## 5. Lotes, casas, portões e estações

Os lotes online são criados visualmente a partir de dez posições fixas e possuem 16 slots server-side. A casa é montada no cliente com layout determinístico por semente do lote, e o portão usa o estado recebido do servidor. O spawn online passa por `nascerNaPropriedade()`, evitando o retorno acidental ao quintal antigo. Nesse fluxo, a propriedade atribuída é real dentro do modelo atual.

As estações internas, porém, são principalmente geometria cliente. O servidor conhece retângulos de colisão e calcula venda sem verificar se o jogador está na bancada correta, se a estação pertence ao lote, se a porta está aberta ou se a propriedade está acessível. Como consequência, uma mensagem forjada para `vender` pode vender um lote pronto de sua própria carteira sem estar no balcão, e a mensagem pode declarar `onde:'ponto'` para obter a fórmula de preço correspondente. A posse do estoque é protegida; a localização e o contexto da operação não.

O “quintal antigo” continua representado por constantes globais do cliente, incluindo `COUNTER`, `SHOP`, `GATE` e ambientes fixos. Ele é usado como cenário original e como modo offline. No online, o jogador nasce no lote atribuído, mas o balcão global ainda é o único cliente-NPC/venda visual. Isso explica por que existe apenas um local de venda compartilhável visualmente — na verdade, nem ele é compartilhado.

## 6. Economia e persistência

| Ação | Cliente | Servidor | Validado | Risco |
|---|---|---|---|---|
| Compra de semente | Envia genética-base | Calcula preço, raridade e debita | Sim, parcialmente | Genética-base enviada pelo cliente; precisa catálogo/ID server-side |
| Compra de melhoria | Atualiza visual antes da confirmação | Confere catálogo e saldo | Sim no servidor | Cliente não desfaz visual se houver atraso/recusa |
| Compra de adubo | Incrementa `G.fert` imediatamente | Debita e salva `fert` | Sim, mas UI pode divergir | Confirmação não é usada para aplicar no cliente |
| Compra de arma | Atualiza munição local | Apenas marca `armas[k]=true` | Parcial | Munição não é autoridade do servidor; compras repetidas têm semântica inconsistente |
| Colete | Define armadura 100 no cliente | Cobra, mas não grava armadura | Não | Recurso efetivo é local |
| Cruzamento | Calcula filho | Debita e adiciona filho recebido | Parcial | Cliente escolhe o resultado genético |
| Colheita online | Apenas solicita | Confere planta, estágio e quantidade | Sim | Boa base |
| Colheita local | Envia genética/saúde | Estima por limites e intervalo | Parcial | Não prova planta, dono ou estação |
| Secagem/cura | Cronômetro é visual | Confere `desde` e estágio | Sim | Tolerância de 15% reduz o tempo mínimo |
| Venda | Solicita lote e quantidade | Confere lote, estágio e calcula valor | Parcial | Não valida posição, estação, comprador ou demanda real |
| Contratação | Solicita cargo | Catálogo, custo, saldo, dono e ID | Sim para existência | Sem diária, tarefas e persistência |
| Imóveis | Debita e desbloqueia | Não existe caso correspondente | Não | Falsificação direta |
| Territórios | Captura, XP e placar locais | Não existe estado equivalente | Não | Falsificação direta |
| Morte/respawn | Perde 30% e reposiciona | Não participa | Não | Economia pode ser alterada localmente |
| Admin F10 | Adiciona dinheiro e XP | Não participa | Não | O modo admin do cliente é uma vulnerabilidade local/econômica |

O banco server-side salva usuários com `cash`, `bank`, `estoque`, melhorias, armas, fertilizantes e capacidade de rack; salva lotes com dono, plantas e portão. Isso é melhor que o save local para esses campos. Contudo, se nenhum banco estiver disponível, o servidor cai para memória. No Render, SQLite local não é persistência confiável sem armazenamento persistente; o próprio comentário do código reconhece essa limitação.

Há uma corrida de inicialização no PostgreSQL: `carregarLotes()` é disparado de forma assíncrona após criação das tabelas, enquanto o WebSocket já pode aceitar conexões. Um `hello` muito cedo pode tentar atribuir lote antes de os donos salvos serem carregados. A inicialização deve aguardar explicitamente o carregamento do mundo antes de aceitar jogadores.

## 7. Problemas críticos

### P0 — `npm start` aponta para arquivo inexistente

`package.json` declara `main: servidor.js` e `start: node servidor.js`, mas o único servidor enviado é `servidor-1.js`. O comando não inicia o servidor neste pacote exatamente como foi recebido. A checagem sintática de `servidor-1.js` passou, mas isso não corrige o entrypoint. Antes de qualquer teste multiplayer, é necessário decidir qual será o nome oficial do servidor.

### P0 — Clientes-NPC não são compartilhados

Não existe entidade `cliente` no servidor, nem ID, AOI, estado, destino, transação ou resolução server-side. Cada navegador executa uma população independente no balcão fixo. Isso contradiz diretamente o objetivo de A, B e C enxergarem o mesmo cliente.

### P0 — Imóveis, territórios, XP e várias consequências econômicas são falsificáveis

`comprarImovel`, `tomarPonto`, `ganharXP`, `morrer`, munição, armadura e o modo admin alteram o estado no cliente. Um usuário modificado não precisa pagar, possuir nível, provar combate ou possuir o território. O `window.storage` do placar não é autoridade do mundo.

### P0 — Funcionários são somente parcialmente migrados

A existência online está correta, mas o servidor não controla posição, tarefa, alvo, rega, colheita, diária ou persistência. Após reinício, os funcionários desaparecem. A lógica local ainda decide ações, inclusive para funcionários que representam entidades server-side.

### P1 — Venda não valida localização nem estação

O servidor valida o lote de estoque, mas não valida o jogador estar na bancada, balcão ou ponto correspondente. O campo `onde` é aceito como decisão do cliente para escolher a fórmula de preço. A venda precisa receber uma estação/entidade e ser validada por área/propriedade.

### P1 — Caminhos legados duplicam a autoridade das plantas

`regar` e `colher` aceitam tanto ID quanto índice. O caminho por índice deve ser removido após a migração, pois dificulta auditoria e permite comportamentos diferentes entre chamadas novas e antigas.

### P1 — O servidor aceita a primeira posição sem regra de nascimento

A correção evita o bug de spawn em `(0,0)`, mas qualquer cliente pode declarar sua primeira coordenada. É necessário validar o nascimento contra o lote atribuído, uma área de spawn e colisão, ou ignorar a posição inicial enviada e fazer o servidor escolher o ponto.

### P1 — Persistência de IDs e entidades é incompleta

IDs de plantas e lotes de estoque usam contadores em memória. Depois de reinício, podem ser reutilizados. Funcionários, bots vivos, estado procurado, HP dos jogadores, transações e tarefas não são persistidos. IDs persistentes devem ser UUID/UUID-like gerados pelo servidor e armazenados quando o objeto sobreviver a reinícios.

## 8. Problemas médios

A UI altera melhorias, fertilizantes, armas e munição antes de receber confirmação. Em caso de recusa, desconexão ou corrida de mensagens, a apresentação pode divergir até o próximo `estado`, e alguns campos não voltam porque nem são enviados pelo servidor.

O cliente usa uma geometria de propriedade e o servidor mantém outra lista hardcoded de colisores. A solução funciona enquanto os números permanecerem idênticos, mas qualquer mudança visual pode reabrir paredes, portas ou linhas de tiro. O ideal é extrair um mapa de colisão compartilhado ou gerar os dois lados a partir de uma única descrição.

O servidor transmite `lote_update` com `paraTodos`, sem AOI específico para plantas. Funciona para dez lotes pequenos, mas não escala bem quando o número de propriedades e atualizações aumentar. O estado deveria seguir o mesmo filtro espacial das entidades.

O evento `func_contratado` não contém um identificador de confirmação de operação, e a contratação não envia um evento global dedicado. A visibilidade depende do snapshot AOI. Isso é suficiente para renderizar proximidade, mas dificulta UI, reconciliação e histórico.

O cliente captura erros do `onmessage` com `catch(e){}` vazio. Isso impede diagnosticar incompatibilidades de protocolo, falhas de renderização e mensagens malformadas. Para um jogo em migração, é necessário registrar erros controladamente, sem expor dados sensíveis ao jogador.

## 9. Sistemas já corretos ou com boa base

A criação de IDs de plantas, lotes e portões no servidor é uma decisão correta. A função `entidadeDoJogador` centraliza existência, tipo e dono para o caminho novo. A carteira é indexada por chave persistente em vez de socket, evitando zerar o saldo a cada recarga quando o banco está disponível.

O servidor calcula preços de sementes, verifica saldo e limita valores numéricos. O estoque não aceita `estoque_add` direto do cliente. O estágio de secagem/cura é conferido pelo tempo do servidor. A colheita online calcula a quantidade a partir da planta server-side e remove a entidade para todos.

A colisão do movimento usa subpassos, evitando tunelamento por paredes finas. A linha de visão amostra o segmento e é reutilizada para perseguição, tiro da polícia e tiro do jogador contra bot. Portões fechados entram na geometria server-side e portões abertos são removidos dela.

Rivais e polícia têm uma única população no servidor em modo online, com IDs, AOI, posição e eventos de morte. O cliente interpola snapshots em vez de inventar uma IA diferente para os mesmos bots. O heartbeat e o rate limit são boas proteções operacionais.

## 10. Arquitetura recomendada

A arquitetura final deve tratar cada propriedade e cada entidade do mundo como dados server-side, mantendo o cliente como apresentação.

```text
SERVIDOR AUTORITATIVO
|
+-- Identidade/conta
+-- Jogadores: posição, vida, inventário, progressão
+-- Propriedades: dono, geometria, estações, portões
+-- Plantas: ID, lote, posição, genética, estágio, tempo, saúde
+-- Estoque: ID, dono, quantidade, qualidade, estágio, origem
+-- Clientes-NPC: ID, propriedade-alvo, estado, rota, compra
+-- Funcionários: ID, dono, propriedade, cargo, tarefa, diária
+-- Rivais/polícia: ID, IA, visão, alvo, dano, morte
+-- Economia: transações atômicas e ledger
+-- Persistência: usuários, propriedades e entidades duráveis
+-- AOI: filtros por região e tipo de entidade
|
CLIENTE
+-- Renderização e modelos 3D
+-- Animação e interpolação
+-- Câmera, HUD, menus e efeitos
+-- Predição visual temporária
+-- Envio de intenção, nunca de resultado
```

Cada mensagem de ação deve conter uma intenção mínima: `plantar {plotId, seedId}`, `regar {plantId}`, `vender {stockId, stationId, quantity}`, `contratar {jobType}`, `abrir_portao {gateId}`. O servidor deve responder com confirmação ou recusa contendo um código estável. O cliente só altera estado definitivo após confirmação/snapshot.

Para clientes-NPC, o servidor deve criar uma entidade com `id`, `dono/propriedadeAlvo`, `estado`, `destino`, `velocidade`, `slot`, `spawnTime`, `tempoLimite` e, quando comprar, `transactionId`. A IA deve rodar somente no servidor. Todos os clientes dentro da AOI recebem a mesma entidade e os mesmos eventos.

Para funcionários, a próxima versão deve manter uma tabela/estrutura persistente com `id`, `ownerKey`, `propertyId`, `cargo`, `custo`, `diaria`, `position`, `task`, `targetEntityId`, `state` e `lastPaidAt`. O servidor escolhe alvo, calcula caminho, executa rega/colheita através dos mesmos comandos internos validados e cobra diária. O cliente deve remover `tickFuncs` online; ele apenas interpola o funcionário recebido.

## 11. Plano de migração em etapas pequenas

### Etapa 0 — tornar o projeto executável e observável

**Auditoria:** confirmar o entrypoint, variáveis de ambiente, modo de banco e ordem de inicialização. **Implementação:** definir `servidor.js` oficial ou ajustar o script de início; criar logs de protocolo, erros e métricas de rejeição. **Teste:** iniciar com `npm start`, conectar um cliente e verificar `/metrics`. **Regressão:** confirmar que o modo offline ainda inicia quando o servidor está indisponível.

### Etapa 1 — fechar a autoridade de identidade, spawn e ações legadas

**Auditoria:** listar todas as mensagens aceitas por índice e todas as posições iniciais. **Implementação:** servidor escolhe spawn; migrar `regar`/`colher` para IDs; validar distância e área nas ações. **Teste:** tentar teleporte inicial, ID inexistente, planta de outro lote e estação distante. **Regressão:** plantar, regar, colher e abrir portão com dois jogadores.

### Etapa 2 — concluir plantas e cadeia produtiva server-side

**Auditoria:** migrar canteiros de estufa, grow, fazenda e casa nova; remover `colher_local`. **Implementação:** registrar cada planta com ID, propriedade, posição, ambiente, crescimento e tempo. Criar embalagem como estágio/ação real se ela for parte do design. **Teste:** reinício, desconexão, planta pronta offline e tentativa de vender estágio inválido. **Regressão:** crescimento, água, praga, colheita e estoque.

### Etapa 3 — concluir economia e persistência

**Auditoria:** enumerar todos os writes em `G.cash`, `G.bank`, `G.lotes`, `G.up`, `G.fert`, munição, armadura, XP, imóveis e territórios. **Implementação:** mover cada write econômico para comandos server-side e persistir transações. O save local deve guardar apenas preferências/câmera. **Teste:** cliente modificado, mensagens repetidas, duas conexões com a mesma conta e restart. **Regressão:** compras, venda, saldo e carregamento.

### Etapa 4 — funcionários totalmente compartilhados

**Auditoria:** remover dependência de `tickFuncs` online e definir tarefas. **Implementação:** posição, movimento, alvo, tarefa, rega, colheita, diária e persistência no servidor. **Teste:** A contrata, B vê; A desconecta; servidor reinicia; A reconecta; nenhum funcionário duplica. **Regressão:** contratação, saldo, tarefa e snapshots AOI.

### Etapa 5 — clientes-NPC compartilhados

**Auditoria:** identificar o balcão único e todas as regras locais de `G.clientes`. **Implementação:** entidade server-side, IA única, rotas, chegada ao lote, compra e saída. Cada propriedade deve ter sua fila/estação. **Teste:** A e B observam o mesmo ID, percurso, espera e transação; cliente forjado não cria NPC nem dinheiro. **Regressão:** venda, estoque, portão e AOI.

### Etapa 6 — combate e polícia completos

**Auditoria:** separar dano visual de HP oficial e remover recompensas locais. **Implementação:** HP, armadura, morte, respawn, loot, crime e recompensa server-side; validar origem, alvo, alcance e cadência. **Teste:** tiro através de parede, portão fechado/aberto, dois jogadores atirando no mesmo bot e morte simultânea. **Regressão:** polícia, rivais, AOI e movimento.

### Etapa 7 — consolidação de geometria e performance

**Auditoria:** medir draw calls, triângulos, materiais, memória e tempo de frame em PC/celular; o código atual não fornece essas medições. **Implementação:** uma fonte de verdade para colisores; instancing para objetos repetidos; LOD/streaming para casas; sombras e pixel ratio adaptativos. **Teste:** cenários com 1, 10 e 64 jogadores; 1.000 objetos repetidos; celular de baixa capacidade. **Regressão:** linha de visão, colisão e aparência.

## 12. Estratégia gráfica por qualidade

| Qualidade | Alterações recomendadas |
|---|---|
| Alta | Sombras de maior resolução, antialias ativo, pixel ratio limitado a aproximadamente 1.5–2, mais luzes locais apenas perto do jogador, casas e vegetação próximas montadas |
| Média | Sombras médias, pixel ratio limitado a 1–1.25, menor distância de sombras, luzes de ambientes agrupadas, LOD e streaming mais agressivos |
| Baixa | Sombras desativadas ou simples, pixel ratio 1, materiais simplificados, partículas reduzidas, distância de desenho curta, casas distantes apenas com proxy |

O código já usa `InstancedMesh` em frutos e alguns elementos repetidos e desmonta lotes distantes. Não há, nos arquivos fornecidos, uma medição real de draw calls, triângulos ou garbage collection. Portanto, não é possível afirmar que um gargalo específico já foi medido. A ordem correta é instrumentar primeiro, depois otimizar os maiores custos.

## 13. Matriz de visão de mundo

| Entidade | Server | ID | Dono | AOI | Todos veem? | Pode interagir? |
|---|---:|---:|---:|---:|---|---|
| Jogador | Sim | Sim | Identidade de conexão/chave | Sim | Todos dentro de 70 m | Movimento próprio; interação ainda incompleta |
| Propriedade | Sim | Sim | Sim | Cliente monta por proximidade | Estado conhecido no handshake; visual por streaming | Portão e plantas do dono |
| Portão | Sim | Sim | Sim | Estado enviado; geometria local quando montado | Sim, como estado | Dono pelo ID; falta distância |
| Planta online | Sim | Sim | Sim | Evento global hoje; visual por lote montado | Sim no estado recebido | Dono e estágio pelo caminho novo |
| Planta local | Não | Não | Não | Não | Não | Cliente local |
| Funcionário F1 | Parcial | Sim | Sim | Sim | Sim dentro da AOI | Não há interação real definida |
| Cliente-NPC | Não | Não | Não | Não | Não | Venda local apenas |
| Rival | Sim | Sim | Território do bot | Sim | Sim dentro da AOI | Tiro server-side |
| Polícia | Sim | Sim | Não | Sim | Sim dentro da AOI/eventos | Dano ao jogador ainda aplicado localmente |
| Estoque | Sim | Sim, volátil | Carteira | Não é entidade de mundo | Apenas dono recebe `estado` | Venda pelo dono; sem estação |
| Imóvel | Não | Não | Não | Não | Não | Compra local |
| Território | Não | Identidade local | Não | Não | Não | Captura local |

## 14. Respostas diretas às perguntas principais

A vê B e B vê A quando estão dentro da AOI; fora dela, não, por desenho do sistema. A vê funcionários de B apenas se o funcionário existir no servidor e estiver dentro de 70 metros. A não vê clientes-NPC de B, porque clientes ainda não existem no servidor. A vê polícia e rivais server-side por AOI, mas a consequência da polícia sobre HP/morte é local. A vê plantas e portões dos lotes por eventos/estado, com melhor consistência no caminho por ID.

As plantas online estão realmente no servidor e explicam por que plantar, regar e colher no lote podem ser compartilhados. As plantas de ambientes locais ainda são um atalho inseguro. As estações estão desalinhadas arquiteturalmente porque a geometria visual é criada por lote, mas a venda e os clientes continuam amarrados às constantes globais `COUNTER` e `GATE` do quintal antigo. O nascimento online já foi corrigido para o lote atribuído, mas a primeira posição ainda é aceita pelo servidor sem verificação.

A ordem correta de desenvolvimento é: entrada executável e observabilidade; identidade/spawn; remoção de caminhos legados; cadeia produtiva completa; economia/persistência; funcionários; clientes-NPC; combate completo; por fim, performance medida. Não se deve começar pelo embelezamento ou por uma migração gigante, porque isso esconderia divergências de autoridade.

## 15. Autorização para próxima fase

A auditoria está concluída sem alteração dos arquivos do projeto. A próxima ação deve aguardar autorização explícita. O primeiro passo recomendado, se autorizado, é corrigir apenas a entrada operacional e preparar testes automatizados/protocolo, sem ainda migrar clientes-NPC ou reescrever a economia.

## Referências aos arquivos auditados

[1]: `/home/ubuntu/upload/pasted_content.txt` — Briefing e requisitos de auditoria do Quintal 3D.
[2]: `/home/ubuntu/upload/package.json` — Scripts e dependências do projeto.
[3]: `/home/ubuntu/upload/servidor-1.js` — Servidor WebSocket e estado autoritativo.
[4]: `/home/ubuntu/upload/quintal-cidade.html` — Cliente HTML/JavaScript, renderização, UI e protocolo multiplayer.
