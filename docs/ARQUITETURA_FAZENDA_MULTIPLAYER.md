# Arquitetura implementada da Fazenda Multiplayer

## Objetivo

A Fazenda Multiplayer do **Quintal 3D** é liberada pelo servidor quando a conta está no **nível 10** e possui o imóvel `fazenda`. Ela não usa canteiros compartilhados sem dono. Cada uma das seis posições persistentes recebe uma área privada com **12 canteiros**, totalizando **72 canteiros** na capacidade máxima da fazenda.

O galpão de processamento é coletivo. Ele tem uma abertura frontal fixa de **3,2 m**, circulação interna e seis mesas físicas organizadas em duas filas de três. O servidor decide posse, distância, fila, tempo, estágio, estoque e persistência; o cliente apenas envia solicitações e desenha as respostas.

> Regra central: o cliente não cria economia, crescimento, processamento, plantio, colheita ou posse localmente. O estado authoritative vem do servidor por snapshots e eventos WebSocket.

## Organização espacial

Os setores são identificados por `farmSlot` de `0` a `5`. As coordenadas centrais são `(-30,194)`, `(0,194)`, `(30,194)`, `(-30,230)`, `(0,230)` e `(30,230)`. Cada setor mede 24 m por 28 m no visual, possui 12 canteiros em uma grade de três colunas por quatro linhas e tem uma porteira própria na face sul.

| Camada | Quantidade | Regra authoritative |
|---|---:|---|
| Fazenda multiplayer | 1 | Área compartilhada, perímetro, caminhos e galpão |
| Proprietários de setores | Até 6 persistentes | Associação entre `ownerKey` e `farmSlot` |
| Canteiros por proprietário | 12 | Plantio, irrigação, crescimento, colheita e posse |
| Canteiros totais | 72 | Limite físico para seis setores |
| Mesas do galpão | 6 | Um job ativo por mesa e fila limitada |
| Fila por mesa | Até 4 aguardando | Jobs adicionais são recusados quando a capacidade acaba |

O perímetro da fazenda fica entre `x=-46..46` e `z=172..268`. A entrada externa tem uma abertura central de 10 m. Contas sem setor autorizado não atravessam essa abertura. Depois da entrada, cada divisória e cada porteira de setor é validada pelo servidor; uma conta não pode ocupar ou alterar o setor de outro proprietário.

## Persistência e alocação

A associação entre conta e setor usa a chave persistente da conta, nunca o ID temporário do WebSocket. Se o jogador desconectar, reconectar ou trocar de aparelho, o servidor recupera o mesmo setor e os mesmos 12 IDs de canteiro. Quando os seis setores já estão ocupados, a sétima conta continua podendo autenticar na cidade, mas não recebe um setor da fazenda.

A implementação atual adiciona duas tabelas ao SQLite ou ao PostgreSQL existente sem substituir os dez lotes urbanos legados. Os canteiros ficam serializados dentro do registro do setor porque sua posição é determinística; jobs ficam em registros próprios para permitir retomada depois de reinício.

```text
farm_slots
  slot_index PRIMARY KEY, owner_key UNIQUE, owner_name,
  plots JSON, unlocked_at, updated_at

farm_jobs
  job_id PRIMARY KEY, owner_key, station_id, operation,
  stock_id, quantity, started_at, completes_at, status, source_json
```

O SQLite salva o snapshot de jobs em uma transação. No PostgreSQL, o salvamento usa uma conexão dedicada, transação e uma fila de gravação para que uma sequência de `DELETE` e `INSERT` não se sobreponha a outro tick ou evento.

## Canteiros privados

Cada canteiro possui um ID determinístico do servidor no formato `farm_<slotIndex>_<localIndex>`, preservado durante a persistência. O cliente recebe a posição e o estado da planta, mas não escolhe o setor, não troca o proprietário e não consegue usar o ID de outro setor para plantar ou colher.

O fluxo de plantio é validado em quatro dimensões: conta viva e autenticada, setor próprio, distância máxima do canteiro e semente existente no banco do jogador. A genética é limpa pelo catálogo authoritative antes da criação da planta. Crescimento, água, saúde, praga, estágio e colheita são calculados no servidor. A colheita gera estoque associado ao mesmo `ownerKey` e envia um novo estado para o cliente.

