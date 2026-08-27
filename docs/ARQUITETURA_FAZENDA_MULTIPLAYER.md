# Arquitetura futura da Fazenda Multiplayer

## Objetivo

A Fazenda será uma área cooperativa do Quintal 3D liberada quando o jogador atingir o **nível 10**. Ela não será um conjunto de canteiros compartilhados sem dono. O desenho correto é uma fazenda multiplayer única, com **até 6 jogadores simultâneos**, na qual cada jogador recebe uma área privada com **12 lotes próprios**. A capacidade de projeto é, portanto, de até **72 lotes de plantio** na fazenda, distribuídos em seis espaços de jogador.

O prédio de processamento será coletivo e terá entrada, circulação e colisão coerentes. Dentro dele haverá um balcão de produção com **6 mesas físicas**. Cada mesa terá uma fila authoritative de trabalho para secagem, cura ou embalagem. O jogador verá o lote se movimentando pelo fluxo, mas não poderá transformar o estágio, a quantidade, o preço ou a conclusão pelo navegador.

> Regra central: o cliente apenas solicita ações e desenha o estado recebido. O servidor decide desbloqueio, dono, lote, capacidade, fila, tempo, estágio, estoque, pedido, pagamento e persistência.

## Organização espacial

A fazenda deverá ser dividida em seis setores identificados por `farmSlot` de 0 a 5. Cada setor terá 12 lotes em uma grade de 3 por 4, uma entrada própria e um caminho de circulação que não atravessa as áreas dos outros jogadores. O setor é atribuído pelo servidor e fica associado à chave persistente da conta, não ao ID temporário da conexão.

| Camada | Quantidade | Responsabilidade authoritative |
|---|---:|---|
| Fazenda multiplayer | 1 | Área compartilhada, porta, caminhos, prédio de processamento e pedidos |
| Slots de jogador | Até 6 | Associação persistente entre jogador e espaço privado |
| Lotes por jogador | 12 | Plantio, irrigação, pragas, crescimento, colheita e posse |
| Lotes totais | Até 72 | Capacidade máxima da fazenda na configuração de seis jogadores |
| Mesas do balcão | 6 | Processamento concorrente com fila e estágio válido |
| Jogadores na sessão da fazenda | Até 6 na área | Entrada, presença, AOI e sincronização multiplayer |

Os visitantes poderão enxergar jogadores, funcionários, plantas autorizadas e o prédio dentro do raio de interesse, mas ações de plantio, adubação, colheita, movimentação de produção e retirada de estoque deverão verificar `ownerKey` no servidor. Uma tentativa de usar o índice de lote de outro jogador será recusada mesmo que o cliente modifique a interface.

## Desbloqueio e alocação

O nível 10 deve ser verificado pelo servidor no momento da entrada e também em cada ação relevante. O cliente pode esconder ou mostrar a entrada da fazenda, mas essa indicação é apenas visual. Ao tentar entrar, o servidor deve confirmar o nível, localizar ou criar o registro do `farmSlot` persistente e devolver a posição oficial de entrada.

A alocação deve ser idempotente. Se o jogador desconectar, voltar ou trocar de aparelho, ele deve recuperar o mesmo setor e os mesmos 12 lotes. Se os seis slots estiverem ocupados, um sétimo jogador não deve receber um lote de outro jogador nem cair em uma área sem proprietário; deverá receber uma mensagem clara de fazenda cheia ou aguardar uma política posterior de instância.

Uma estrutura inicial compatível com o servidor atual pode ser organizada assim:

```text
farm_slots
  owner_key, slot_index, unlocked_at, updated_at

farm_plots
  plot_id, owner_key, slot_index, local_index,
  plant_json, updated_at

processing_jobs
  job_id, owner_key, station_id, stage,
  source_stock_id, quantity, started_at, completes_at, status

farm_orders
  order_id, owner_key, requirements_json,
  quantity, reward, expires_at, status
```

Os nomes são uma proposta de arquitetura, não uma ordem para alterar o banco agora. A migração deve ocorrer somente depois de uma implementação isolada e de fixtures de reconexão, concorrência e rollback.

## Funcionamento dos 12 lotes privados

Cada lote deve possuir um ID gerado pelo servidor, por exemplo `farm_plot_<uuid>`, e não depender apenas de `slot_index + local_index` enviado pelo cliente. O `local_index` pode ser usado para desenhar a posição, mas a autorização deve comparar o proprietário persistente e a entidade authoritative.

O fluxo de plantio será: o jogador se aproxima do lote, o cliente envia uma solicitação com o ID do lote e o ID da semente, o servidor verifica posse, distância, vida, inventário e catálogo, consome uma unidade e cria a planta com genética validada. Crescimento, água, saúde, praga, estágio e colheita permanecem no servidor. A colheita deve gerar estoque pertencente ao mesmo `ownerKey` e permanecer disponível depois de reconectar.

Funcionários poderão atuar nos 12 lotes do próprio jogador. Um colhedor não poderá colher lotes de outro setor. Um zelador poderá tratar água e praga apenas nas plantas autorizadas. A movimentação do funcionário será uma entidade sincronizada, mas a tarefa e o resultado econômico deverão continuar sendo calculados no servidor.

