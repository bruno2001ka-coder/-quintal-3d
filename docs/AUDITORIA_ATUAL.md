# Auditoria atual do Quintal 3D

**Escopo:** repositório `bruno2001ka-coder/-quintal-3d`, branch `main`, cliente em `public/index.html`, backend em `servidor-1.js`, scripts em `testes/` e workflows em `.github/workflows/`. A auditoria foi feita sobre o código atual, não sobre uma versão antiga do projeto.

## Resumo executivo

O projeto já é um jogo multiplayer online funcional em sua base principal. O servidor decide identidade, posição, colisão, lotes, plantas, crescimento, colheita, estoque, produção, venda, imóveis, territórios, fazenda, funcionários, clientes de balcão, rivais, polícia, dano e respawn. O cliente mantém a apresentação 3D, predição visual, câmera, HUD, menus e interpolação.

A auditoria encontrou mais riscos de manutenção e integração do que uma necessidade de reescrever o jogo. Nesta iteração foram corrigidos três pontos sem alterar o mapa ou o tamanho visual das plantas: a corrida entre autenticações na mesma conexão, o placar baseado em armazenamento compartilhado do navegador e a indicação prematura de que o plantio já havia terminado. Também foi criada uma regressão dinâmica específica do placar.

## Matriz dos sistemas

| Sistema | Implementação atual | Resultado da auditoria |
|---|---|---|
| Frontend | HTML único, CSS, JavaScript e Three.js r128 | Existe e está coberto por verificação de sintaxe e regressão de UI. A concentração do código aumenta o custo de manutenção, mas não justifica reescrita imediata. |
| Backend | Node.js, HTTP estático próprio e WebSocket `ws` | Existe e é autoritativo para os sistemas publicados. |
| Multiplayer | Heartbeat, rate limit, AOI, snapshots, reconexão, IDs de entidade e confirmação de ações | Validado por testes locais de AOI, movimento, reconexão, carga e proteção de entidades. |
| Banco/dados | SQLite persistente no Fly, com caminho para Postgres; carteiras e lotes salvos | Persistência de conta, posição, plantas urbanas, fazenda e produção possui testes de reinício. O backend atual depende de uma Machine única para o estado em memória. |
| Gameplay | Plantio, água, praga, crescimento, colheita, secagem, cura, embalagem, venda, progressão e combate | Implementado server-side no modo online. O sandbox é apenas fallback explícito. |
| Mapa | Fundos, corredor, cidade, estrada e fazenda | Conectividade e portas foram validadas. Cliente e servidor ainda mantêm descrições de colisão duplicadas. |
| NPCs | Clientes de balcão, funcionários, rivais e polícia | Entidades online possuem IDs e são distribuídas por AOI. Funcionários e clientes ainda podem receber melhorias de IA, filas e tarefas, mas não são duplicados por uma segunda população online. |
| Veículos | Nenhum modelo, entidade, posse, entrada/saída ou sincronização encontrada | Lacuna real. Deve ser uma etapa futura, não um remendo visual. |
| Inventário | Sementes, estoque, adubos, armas, munição, colete e rack | Regras de compra, colheita, produção e venda passam pelo servidor. Há código legado local somente no sandbox e na apresentação. |
| Economia | Compras, cruzamento, venda, imóveis, territórios, diárias e lotes de fazenda | Regras principais estão no servidor. O placar agora consulta o servidor em vez de aceitar dados de `window.storage`. |
| Casas | Dez lotes, streaming, portões, três estações e dezesseis plots por casa | Implementado, com testes de casas, estações, AOI e venda por cliente próprio. |
| Fazenda | Área pública, seis setores, doze canteiros por jogador e seis mesas vinculadas | Implementado e validado com entrada, saída, porteiras, plantio, caseiro e produção. |
| Produção | Secagem → cura → embalagem → pronto em casa e na fazenda | Implementado e coberto por testes dinâmicos e de persistência. |
| Territórios | Três pontos rivais ativos e captura authoritative | Implementado. A UI foi corrigida para comparar a posse com a chave persistente entregue pelo servidor, não com o ID temporário da sessão. |

## Achados priorizados

### P0 — integridade do estado online

O jogo usa uma Machine única no Fly porque parte do estado vivo, como jogadores, entidades e territórios, fica em memória e é complementada pelo SQLite no volume. Escalar horizontalmente sem extrair esse estado causaria divergência entre instâncias. A decisão atual é tecnicamente coerente, mas precisa permanecer explícita na operação.

