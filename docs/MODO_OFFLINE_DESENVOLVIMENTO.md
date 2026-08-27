# Modo offline de desenvolvimento — Quintal 3D

## Objetivo

O **sandbox offline** é uma ferramenta temporária de desenvolvimento. Ele permite testar a cena Three.js, o movimento, a câmera, a chuva, os canteiros, o ciclo visual das plantas, o balcão, a secagem, a cura, a embalagem, os funcionários e o combate enquanto o backend multiplayer estiver indisponível ou suspenso.

> O sandbox não é uma conta, não é multiplayer e não representa o estado real de nenhum jogador.

## Como entrar

1. Abra o frontend servido pelo GitHub Pages ou por um servidor HTTP local.
2. Aguarde a mensagem de conexão. Se o backend não responder, o botão **TESTAR OFFLINE** aparecerá na tela de entrada.
3. Clique em **TESTAR OFFLINE** e depois em **ENTRAR NO MUNDO**.
4. A interface exibirá a etiqueta **sandbox** e a mensagem de que nada será salvo na conta online.

O sandbox começa deliberadamente com valores de teste: carteira de R$ 10.000, nível 12, três sementes Blueberry Auto e recursos suficientes para exercitar as mecânicas visuais. A entrada acontece na **Casa Nova de demonstração**, com os canteiros da fazenda visíveis ao fundo. Ele também exibe três plantas Blueberry Auto de demonstração, em fases diferentes, para que a cena não comece vazia. Esses valores e plantas não vêm de uma conta e não devem ser interpretados como progressão.

## O que funciona localmente

O sandbox reutiliza a simulação visual existente para permitir movimento, câmera, chuva, canteiros locais, crescimento, rega, colheita, processamento em secagem/cura/embalagem, venda a clientes locais, compra de sementes e melhorias, contratação visual de funcionários, troca de armas, munição, colete e interações de combate. A finalidade é validar cena e mecânicas enquanto o serviço remoto não pode ser usado.

O modo local começa com três plantas de demonstração nos primeiros canteiros da Casa Nova; os demais canteiros locais e os canteiros visuais da fazenda ficam livres para inspeção e teste. As plantas de demonstração são temporárias e locais. Se a mesma cena for iniciada novamente sem recarregar a página, os testes locais já feitos não são apagados pelo segundo `start`; para obter um sandbox novo, recarregue a página e entre novamente.

## O que não funciona — por decisão de segurança

O sandbox não salva carteira, nível, sementes, lotes, plantas, funcionários, imóveis, jobs ou posição. O botão **SALVAR** não transforma o estado local em uma conta: sem o primeiro estado authoritative do servidor, ele apenas informa que não há servidor para salvar.

O sandbox também não abre WebSocket, não faz login, não reconecta automaticamente e não envia as ações locais ao backend. As preferências de interface, como qualidade gráfica, som e avatar visual, podem continuar no armazenamento do navegador; isso não é progresso econômico nem autoridade de jogo.

Para voltar a tentar o modo online, recarregue a página. A nova carga começa pelo fluxo normal de conexão e login. Não existe mesclagem automática entre o sandbox e a conta online.

## Multiplayer online

Quando o servidor responder, o fluxo online continua separado. O servidor Node em `servidor-1.js` é a autoridade para autenticação, carteira, nível, catálogo de genéticas, compra, plantio, crescimento, colheita, lotes, funcionários, produção, venda, combate e posição. O cliente apenas envia pedidos e desenha o estado recebido.

O GitHub Pages serve somente os arquivos estáticos do frontend. Ele não substitui o backend WebSocket. Enquanto o Render estiver suspenso, a página pode carregar o jogo e oferecer o sandbox, mas não há evidência de multiplayer remoto funcionando. Quando houver orçamento para um servidor pago, o servidor Node e o banco deverão ser recuperados/testados separadamente; os dados do sandbox não devem ser migrados como se fossem dados de produção.

## Desenvolvimento local

Na raiz do repositório, instale as dependências preservando o lockfile e inicie o servidor Node:

```bash
npm ci
npm start
```

O frontend online ficará no host local indicado pelo servidor. Para testar apenas a interface e o sandbox sem backend, sirva `public/` com qualquer servidor HTTP estático; a ausência de WebSocket deve produzir a opção explícita **TESTAR OFFLINE**, e não uma conta local falsa.

Os testes automatizados incluem:

```bash
npm run test:offline
npm run test:client-ui
npm run test:crescimento
npm run test:persistencia-fazenda
npm run test:catalogo-sementes
```

O teste offline verifica a presença do botão explícito, a interrupção de retries, a ausência de restauração de progresso local e a exigência de estado authoritative no modo online. A bateria completa continua sendo a referência antes de qualquer publicação.
