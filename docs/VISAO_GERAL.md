# Quintal 3D — Visão geral do jogo

## 1. Identidade do projeto

**Nome:** Quintal 3D
**Tipo:** jogo browser 3D, multiplayer online, mundo aberto por áreas
**Gênero:** simulação de propriedade e cultivo, economia, exploração urbana e ação PvE
**Idioma da interface:** português brasileiro
**Cliente visual:** HTML, CSS, JavaScript e Three.js r128
**Servidor:** Node.js com WebSocket (`ws`)
**Estado oficial:** servidor authoritative, isto é, o servidor decide posição válida, carteira, plantas, clientes, funcionários, portões, territórios, combate e progressão.

> **Regra principal do produto:** Quintal 3D é um mundo aberto multiplayer online. Sem conexão com o servidor, o cliente não deve inventar carteira, plantar, vender ou conceder progresso. O fallback de conexão serve apenas para mostrar uma mensagem clara de “sem conexão” e permitir tentar novamente.

O jogador entra em um mundo compartilhado que combina três espaços principais: o quintal e a casa própria, a cidade com comércio, pontos e rivais, e a estrada que leva à fazenda e a canteiros desbloqueáveis. A meta é construir uma operação de cultivo, melhorar genética e estrutura, atender clientes, vender produção, capturar pontos e evoluir sem depender de estado enviado pelo navegador.

## 2. O que o jogador faz

O ciclo principal é simples:

| Etapa | O jogador faz | Quem confirma |
|---|---|---|
| Entrar | Conecta, recebe uma identidade de sessão e um lote, e carrega a carteira persistida | Servidor |
| Preparar | Compra sementes, melhorias, adubo, armas e colete na bancada | Servidor |
| Plantar | Escolhe uma semente e planta em um dos plots do próprio lote | Servidor |
| Cuidar | Regar, tratar praga e esperar crescimento | Servidor; cliente apenas mostra o progresso |
| Colher | Colhe a planta pronta e transforma o resultado em lote de estoque | Servidor |
| Processar | Seca e cura em uma bancada válida do próprio lote | Servidor mede o tempo |
| Vender | Atende clientes da própria casa ou abastece pontos capturados | Servidor calcula preço e credita dinheiro |
| Evoluir | Compra imóveis, upgrades, funcionários e territórios | Servidor |
| Explorar | Anda pela cidade, estrada e fazenda, enfrenta rivais e polícia | Movimento e dano server-side |

O jogo não trata o navegador como uma fonte confiável. O cliente pode prever visualmente movimento e desenhar animações, mas uma tentativa de modificar JSON, dinheiro, genética, posição ou dano não deve produzir vantagem válida.

## 3. Mundo e mapa

O mundo foi organizado para ligar os pontos em uma rota contínua:

```text
FUNDOS DO QUINTAL → CORREDOR → CIDADE → ESTRADA → FAZENDA
```

As principais regiões são:

| Região | Função |
|---|---|
| Fundos do quintal | Casa, portão, estufa, grow room, bancada de sementes e primeiros plots |
| Corredor | Passagem protegida entre a casa e a cidade |
| Cidade | Banca, clientes, imóveis, ruas, rivais e territórios |
| Estrada | Conexão visual e física para a parte distante do mapa |
| Fazenda | Área desbloqueável com canteiros adicionais e funcionário caseiro |

No celular, o botão **MAPA** abre o mapa completo. Ele mostra fundos, cidade, estrada, fazenda, dez lotes, seu lote, objetivo, jogadores, polícia, rivais e a legenda de cores. O radar compacto continua sendo uma ferramenta de desktop; no touch, o painel de mapa é a referência principal.

## 4. Multiplayer e servidor authoritative

### 4.1 Conexão

O cliente usa a URL configurada em `public/index.html`:

```text
wss://quintal-3d.onrender.com
```

Quando o cliente é servido pelo Render, ele troca automaticamente por WebSocket same-origin; o endereço acima permanece como fallback para o GitHub Pages. O protocolo começa com `hello`. O cliente envia nome, avatar, token de sessão, identificação do aparelho e semente inicial visual. O servidor responde com:

1. `sessao`, contendo token HMAC e chave persistente da carteira;
2. `lote_atribuido`, contendo lote, posição de nascimento e portão;
3. `estado`, contendo carteira, sementes, estoque, melhorias, imóveis, funcionários, territórios, vida, armadura, munição e progressão;
4. snapshots `snap`, filtrados pela área de interesse.

