# Recomendações de desempenho e escalabilidade — Quintal 3D

## Diagnóstico resumido

O servidor atual é um bom monólito autoritativo para uma instância pequena, mas ainda concentra simulação, WebSocket, persistência e broadcast em um único processo Node.js. O maior risco de desempenho não é apenas o número de entidades, mas o custo combinado de snapshots, busca espacial ingênua, eventos globais e gravações no banco.

> Objetivo recomendado: manter o loop de simulação determinístico, curto e independente de I/O, deixando persistência, métricas e distribuição fora do caminho crítico do tick.

## Prioridade P0 — antes de crescer o número de jogadores

| Prioridade | Melhoria | Motivo no código atual | Implementação recomendada |
|---|---|---|---|
| P0 | Índice espacial para AOI | O snapshot percorre jogadores e entidades para cada jogador; o custo cresce aproximadamente de forma quadrática | Dividir o mapa em células ou usar um quadtree. Registrar jogadores, bots, clientes e funcionários na célula atual e consultar apenas células vizinhas |
| P0 | Separar frequências de simulação | Movimento/combatem exigem alta frequência, enquanto plantas, clientes e economia não precisam do mesmo ritmo | Manter movimento em 20 Hz, combate em 20 Hz, NPCs em 10 Hz, crescimento em 1 Hz e economia diária em evento de virada de dia |
| P0 | Backpressure por conexão | `paraTodos` e snapshots podem acumular dados quando um cliente tem rede lenta | Monitorar `ws.bufferedAmount`, manter somente o snapshot mais recente por cliente, descartar estados intermediários e fechar conexões que excederem um limite |
| P0 | Persistência assíncrona em lote | Gravar cada carteira individualmente no PostgreSQL aumenta latência e pressão no banco | Manter uma fila de carteiras/lotes sujos, agrupar gravações em intervalos curtos e usar transação ou upsert em lote fora do tick |
| P0 | Métricas de loop | Sem medir atraso do event loop e duração do tick, não é possível saber quando o servidor está degradando | Registrar duração do tick, atraso do event loop, entidades simuladas, bytes por snapshot, mensagens rejeitadas e latência do banco |

## Índice espacial e snapshots

A principal otimização estrutural é substituir os loops completos por consultas espaciais. Cada entidade deve possuir uma célula calculada a partir de sua posição. Para cada jogador, o snapshot consulta apenas a própria célula e as células que intersectam `AOI_RAIO`. O mesmo índice pode acelerar colisão, seleção de bots, clientes-NPC e linha de visão em mapas maiores.

Os snapshots também devem deixar de repetir todos os campos a cada ciclo. Uma abordagem gradual é usar snapshots completos na entrada e depois enviar apenas deltas com número de sequência, campos alterados e confirmação do último snapshot recebido. Posições podem ser quantizadas em centímetros e ângulos em inteiros pequenos. Quando o tráfego se tornar dominante, migrar de JSON para MessagePack ou outro protocolo binário reduz tamanho e custo de serialização.

Eventos atualmente globais, como tiros, mortes e alterações de portão, devem ser enviados somente às conexões que tenham a entidade dentro do interesse visual. Mensagens administrativas, métricas e erros devem permanecer fora do broadcast do mundo.

## Tick e uso do event loop

O loop de 20 Hz não deve executar consultas SQL, chamadas de rede, serializações pesadas ou operações que possam bloquear. A simulação deve produzir eventos e marcar estado sujo; um trabalhador de persistência grava esses dados separadamente. Também é preferível usar um agendador único com relógio monotônico e compensação de atraso, em vez de vários `setInterval` que podem se sobrepor durante pausas do event loop.

Para evitar tempestades de trabalho, cada tipo de sistema deve possuir orçamento próprio. Se o número de NPCs crescer, processar uma fração deles por tick, mantendo o prazo máximo de atualização de cada entidade. A IA de clientes e funcionários pode usar máquinas de estado simples e caminhos recalculados somente quando o destino mudar.

## Persistência e banco

O SQLite é adequado para desenvolvimento e para uma única instância com disco persistente, mas não deve ser tratado como solução de alta disponibilidade. Em produção distribuída, use PostgreSQL gerenciado com pool limitado, índices em `usuarios.chave`, `lotes.idx` e campos usados em consultas de recuperação.