As operações de compra, plantio, crescimento, colheita, produção, venda, imóveis, fazenda e territórios já passam por validação server-side. A suíte local confirmou que payloads de catálogo forjado, entidades alheias, clientes de outro lote e operações fora das mesas são recusados.

A autenticação tinha uma janela de corrida: depois de iniciar uma consulta de login ou cadastro, a mesma conexão ainda podia receber outra tentativa antes de a primeira terminar. O campo `j.autenticando` agora fecha essa transição até a operação acabar, sem mudar o protocolo de login.

### P1 — autoridade e manutenção

O placar antigo usava `window.storage`, que não é a carteira do servidor, não existe de modo uniforme no GitHub Pages e permitia que o navegador publicasse saldo, nível e territórios inventados. O menu MUNDO agora envia `placar` pelo WebSocket; o servidor consulta as carteiras e devolve apenas nome, saldo, nível e quantidade de territórios. A chave persistente não é exposta.

As colisões do mundo são descritas em duas linguagens: `COL_ESTATICOS` e `COL_LOTE_REL` no servidor e `colliders`/geometrias no cliente. O comportamento atual está coberto, mas uma alteração futura de parede ou porta pode divergir. A evolução recomendada é gerar os dois lados a partir de uma descrição compartilhada, sem mudar as coordenadas aprovadas.

O cliente ainda aceita alguns caminhos legados por índice para regar e colher, embora aplique a propriedade do lote e a distância. O caminho moderno por ID já é usado pelas entidades novas. A remoção do legado deve acontecer apenas depois de confirmar que todas as versões publicadas do cliente não o utilizam mais.

O servidor persiste periodicamente e no fechamento. No modo SQLite usado pelo Fly, as gravações são síncronas e testadas. No caminho Postgres, as rotinas de salvamento assíncronas merecem uma etapa própria para aguardar todas as promessas antes do encerramento do processo.

### P2 — conteúdo ainda ausente

Não existe veículo real no projeto. Para incluir veículos sem refazer o jogo, a próxima etapa deve definir primeiro o contrato server-side: catálogo, propriedade, posição, ocupantes, colisão, velocidade, entrada/saída, combustível ou regra equivalente, dano e AOI. Só depois deve ser criado o visual no cliente e o teste multiplayer correspondente.

Funcionários e clientes-NPC já são compartilhados, mas a evolução natural é ampliar a máquina de estados, a fila por casa, o caminho de saída quando o portão fecha e as tarefas de longo prazo. Isso deve reutilizar as entidades e IDs existentes, não criar cópias locais quando o multiplayer estiver conectado.

## Cobertura verificada

A suíte local foi executada com servidores isolados, bancos temporários e portas separadas. Os resultados observados foram positivos para HTTP e segurança, P0/P1, AOI, login, carga de 24 jogadores, reconexão, clientes de casa, plantio, crescimento, proteção de entidades, movimento, estufas, mapa, áudio, spawn, UI, módulos de negócios, fazenda, persistência urbana, persistência da fazenda, catálogo de oito genéticas, sandbox, colheita e configuração do Render. O novo teste do placar também passou com duas carteiras e sem exposição de chave.

| Evidência | Resultado |
|---|---|
| Sintaxe do servidor | `node --check servidor-1.js` passou |
| Sintaxe e extração do cliente | `node check-client-syntax.js` passou |
| Interface e integrações estáticas | `CLIENT_UI_REGRESSION_OK` |
| Segurança | `SECURITY_INTEGRATION_OK` |
| Multiplayer e AOI | `MULTIPLAYER_AOI_OK` |
| Movimento e reconexão | `MOVIMENTO_FLUIDO_OK` e `RECONNECTION_POSITION_OK` |
| Crescimento | `GROWTH_REGRESSION_OK` |
| Casas e produção | `MODULOS_NEGOCIOS_OK` e `FARM_MULTIPLAYER_OK` |
| Persistência | `PERSISTENCE_RESTART_OK` e `FARM_PERSISTENCE_OK` |
| Novo placar | `SCORE_AUTHORITATIVE_OK` |

Esses resultados são validações locais. Eles não substituem a confirmação posterior do HTML no GitHub Pages e da versão efetivamente executada no Fly.