O token de sessão prova a posse da identidade persistente durante reconexões. A chave do aparelho é usada apenas para reconhecer o fundador configurado no ambiente; não é enviada para outros jogadores.

### 4.2 Movimento

O cliente usa previsão visual para não parecer congelado enquanto espera a rede. Ele envia aproximadamente dez mensagens por segundo com posição prevista, rotação, sequência de input, arma e intenção de salto.

O servidor valida:

- sequência para impedir correções antigas de puxarem o jogador para trás;
- velocidade horizontal máxima;
- colisão com paredes, lotes, portões e estruturas;
- altura, gravidade, chão e salto no servidor;
- estado morto e respawn;
- posição retomada apenas dentro da janela de reconexão.

Uma correção server-side possui `seq`, `x`, `y` e `z`. O cliente deve aceitar a correção somente quando ela corresponder a uma sequência válida e não deve congelar o controle por causa de uma correção pequena.

### 4.3 Área de interesse

O servidor mantém uma área de interesse de aproximadamente 70 metros. Cada jogador recebe apenas jogadores, bots, funcionários, clientes e lotes próximos. Isso evita enviar todas as plantas privadas do mundo para todos os clientes.

O servidor também mantém grades espaciais para acelerar consultas de jogadores e entidades. O snapshot contém entidades próximas; eventos de venda, dano, morte, crescimento e portão são entregues a quem deve observá-los.

### 4.4 Mensagens principais

| Mensagem | Direção | Uso |
|---|---|---|
| `hello` | Cliente → servidor | Iniciar ou retomar sessão |
| `sessao` | Servidor → cliente | Entregar token de sessão |
| `lote_atribuido` | Servidor → cliente | Informar lote e spawn authoritative |
| `estado` | Servidor → cliente | Sincronizar carteira e progressão |
| `input` | Cliente → servidor | Posição prevista, rotação e intenção de salto |
| `snap` | Servidor → cliente | Jogadores, bots, clientes, funcionários e lotes próximos |
| `correcao` | Servidor → cliente | Corrigir movimento inválido |
| `plantar` | Cliente → servidor | Plantar em um plot do próprio lote |
| `regar` / `colher` | Cliente → servidor | Cuidar ou colher entidade autorizada |
| `lote_estagio` | Cliente → servidor | Pedir avanço de secagem/cura |
| `vender` | Cliente → servidor | Vender estoque a cliente ou ponto |
| `comprar` | Cliente → servidor | Comprar semente, upgrade, adubo, arma ou colete |
| `adubo` | Cliente → servidor | Aplicar adubo no plot próprio; o servidor valida distância, estoque e estágio |
| `portao` | Cliente → servidor | Alternar portão de entidade própria |
| `crime` | Cliente → servidor | Informar intenção de crime e criar procurado |
| `tiro_bot` | Cliente → servidor | Informar tiro contra bot; dano é decidido no servidor |
| `recusado` | Servidor → cliente | Negar ação inválida com motivo claro |

## 5. Plantas e genética

### 5.1 Catálogo base

O servidor possui um catálogo fechado de sementes base. Cada entrada tem nome, cor, geração, tipo auto ou fotoperiódico e cinco traços:

- ritmo;
- rendimento;
- resistência;
- aroma;
- brilho.

A compra aceita somente uma semente que coincida com a entrada do catálogo server-side. Nome, cor, geração, tipo e todos os traços são comparados; uma genética inventada por um cliente modificado é recusada.

### 5.2 Cruzamento

O jogador escolhe duas sementes que realmente existem na própria carteira. O servidor verifica posse, quantidade e dinheiro. Depois calcula o filho com média dos traços, mutações limitadas, geração incrementada e raridade server-side.

O cliente pode exibir uma prévia, mas a linhagem válida é a que vem na resposta do servidor. O cliente não pode escolher o filho final, a raridade, o preço ou a quantidade.

### 5.3 Plantio e crescimento

Cada lote possui 16 plots. A planta server-side guarda, entre outros campos:

```text
id, semente, progresso, água, saúde, praga, estágio, adubOrg, adubCres, adubFlor, loteIndex, plotIndex
```

O crescimento acontece em intervalos do servidor. O cliente recebe updates contínuos ou por mudança relevante e apenas desenha a planta. O estágio oficial não depende do relógio local do navegador.