A mesma política vale para irrigação e colheita. Uma tentativa em canteiro alheio gera recusa sem alterar a interface authoritative, o estoque ou a planta do proprietário. Funcionários continuam sendo entidades do servidor; nesta expansão, a fazenda não adiciona uma economia paralela nem permite que o cliente conclua uma tarefa de funcionário.

## Galpão, entrada e circulação

O galpão está centralizado em `(0,252)`, mede 26 m por 12 m e tem paredes laterais, fundo e frente dividida por um vão central de 3,2 m. As seis mesas ficam **dentro** do volume do galpão, nas posições relativas `(-8,-2)`, `(0,-2)`, `(8,-2)`, `(-8,2)`, `(0,2)` e `(8,2)`.

A colisão visual do cliente e a colisão authoritative do servidor usam a mesma geometria: laterais, fundo e trechos da frente bloqueiam a passagem, enquanto o vão central permite a entrada. O jogador não pode entrar pela lateral, pelo fundo ou atravessar a frente fora da porta. Para iniciar um job, além de ter o setor, ele precisa estar dentro do galpão e a até 3,4 m da mesa escolhida.

A porteira externa e as porteiras dos setores também têm colisores. O cliente exibe a animação e os indicadores, mas a permissão efetiva é do servidor. Isso impede que um cliente modificado atravesse uma cerca ou abra localmente um setor privado.

## Seis mesas e processamento

Cada mesa executa um lote por vez. O servidor permite até quatro jobs aguardando na fila da estação. O cliente mostra a placa, a luz e a caixa física da mesa em uma destas condições: `LIVRE`, operação em andamento ou quantidade aguardando na fila. Esses indicadores são atualizados por `farm_tables`; não existe cronômetro local capaz de concluir um job.

| Entrada no estoque | Operação aceita | Resultado authoritative |
|---|---|---|
| `sec` | `secagem` | `cura` |
| `cura` | `cura` | `embalagem` |
| `embalagem` | `embalagem` | `pronto` |

Ao entrar na fila, o lote é removido do estoque para evitar duplicação. O job guarda a genética e a qualidade de origem. Na conclusão, o servidor verifica a carteira e a capacidade do rack, restaura o lote no estágio seguinte, envia `farm_job_ok` e persiste o snapshot. Se o rack estiver cheio, a conclusão é adiada e o job não é perdido.

Os tempos padrão são **55 segundos** para secagem, **70 segundos** para cura e **35 segundos** para embalagem. As fixtures locais podem reduzir esses valores com variáveis de ambiente; a configuração de produção não é alterada por isso.

## Integração do cliente

Ao conectar, o cliente cria uma representação única para cada setor e materializa os canteiros quando recebe `welcome`, `estado` ou `snap`. As plantas são desenhadas a partir de `farm_plot_update` e `farm_plots_update`. O visual legado `fazPlots`, usado pelo modo antigo, é ocultado enquanto o WebSocket está online para não duplicar os 72 canteiros nem simular crescimento local.

Ao aproximar-se de uma mesa, o foco apresenta a estação e abre a aba **GALPÃO**. Os botões enviam somente `stationId`, `operation` e `stockId` dentro de `farm_job`. Ao aproximar-se de um canteiro, o prompt diferencia setor próprio, setor de outro jogador, plantio, irrigação e colheita. Uma recusa do servidor não concede posse nem altera o estoque visual.

## Verificação automatizada

A fixture `testes/test-fazenda-multiplayer.js` cria um SQLite descartável e passa `DATABASE_URL` vazio explicitamente ao processo filho. Ela verifica seis contas com setores distintos, 12 canteiros por jogador, bloqueio da sétima conta, entrada pelo portão, entrada pela porta frontal do galpão, as três etapas de processamento e recusa de plantio em canteiro alheio.

A regressão `testes/test-regressao-client-ui.js` verifica a presença dos contratos visuais e de interação no HTML. O workflow de CI executa o check de sintaxe, a regressão da fazenda e as regressões anteriores. Nenhum teste produtivo usa o banco real da hospedagem.

## Limites desta entrega

Esta expansão não altera preços, catálogo, genética existente, lotes urbanos, casa inicial ou economia de negócios. Pedidos grandes, divisão por `orderId` e uma política de fila justa entre proprietários permanecem fora desta entrega. Eles devem ser implementados como uma etapa separada, com novas fixtures de concorrência, reinício e rollback.
