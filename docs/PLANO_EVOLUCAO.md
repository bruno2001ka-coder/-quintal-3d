# Plano de evolução do Quintal 3D

**Objetivo:** evoluir o jogo existente para um mundo aberto multiplayer mais consistente, sem refazer a arquitetura nem retirar sistemas já publicados.

## 1. Diagnóstico atual

O Quintal 3D já possui um cliente HTML monolítico com Three.js r128 e um servidor Node.js com WebSocket `ws`. O servidor é autoritativo para identidade de conta, lotes urbanos, portões, plantas online, crescimento, colheita, estoque, secagem, cura, embalagem, venda, lotes da fazenda, mesas de produção, funcionários, clientes de balcão, rivais, polícia, dano do jogador e territórios. O frontend usa área de interesse e streaming para evitar montar todas as casas ao mesmo tempo.

O que ainda precisa de evolução não deve ser confundido com ausência total do jogo. A base multiplayer existe e há regressões automatizadas para movimento, reconexão, AOI, plantio, crescimento, colheita, casas, fazenda, produção, funcionários, clientes, rivais, territórios, persistência, áudio e interface. As lacunas mais importantes são de integração, autoridade única, observabilidade e conteúdo ainda não implementado.

| Área | Situação verificada | Prioridade |
|---|---|---:|
| Frontend | Funcional, mas ainda concentra mapa visual, controles, fallback e algumas rotinas legadas no mesmo HTML | P1 |
| Backend | Autoritativo para os sistemas publicados; usa uma Machine Fly e estado em memória complementado por SQLite | P0/P1 |
| Multiplayer | WebSocket, heartbeat, AOI, reconexão, IDs e snapshots presentes | P0 |
| Banco/dados | Conta, carteira, lotes urbanos e estado da fazenda persistem; há dependência de sincronização periódica | P0 |
| Gameplay | Plantio, crescimento, colheita, produção, combate e progressão publicados | P1 |
| Mapa | Quintal, corredor, cidade, estrada e fazenda conectados; colisores são descritos separadamente no cliente e no servidor | P1 |
| NPCs | Clientes, funcionários, polícia e rivais têm entidades authoritative; clientes e funcionários ainda precisam de mais comportamento de longo prazo | P1 |
| Veículos | Não há implementação real de veículos no código atual | P2 |
| Inventário | Sementes, estoque, adubos, armas, munição e rack estão presentes; a UI ainda conserva rotinas antigas de apresentação | P1 |
| Economia | Compras, cruzamento, produção, venda, imóveis, lotes e territórios passam pelo servidor | P0/P1 |
| Casas | Dez propriedades com streaming, portões, estações próprias e 16 canteiros | P1 |
| Fazenda | Área pública, seis setores privados, 12 canteiros por jogador e mesas vinculadas ao setor | P1 |
| Produção | Secagem → cura → embalagem → pronto, tanto em casa quanto na fazenda | P1 |
| Territórios | Três pontos rivais ativos, captura authoritative e demanda por ponto | P1 |

## 2. Correções de baixo risco para a primeira iteração

A primeira iteração deve fechar inconsistências sem alterar o visual ou o balanceamento aprovado. O cliente não deve declarar que uma ação foi concluída antes da confirmação do servidor. O placar do menu MUNDO não deve depender de `window.storage`, porque isso não é um estado authoritative do mundo e não está disponível de forma uniforme no GitHub Pages. O servidor deve fornecer uma leitura pública somente de dados agregados do placar, enquanto nome, dinheiro, nível e territórios continuam sendo calculados a partir da carteira server-side.

A ativação de uma conta deve impedir duas mensagens de autenticação simultâneas na mesma conexão. Essa trava evita que `hello`, login e cadastro concorram enquanto a consulta ou criação da conta ainda está aguardando o banco. A correção não muda o protocolo público; somente torna a transição de conexão determinística.

| Alteração | Preservação | Validação necessária |
|---|---|---|
| Endpoint público de placar authoritative e leitura via `fetch` | Mantém o botão MUNDO e a tabela visual | HTTP, login, XSS, reconexão e CI |
| Bloqueio de corrida de autenticação por socket | Mantém login, cadastro e reconexão atuais | Teste P1 e teste de contas |
| Toasts de ações de plantio como solicitação até confirmação | Mantém a ação e não altera o estado local antes do servidor | UI, plantio, rejeição e lote_update |
| Atualização documental de URLs e autoridade | Não altera runtime | Revisão manual e `git diff --check` |

## 3. Próximas iterações, em ordem

Depois da primeira iteração, a prioridade é substituir descrições duplicadas de colisão por uma fonte de dados compartilhada ou gerada, sem mover paredes nem mudar o mapa aprovado. Em seguida, deve-se ampliar a observabilidade com códigos de recusa, IDs de operação e métricas de latência. A cadeia de funcionários pode evoluir para tarefas, diárias e ações server-side internas, sempre reaproveitando os cargos, IDs e custos já existentes.

Os clientes-NPC já são entities do servidor, mas devem receber uma política de fila e saída mais robusta para casas com portão fechado. A economia deve ganhar um ledger ou eventos transacionais quando o volume crescer. Os veículos ficam deliberadamente para uma etapa posterior, pois não há modelo de dados, colisão, posse, entrada/saída ou sincronização existente para ampliar com segurança agora.

## 4. Regra de implementação

Cada grande alteração será feita em pequenos commits, sem apagar o modo online nem reativar saves locais como autoridade. Após cada alteração serão executados, conforme o sistema tocado, testes de multiplayer, movimentação, interação, produção, economia, casas, fazenda, territórios, NPCs, veículos e persistência. A auditoria final deverá comparar o comportamento antes e depois e registrar qualquer regressão em vez de mascará-la.