O fluxo de estágio é:

```text
semente → broto → jovem → adulta → pronta
```

Somente o dono do lote pode plantar, regar ou colher um plot, e a distância até o plot também é validada. Ao colher, a planta é removida do plot e o servidor cria um lote de estoque com quantidade, qualidade, genética, estágio de secagem e horário inicial.

## 6. Economia e catálogo server-side

O dinheiro inicial, preços, custos, munição, upgrades, imóveis, adubos e armas são decididos no servidor. O navegador recebe `estado` e desenha o resultado.

Os catálogos principais são:

| Catálogo | Conteúdo |
|---|---|
| `CAT_UPG` | vasos, LED, irrigação, rack e automação |
| `CAT_IMOVEIS` | Casa Nova, blocos do condomínio e fazenda |
| `CAT_ADUBO` | orgânico, crescimento e floração |
| `CAT_ARMA` | pistola, SMG e rifle, além de punho |
| `CAT_MUNICAO` | pacotes de munição por arma |
| `CAT_FUNC` | zelador, colhedor e caseiro |
| `CATALOGO_SEMENTES` | sementes base que podem ser compradas |

Os catálogos devem ser tratados como mapas sem protótipo ou validados com `Object.hasOwn()`. Chaves como `toString`, `constructor` e `__proto__` nunca podem ser consideradas itens válidos.

A venda valida:

1. existência do lote de estoque;
2. estágio `pronto`;
3. quantidade disponível;
4. local de venda;
5. cliente pertencente ao jogador ou ponto capturado;
6. demanda, qualidade, traços e raridade.

O cliente só muda a interface depois de receber `venda_ok` e o novo `estado`.

## 7. Clientes, funcionários e territórios

### 7.1 Clientes do balcão

Clientes são entidades criadas pelo servidor e vinculadas a um `loteIndex`. Cada propriedade pode receber seus próprios clientes. Um jogador só pode vender ao cliente de sua casa; não pode usar o comprador de outra propriedade para ganhar dinheiro.

O fluxo do cliente é:

```text
entrando → esperando → atendendo → saindo
```

Depois da venda, o servidor cria uma rota de saída explícita até o portão, em vez de reaproveitar a rota de entrada. Se o portão estiver fechado, a saída deve esperar de maneira controlada e não criar um cliente preso na bancada.

### 7.2 Funcionários

Funcionários são entidades server-side com ID, cargo, dono, lote, posição, estado e tarefa. O cliente apenas desenha o funcionário recebido por snapshot.

Os cargos são:

| Cargo | Função |
|---|---|
| Zelador | Ajuda a regar plantas |
| Colhedor | Ajuda a colher plantas prontas |
| Caseiro | Cuida dos canteiros da fazenda após a compra do imóvel |

A persistência precisa impedir registros duplicados por cargo. Ao reconectar, o servidor deve restaurar a mesma entidade ou substituir atomicamente o registro antigo, preservando cargo, posição e tarefa.

### 7.3 Territórios

Há dez territórios na cidade. Cada um possui dono, demanda e renda. A captura exige distância e sessão autenticada. O dono anterior deve ser removido atomicamente da posse antes de o novo dono ser registrado.

A renda diária é calculada no servidor. Claims do armazenamento compartilhado do navegador não substituem o estado authoritative do servidor.

## 8. Combate, polícia e proteção da casa

Rivais e polícia são bots server-side compartilhados. O cliente não cria cópias próprias quando está online. O servidor decide movimento, alvo, cadência, alcance, linha de visão, dano, morte e respawn.

O jogador pode gerar procurado por `crime`. A polícia surge em ruas e persegue o jogador. Dentro da propriedade protegida, dano de NPC e polícia é bloqueado pelo servidor antes de alterar vida ou armadura.

A rota de tiro não deve aceitar dano enviado pelo cliente. O cliente informa intenção e alvo visual; o servidor confirma arma, munição, cadência, alcance, linha de visão e, idealmente, direção ou cone de mira.

## 9. Controles e interface

### Desktop

| Ação | Controle |
|---|---|
| Andar | WASD ou setas |
| Olhar | Mouse travado na tela |
| Ação | `E` |
| Recarregar | `R` |
| Inventário | `I` ou botão INVENTÁRIO |
| Trocar arma | `Q` |
| Pular | Espaço |
| Modo admin, se configurado | `F9` |

