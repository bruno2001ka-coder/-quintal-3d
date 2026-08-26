# Inspeção e organização do repositório GitHub

Fonte oficial: https://github.com/bruno2001ka-coder/-quintal-3d

O repositório usa a branch `main` como branch padrão e como fonte de publicação. O projeto é um Web Service Node.js: o processo inicia em `servidor-1.js`, serve o cliente estático a partir de `public/` e mantém o WebSocket no mesmo servidor HTTP. O `package.json` é o único manifesto de dependências e define `main` como `servidor-1.js` e `start` como `node servidor-1.js`.

## Estrutura canônica

| Caminho | Função |
|---|---|
| `package.json` | Manifesto Node.js, entrypoint e scripts de teste. |
| `servidor-1.js` | Servidor HTTP estático, WebSocket authoritative, persistência e regras multiplayer. |
| `public/index.html` | Cliente Three.js, HUD, controles touch, mapa, câmera, áudio e protocolo multiplayer. |
| `.gitignore` | Ignora dependências, bancos locais, logs, segredos e artefatos de ambiente. |
| `render.yaml` | Configuração declarativa opcional do Web Service, com `npm start` e `/healthz`. |
| `.github/workflows/security.yml` | Sintaxe, regressões, carga, WebSocket e teste HTTP da pasta pública. |
| `.github/workflows/pages.yml` | Publica `public/` no GitHub Pages por Actions. |
| `testes/test-*.js` e `check-client-syntax.js` | Testes automatizados e verificação do JavaScript inline do cliente. |
| `*.md` | Documentação técnica e registros históricos das auditorias/correções. |

Os arquivos de pacote numerados foram removidos e o `package-lock.json` oficial foi mantido como único lockfile. Não há um segundo HTML ou segundo servidor ativo; o cliente canônico é `public/index.html` e o servidor canônico é `servidor-1.js`.

## Publicação

O Render deve usar `npm ci --no-audit --no-fund` como build command e `npm start` como start command. O servidor lê `PORT`, faz bind em `0.0.0.0`, expõe `/healthz` para health check, `/metrics` para observação e entrega `/` como `public/index.html`. O WebSocket usa o mesmo host quando o cliente é servido pelo Render; no GitHub Pages, o cliente mantém o fallback para `wss://quintal-3d.onrender.com`.

O GitHub Pages usa o workflow `pages.yml` para publicar o conteúdo de `public/` sem exigir `index.html` na raiz. O endereço recomendado para o jogo multiplayer continua sendo o Web Service do Render, porque ele reúne frontend e backend no mesmo processo.

## Histórico

Os documentos de auditoria anteriores permanecem versionados porque registram decisões e problemas históricos diferentes; eles não são cópias executáveis nem são carregados pelo servidor. Quando um documento antigo citar `index.html` na raiz ou `quintal-cidade.html`, essa referência descreve o estado analisado naquela data, não a estrutura canônica atual.
