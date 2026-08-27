# Deploy do servidor Quintal 3D no Fly.io

## Decisão de arquitetura

O Quintal 3D usa o mesmo processo Node.js para servir `public/index.html`, responder `/healthz` e manter o mundo multiplayer via WebSocket. O estado autoritativo dos jogadores, lotes e entidades fica em memória durante a execução; a conta, a carteira e os lotes são persistidos pelo servidor.

Por isso, esta primeira implantação usa **uma única Machine** em São Paulo (`gru`) e mantém a Machine ligada. Não é seguro escalar horizontalmente este servidor sem antes separar o estado do mundo em uma autoridade por shard ou em um serviço coordenador. O volume persistente em `/data` guarda o SQLite usado como fallback quando `DATABASE_URL` não está configurado.

O Fly.io informa que o sistema de arquivos raiz da Machine é efêmero e que volumes são o mecanismo persistente para arquivos locais, como bancos SQLite. Os volumes ficam vinculados a uma região e a uma Machine; portanto, esta configuração é adequada para uma primeira instância única, mas exige backup antes de tratar os dados como produção crítica.

## Arquivos incluídos

| Arquivo | Função |
|---|---|
| `Dockerfile` | Imagem Node.js 22, instala somente dependências de produção e copia servidor e cliente. |
| `docker-entrypoint.sh` | Cria o diretório do volume e inicia o processo como usuário não privilegiado. |
| `.dockerignore` | Reduz o contexto do build e impede enviar banco local, testes, documentos e segredos. |
| `fly.toml` | Define a Machine, porta 8080, WebSocket, health check, reinício e volume `/data`. |

## Configuração da tela do Fly.io

Se a implantação for iniciada pela tela de GitHub, use a organização pessoal, o repositório `bruno2001ka-coder/-quintal-3d`, a filial `main`, a porta interna `8080` e o diretório de trabalho `/`. O campo de configuração deve apontar para `fly.toml` na raiz.

Use um nome de aplicativo válido e único, preferencialmente `quintal-3d-bruno`. Se o Fly.io já tiver criado outro nome, substitua o valor `app` de `fly.toml` pelo nome real antes do deploy.

Escolha São Paulo (`gru`) se estiver disponível. O servidor foi configurado com `auto_stop_machines = "off"` e `min_machines_running = 1` porque desligar a única autoridade causa reconexões, perda do estado em memória e latência de inicialização.

O Fly.io exige um método de pagamento para criar a infraestrutura. Não há cartão, senha ou token no repositório; essa etapa deve ser concluída pelo proprietário da conta diretamente no painel do Fly.io.

## Secrets obrigatórios

Configure os secrets no aplicativo depois que ele for criado, antes de liberar jogadores:

```sh
fly secrets set AUTH_SECRET="gere-uma-chave-longa-e-aleatoria"
```

`AUTH_SECRET` é usado para assinar as sessões de login. Nunca coloque esse valor no GitHub, em `fly.toml`, no Dockerfile ou no HTML.

`FUNDADOR_CHAVE` é opcional e só deve ser configurado se o recurso de fundador estiver sendo usado:

```sh
fly secrets set FUNDADOR_CHAVE="chave-do-dispositivo-do-fundador"
```

Não configure `ALLOW_ANONYMOUS=1` no ambiente de produção. O servidor deve continuar exigindo login para associar progresso ao jogador.

## Publicação pela linha de comando

Com o repositório clonado e o `flyctl` autenticado:

```sh
cd quintal-repo
fly auth login
fly launch --no-deploy --copy-config
fly secrets set AUTH_SECRET="gere-uma-chave-longa-e-aleatoria"
fly deploy
```

Se o aplicativo já existir, não execute `fly launch` novamente. Use apenas:

```sh
fly deploy -a quintal-3d-bruno
```

O primeiro deploy deverá criar o volume `quintal_data` conforme o bloco `[mounts]`. A criação do volume gera custo próprio conforme o plano da conta; confirme os valores no painel antes de prosseguir.

## Verificações após o deploy

O servidor deve responder com HTTP 200:

```sh
curl -fsS https://quintal-3d-bruno.fly.dev/healthz
```

A resposta esperada contém `ok: true`, por exemplo:

```json
{"ok":true,"tick":123,"banco":"sqlite"}
```

Também verifique a página e os logs:

```sh
fly status -a quintal-3d-bruno
fly checks list -a quintal-3d-bruno
fly logs -a quintal-3d-bruno
```

O cliente publicado no GitHub Pages deve apontar o `MP_URL` para `wss://quintal-3d-bruno.fly.dev` depois que o backend estiver comprovadamente estável. Não altere esse endereço no frontend antes de validar login, reconexão, plantio, crescimento e persistência em uma conta de teste.

## Limitações importantes

Esta configuração não cria alta disponibilidade. Como o mundo autoritativo está em memória e o SQLite fica em um volume local, deve permanecer uma Machine. Volumes não são replicados automaticamente entre Machines. Para alta disponibilidade real, a próxima etapa é migrar o estado durável para Postgres, manter uma autoridade de jogo por região/shard e definir uma estratégia de reconciliação e presença.

## Referências

[1]: https://fly.io/docs/languages-and-frameworks/dockerfile/ "Fly.io — Deploy with a Dockerfile"
[2]: https://fly.io/docs/reference/configuration/ "Fly.io — App configuration (fly.toml)"
[3]: https://fly.io/docs/reference/health-checks/ "Fly.io — Health Checks"
[4]: https://fly.io/docs/volumes/overview/ "Fly.io — Fly Volumes overview"