### Celular

O celular possui joystick virtual e botões **AÇÃO**, **TIRO**, **MIRA**, **PULO** e **RECAR**. O botão **MAPA** fica no topo. Ao abrir um modal, os controles touch são ocultados para não cobrirem o botão de fechar.

O mapa mobile é um painel de navegação, não apenas uma rota textual. Ele mostra a posição do jogador, o lote próprio, objetivos, cidade, fazenda, estrada, demais lotes e entidades relevantes recebidas pelo servidor.

## 10. Estrutura dos arquivos principais

```text
quintal-repo/
├── public/
│   └── index.html                 # cliente 3D, HUD, touch, mapa e WebSocket
├── servidor-1.js                  # servidor authoritative HTTP/Node/WebSocket
├── package.json                   # scripts, dependências e entrypoint
├── .gitignore                     # dependências, segredos, bancos e logs locais
├── render.yaml                    # configuração declarativa opcional do Render
├── .github/
│   └── workflows/
│       └── security.yml           # CI de sintaxe, segurança, carga e regressão
├── testes/
│   ├── test-seguranca.js          # handshake, validações e segurança básica
│   ├── test-multiplayer-aoi.js    # área de interesse e snapshots
│   ├── test-carga.js              # carga com múltiplos clientes
│   ├── test-clientes-casa.js      # clientes vinculados por lote
│   ├── test-plantio-proprio.js    # plantio no lote do jogador
│   ├── test-protecao-entidades.js # proteção da casa e entidades privadas
│   ├── test-audio-mixer.js        # mixer, mudo e recuperação de áudio
│   ├── test-http-static.js        # HTTP, public e health check
│   ├── test-regressao-p0.js       # regressão dos exploits P0
│   ├── test-regressao-p1.js       # sessão, token e contratos P1
│   └── ...                        # demais regressões multiplayer
├── check-client-syntax.js         # extrai/verifica JavaScript inline do cliente
├── docs/
│   ├── AUDITORIA_COMPLETA.md      # auditoria histórica
│   ├── CORRECOES_APLICADAS.md     # histórico de correções
│   ├── DIAGNOSTICO_PLANTAS_DESEMPENHO.md
│   ├── VULNERABILIDADES_SERVIDOR.md
│   └── VISAO_GERAL.md             # este documento
```

O projeto ainda possui um cliente monolítico. Isso facilita publicar um HTML único, mas aumenta o risco de código legado permanecer ativo junto de implementações novas. Ao alterar um sistema, deve existir uma única fonte de verdade: cliente para visualização/predição e servidor para estado/protocolo.

## 11. Como rodar localmente

### 11.1 Requisitos

É necessário ter Node.js 18 ou superior, npm, um navegador com WebGL e acesso à internet para carregar o Three.js r128 pelo CDN. Para persistência local recomendada, instale `better-sqlite3`; para ambiente remoto, configure Postgres.

### 11.2 Instalar dependências

No diretório do projeto:

```bash
npm ci
```

O `package-lock.json` oficial é versionado para tornar a árvore de dependências reprodutível no Render, na CI e localmente. Se o lockfile precisar ser regenerado de forma intencional, use `npm install --package-lock-only` e revise o diff antes do commit.

### 11.3 Iniciar o servidor authoritative

Em Linux/macOS:

```bash
AUTH_SECRET=dev-secret-local \
PORT=8800 \
DB_PATH=./quintal-dev.db \
npm start
```

No Windows PowerShell:

```powershell
$env:AUTH_SECRET="dev-secret-local"
$env:PORT="8800"
$env:DB_PATH="./quintal-dev.db"
npm start
```

O servidor HTTP/WebSocket fica em `http://127.0.0.1:8800`, as métricas ficam em `http://127.0.0.1:8800/metrics` e o health check em `http://127.0.0.1:8800/healthz`. O cliente escolhe automaticamente WebSocket same-origin em localhost e no Render; no GitHub Pages usa o endpoint seguro do Render. Não é necessário editar o HTML para testar localmente.

### 11.4 Servir o cliente

O próprio `servidor-1.js` entrega `public/index.html` na rota `/`, além de manter o WebSocket no mesmo listener. Com `npm start` ativo, abra:

```text
http://127.0.0.1:8800/
```