A fila de persistência deve ser resiliente: coalescer várias alterações da mesma carteira, confirmar somente após sucesso, aplicar retry com backoff e executar flush no desligamento. O servidor deve expor uma condição de prontidão que só fique verde depois da conexão com o banco e da carga do mundo. Em múltiplas instâncias, a persistência precisa de transações e controle de concorrência para impedir que duas autoridades sobrescrevam o mesmo lote.

O estado crítico do mundo deve ter versão ou revisão. Cada atualização pode carregar `worldVersion`; gravações condicionais rejeitam uma revisão antiga. Para ações como comprar, vender, capturar território e colher, use identificadores de operação idempotentes ou números de sequência por sessão, evitando duplicação quando o cliente repetir uma mensagem após timeout.

## Escala horizontal

Não é seguro simplesmente iniciar várias cópias do processo atual atrás de um load balancer, porque jogadores, bots, clientes, funcionários e lotes vivem na memória local. A arquitetura recomendada é escolher uma autoridade por shard ou zona do mundo. Cada conexão deve ser roteada para a autoridade da zona correspondente, enquanto um barramento Redis Pub/Sub, NATS ou serviço equivalente distribui eventos entre zonas.

Uma alternativa de transição é manter uma única autoridade de simulação e escalar apenas gateways WebSocket, mas isso exige que o gateway encaminhe mensagens para a autoridade e não mantenha estado de jogo próprio. Sticky sessions podem ajudar na conexão, mas não substituem uma autoridade única nem um mecanismo de recuperação.

## Cluster e workers

O processo Node.js principal deve cuidar de rede e coordenação do tick. IA pesada, geração de caminhos, compressão de snapshots e tarefas analíticas podem ir para `worker_threads` ou processos separados. Não use `cluster` como solução isolada enquanto o estado continuar somente em memória; vários workers podem produzir mundos divergentes.

Para disponibilidade, use um supervisor ou plataforma que reinicie o processo, health checks, encerramento gracioso e limite de memória. O endpoint de prontidão deve retornar falha enquanto o banco ou o mundo ainda estiver carregando; o endpoint de saúde deve informar apenas se o processo está vivo.

## Rede e protocolo

Mantenha `maxPayload`, rate limit, heartbeat e limite de conexões. Acrescente limite por tipo de ação, especialmente tiro, compra, venda, crime e mensagens de posição. O proxy deve terminar TLS e encaminhar somente WebSocket seguro (`wss`).

O protocolo deve ter versão explícita, tamanho máximo por campo e mensagens com identificador de operação. Mensagens desconhecidas devem ser rejeitadas sem gerar exceção. Para clientes lentos, a política deve preferir descartar snapshots antigos a bloquear o loop.

## Observabilidade e operação

Recomendo expor métricas Prometheus ou OpenTelemetry com pelo menos:

| Métrica | Alerta sugerido |
|---|---|
| Duração do tick e atraso do event loop | Tick acima do orçamento por vários intervalos |
| Jogadores conectados e entidades ativas | Crescimento próximo do limite operacional |
| Bytes enviados por segundo e `bufferedAmount` | Conexões acumulando fila |
| Mensagens rejeitadas por tipo e por sessão | Aumento anormal ou possível abuso |
| Latência e erros de PostgreSQL | P95 crescente ou falhas consecutivas |
| Tempo de recuperação e flush de persistência | Desligamento sem gravação completa |
| Uso de heap, RSS e quantidade de timers | Crescimento contínuo ou proximidade do limite |

Inclua `requestId` ou `sessionId` nos logs, sem registrar tokens de sessão, segredos, dados pessoais ou payloads completos de usuários. Os logs devem permitir reconstruir uma compra, venda, dano ou captura pelo identificador da operação.

## Plano de evolução recomendado

| Fase | Entrega |
|---|---|
| 1 | Métricas do event loop, orçamento de tick, backpressure e fila de persistência |
| 2 | Grid espacial para AOI e eventos; snapshots delta |
| 3 | Teste de carga com conexões WebSocket, movimento, tiros e vendas simultâneas |
| 4 | PostgreSQL gerenciado, transações, versões de mundo e idempotência |
| 5 | Gateway separado e autoridade por shard/zona |
| 6 | Workers para IA/compressão, failover e testes de recuperação |

## Critério prático de aceitação

Antes de aumentar o limite de conexões, execute um teste de carga reproduzível com o mesmo mix de ações do jogo. O servidor deve manter o tick dentro do orçamento definido, não acumular `bufferedAmount`, não perder operações confirmadas e conseguir gravar o estado após encerramento controlado. Os limites devem ser determinados pelos resultados medidos, não por um número fixo de jogadores.