## Prédio, porta e circulação

O prédio do balcão deve ter uma porta real no mapa, com entidade e estado authoritative. Abrir, fechar e bloquear a porta precisam produzir o mesmo resultado para todos os jogadores próximos. A colisão do servidor deve usar a mesma abertura que a colisão visual do cliente, evitando que alguém atravesse a parede ou fique preso em uma porta que só abriu localmente.

O interior deve ter pontos de navegação fixos: entrada, fila, seis mesas, área de retirada e saída. Clientes NPC e funcionários devem receber destinos do servidor e usar uma rota que passe pela porta e pelos corredores. O cliente não deve criar compradores, mover funcionários ou concluir atendimento por conta própria.

## Seis mesas de embalagem, cura e secagem

As seis mesas serão estações físicas de processamento. Para não criar um fluxo artificial, cada mesa poderá receber um lote e uma operação por vez. A operação muda de acordo com o estágio do lote: produção recém-colhida entra em **secagem**, depois passa para **cura**, e somente então pode ir para **embalagem**. A embalagem transforma o lote pronto em uma unidade comercializável, caso o pedido exija embalagem.

| Estado do lote | Local esperado | Pode avançar quando |
|---|---|---|
| `colhido` | Entrada/estoque do dono | Há mesa livre e o servidor aceita o enfileiramento |
| `secando` | Uma das 6 mesas | O tempo authoritative de secagem terminou |
| `curando` | Uma das 6 mesas | O tempo authoritative de cura terminou |
| `pronto_para_embalar` | Fila de embalagem | Existe capacidade e a qualidade mínima foi mantida |
| `embalando` | Uma das 6 mesas | A operação foi criada pelo servidor e o tempo terminou |
| `pronto` | Área de retirada/estoque | O servidor confirmou conclusão e persistiu o resultado |

As mesas podem atender qualquer uma das três operações, mas o servidor deve controlar a fila. Se as seis estiverem ocupadas, o pedido deve ficar em `queued`, com posição e previsão aproximada; não deve ser descartado nem duplicado. O cliente pode mostrar a fila, mas a posição authoritative será sempre a resposta do servidor.

Para evitar que um jogador monopolize as seis mesas durante grandes pedidos, a política recomendada é uma fila justa por proprietário: o servidor escolhe o próximo trabalho elegível alternando entre jogadores quando houver filas concorrentes. Essa regra deve ser configurável e testada antes de ser ativada; não deve alterar retroativamente a economia atual.

## Grandes pedidos

Os pedidos devem ser entidades server-side com ID próprio, requisitos, quantidade, qualidade mínima, prazo e recompensa. Um pedido não deve retirar dinheiro ou estoque no momento em que aparece. A reserva ocorre somente quando o jogador aceita e o servidor confirma que há capacidade ou que a produção poderá ser enfileirada.

Para um pedido grande, o servidor divide a quantidade em lotes válidos e associa cada parte ao mesmo `orderId`. Cada unidade processada continua pertencendo ao jogador até a entrega. O pagamento só ocorre quando a quantidade entregue, a genética permitida, o estágio e a qualidade forem conferidos no servidor. O cliente não pode enviar um preço ou quantidade final diferente do que foi registrado.

## Multiplayer e consistência

A fazenda deve usar o mesmo princípio de AOI já aplicado ao restante do jogo. O jogador recebe snapshots dos setores e entidades próximas, além de eventos pontuais para mudanças como porta, lote, mesa, fila, colheita e pedido. Eventos importantes devem ser idempotentes ou acompanhados de um estado completo para que uma reconexão não deixe a interface divergente.

O servidor precisa validar, no mínimo, desbloqueio de nível, existência da entidade, proprietário, distância, estado vivo, capacidade da mesa, quantidade, estágio, tempo, pedido e versão do registro. Operações concorrentes devem ser serializadas por transação ou por uma fila authoritative do servidor. A carteira e o estoque nunca devem ser atualizados por `localStorage` como fonte de verdade.

## Plano de implementação seguro

A implementação deve ser dividida em etapas pequenas. Primeiro, criar o modelo persistente de slots e 12 lotes com uma fixture de seis jogadores. Depois, sincronizar a porta e os caminhos. Em seguida, adicionar as seis mesas com uma máquina de estados de processamento. Só depois devem entrar filas, embalagem e grandes pedidos. Cada etapa precisa de testes de reconexão, posse, concorrência, capacidade cheia, duplicação de mensagens, cliente alheio e reinício do servidor.

Os critérios de aceitação da primeira versão serão objetivos: seis contas conseguem entrar sem receber o mesmo setor; cada conta recupera exatamente 12 lotes após reconectar; um jogador não planta, colhe ou altera lote de outro; seis trabalhos ocupam seis mesas sem duplicação; o sétimo trabalho entra na fila; secagem, cura e embalagem avançam apenas pelos tempos do servidor; pedidos grandes pagam somente após conferência; e uma reinicialização não apaga lotes, mesas, filas, produção ou pedidos ativos.

Essa arquitetura fica registrada para a próxima etapa. Ela não altera os 10 lotes atuais, não desbloqueia a fazenda agora e não modifica preços, crescimento ou economia antes de uma nova implementação autorizada e testada.