O navegador deve conseguir acessar o WebSocket same-origin. Em páginas HTTPS o cliente usa `wss://`; em localhost ele usa `ws://` local.

### 11.5 Variáveis importantes

| Variável | Padrão | Função |
|---|---|---|
| `PORT` | `8800` | Porta HTTP/WebSocket |
| `AUTH_SECRET` | segredo local, não ideal para produção | Assinatura dos tokens |
| `DB_PATH` | `./quintal.db` | Caminho do SQLite |
| `DATABASE_URL` | vazio | Conexão Postgres |
| `FUNDADOR_CHAVE` | vazio | Identidade do aparelho fundador |
| `MAX_CONEXOES` | definido no servidor | Limite de jogadores |
| `CLIENTE_FIRST_S` | 5 | Primeira espera antes de criar cliente |
| `CLIENTE_MIN_S` | 12 | Intervalo mínimo de clientes |
| `CLIENTE_MAX_S` | 24 | Intervalo máximo de clientes |
| `AOI_RAIO` | 70 | Raio de interesse dos snapshots |
| `TICK_HZ` | 20 | Frequência da simulação |

Não faça commit de `AUTH_SECRET` real, bancos SQLite, tokens, backups ou arquivos de sessão.

## 12. Como executar os testes

O teste básico de segurança é:

```bash
npm test
```

Os demais scripts são:

```bash
npm run test:http
npm run test:aoi
npm run test:carga
npm run test:reconexao
npm run test:clientes
npm run test:plantio
npm run test:entidades
npm run test:audio
npm run test:movimento
npm run test:mapa
npm run test:spawn
```

O teste P0 usa um servidor temporário e verifica catálogo, genética e altura:

```bash
TEST_WS=ws://127.0.0.1:8832 npm run test:p0
```

O teste P1 verifica token expirado, sessão duplicada, boot de carteira, limpeza de entidades, rota de saída e proteção online-only:

```bash
AUTH_SECRET=dev-secret-local TEST_WS=ws://127.0.0.1:8832 npm run test:p1
```

Para validar sintaxe do cliente e servidor:

```bash
node --check servidor-1.js
node --check testes/test-regressao-p0.js
node --check testes/test-regressao-p1.js
node check-client-syntax.js
```

A integração contínua executa `npm ci`, checa sintaxe, valida HTTP/public, inicia servidores isolados em portas diferentes e roda segurança, AOI, carga, reconexão, clientes, plantio, entidades, movimento, mapa, áudio e spawn. Um teste verde confirma apenas os contratos cobertos; persistência real, navegador físico e desempenho de GPU mobile ainda precisam de validação própria.

## 13. Regra de evolução do código

O projeto tem histórico de implementação em etapas. Há comentários e funções de versões antigas próximas de funções authoritative novas. A regra para futuras mudanças deve ser:

1. localizar todas as funções que fazem a mesma coisa;
2. escolher uma única fonte de verdade;
3. remover ou transformar o caminho antigo em wrapper explícito;
4. adicionar teste de regressão antes de apagar o legado;
5. fazer o cliente reagir a confirmações do servidor;
6. nunca manter uma segunda economia, população de NPCs, crescimento ou território local ativo quando o jogador está online.

Em particular, não devem coexistir:

| Sistema | Implementação que deve prevalecer |
|---|---|
| Carteira | servidor + mensagem `estado` |
| Plantas online | entidades server-side e AOI |
| Clientes | servidor, vinculados a lote |
| Rivais/polícia | bots server-side compartilhados |
| Portão de lote | estado authoritative do servidor |
| Movimento horizontal | servidor valida, cliente prevê/interpola |
| Altura e salto | servidor simula gravidade e chão |
| Territórios online | estado do servidor, não claims locais |
| Venda | resposta `venda_ok` e novo `estado` |
| Catálogo | objetos/mapas server-side sem protótipo |

## Referências

[1]: ./public/index.html "Cliente Three.js do Quintal 3D"

[2]: ./servidor-1.js "Servidor authoritative Node/WebSocket"

[3]: ./.github/workflows/security.yml "Workflow de segurança e regressão"

[4]: ./package.json "Scripts e dependências do projeto"

[5]: ./AUDITORIA_EXTREMA_FINAL_20260825.md "Auditoria extrema do projeto"

[6]: https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html "Client-Side Prediction and Server Reconciliation"

[7]: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket "MDN WebSocket API"
