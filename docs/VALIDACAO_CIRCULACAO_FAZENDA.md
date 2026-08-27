# Validação da circulação da fazenda e dos funcionários

## Regra de circulação

A área geral da fazenda é pública para qualquer jogador autenticado, inclusive para contas que ainda não compraram uma fazenda. O portão externo central não é uma barreira de compra: ele apenas delimita visualmente a entrada e continua protegido por colisores laterais, sem permitir atravessamento pela cerca.

Cada um dos seis setores possui uma porteira privada. A porteira começa fechada e somente o proprietário pode alternar seu estado por uma mensagem `portao` associada à entidade authoritative da porteira. Quando fechada, ela bloqueia a entrada de outros jogadores; quando aberta, qualquer jogador pode atravessar o vão, como nos portões das casas. Um jogador que já esteja dentro do setor consegue sair mesmo se a porteira for fechada depois, evitando prisão por becos sem saída.

A proteção dos 12 canteiros não depende do cliente. O servidor continua validando dono, distância, plantio, rega e colheita; abrir uma porteira não concede posse nem autorização econômica sobre os canteiros de outro jogador.

## Funcionários

O `caseiro` agora usa como área de trabalho o setor da fazenda pertencente ao dono. Ao restaurar uma contratação antiga, o servidor reposiciona o funcionário dentro do setor correto quando necessário. A tarefa de rega e remoção de praga altera o canteiro no servidor, envia `farm_plots_update` aos clientes da área, envia um novo estado ao proprietário e persiste a mudança.

O `zelador` e a `colhedora` continuam vinculados aos canteiros do lote urbano, preservando a divisão de responsabilidades já apresentada na interface. O cliente apenas interpola posição e animação com base em `x`, `z`, `ry` e `estado` recebidos do servidor; ele não decide a tarefa, o alvo, a quantidade colhida ou a persistência.

## Teste executado

A fixture usa SQLite temporário, sem banco do Render e sem credenciais reais. A regressão cobre uma conta sem setor caminhando no pátio e no galpão públicos, a tentativa de entrar em setor fechado, a abertura pelo proprietário, a travessia após a abertura, a saída dos seis setores e o trabalho authoritative do caseiro em um canteiro da fazenda.

O resultado esperado é `FARM_MULTIPLAYER_OK` com os campos `fazendaPublica`, `setoresPrivados`, `porteirasAuthoritative` e `caseiroAuthoritative` verdadeiros.

> A regra server-authoritative continua sendo a fonte única de verdade. A colisão e a UI no cliente espelham o estado, mas não substituem as validações do servidor.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `servidor-1.js` | Estado, persistência, entidades, colisão, porteiras e tarefas dos funcionários |
| `public/index.html` | Visual, foco da interação, colisão preditiva e interpolação dos funcionários |
| `testes/test-fazenda-multiplayer.js` | Fixture multiplayer da fazenda, portas privadas e caseiro |
| `testes/test-regressao-client-ui.js` | Asserts estáticos de geometria, interação e sincronização visual |

## Data

2026-08-27

Autor: **Manus AI**

