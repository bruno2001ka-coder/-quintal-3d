# Verificação de acesso ao Google Flow

Em 2026-08-26, o link fornecido pelo usuário (`https://labs.google/fx/pt/tools/flow/project/bd4a53da-06e7-43f4-a1a2-310273f213fc`) carregou a página pública de apresentação do Google Flow, não o editor do projeto. A página mostrou o botão `Create with Google Flow`, informações de modelos e preços, mas não mostrou a área de criação nem os assets do projeto. Clicar no botão pela sessão disponível não abriu o editor.

Conclusão: a sessão do navegador atual não confirmou acesso ao projeto. Não solicitar senha nem código ao usuário. Se o navegador pedir login, usar tomada de controle do usuário após a página correta estar aberta.

Após o usuário concluir o login pelo navegador, o mesmo link abriu o projeto real `Google Flow - 26 de ago., 18:38`. A interface mostra biblioteca de imagens, categorias Imagens/Personagens/Cenas/Ferramentas, campo `O que você quer criar?`, botões `Instruções para o agente`, `Configurações` e `Criar`. O projeto já contém várias imagens geradas anteriormente, incluindo mídias com prompt exibido como `Seedling growing with green leaves`.

A sessão autenticada exibiu o projeto com a biblioteca de imagens e o compositor inferior. O projeto já possui várias imagens geradas de plantas; o campo de prompt está no compositor inferior e pode ser preenchido após rolar o painel interno.

O editor autenticado está disponível com uma galeria de plantas e o compositor inferior. A posição do campo de criação foi localizada no DOM; o compositor usa um elemento editável e botões separados para `Criar` e para configurações. O próximo passo é enviar uma única geração de teste, conferir o resultado e só então repetir por estágio/genética.

A tentativa de anexar `reference-cannabis-3d.png` pela área `Adicionar mídia` não localizou o input de arquivo oculto. O Flow permaneceu no projeto, sem confirmação de upload. A geração pode prosseguir sem a referência local usando a descrição textual e as imagens já existentes no projeto; não se deve afirmar que a referência foi anexada.

O primeiro prompt foi preenchido no compositor e enviado pelo botão `Criar`. O Flow passou para o estado `Pensando…`, confirmando que a solicitação de White Widow estágio 0 foi recebida. Ainda não há resultado validado.

O Flow concluiu a primeira geração: White Widow estágio 0. Ao remover o filtro `Enviada`, apareceu um novo item de mídia com ID interno visível na página e prompt descrevendo um recorte de broto compacto. A galeria também mostra controles `Baixar`, `Reutilizar comando` e `Mover para a lixeira`. O resultado ainda precisa ser salvo localmente e visualmente conferido antes de ser considerado asset final.

A validação visual reprovou a primeira saída: apesar do prompt pedir estágio 0, o Flow entregou uma planta adulta/esguia com vários leques, fundo branco e sem semente visível. Esse arquivo não será integrado. A correção necessária é regenerar com prompt mais curto e explícito, enfatizando apenas uma semente ou broto mínimo; o fundo branco poderá ser removido depois por processamento determinístico se a forma estiver correta.

A segunda tentativa foi preparada corretamente: o comando anterior foi selecionado pelo DOM, substituído por um prompt curto e explícito de `White Widow stage 0`, e reenviado. O Flow voltou ao estado `Pensando…`. A primeira saída adulta não será usada; esta segunda saída aguarda validação visual.

A segunda geração do Flow foi aprovada visualmente como estágio 0: apareceu uma única semente pequena com dois cotilédones em fundo branco, sem a planta adulta da primeira tentativa. O arquivo foi salvo localmente como `white-widow-stage-0-flow-v2.png`/`.webp` para posterior limpeza do fundo e renomeação final.

O prompt do estágio 1 da White Widow foi corrigido e enviado no Flow. A interface mostrou `Pensando…`, indicando processamento em andamento. A primeira geração de estágio 0 foi descartada por estar adulta; a segunda foi aprovada como semente.

A geração do estágio 1 da White Widow foi aprovada: o resultado exibiu um broto pequeno com caule curto e quatro folhas, claramente diferente da semente e sem flores. O arquivo foi salvo como `white-widow-stage-1-flow.png`/`.webp`.

O prompt do estágio 2 da White Widow foi enviado após confirmar que o compositor continha somente o texto correto. O Flow mostrou `Pensando…`; aguarda-se a validação visual da planta vegetativa antes de salvá-la.

A primeira tentativa de estágio 1 foi corrigida e a segunda saída do Flow foi aprovada: broto com quatro folhas e caule curto, sem flores. A imagem foi salva como `white-widow-stage-1-flow-v2.png`/`.webp`. O resultado é adequado para a sequência, embora o fundo branco ainda precise ser removido antes de entrar no HTML.

A primeira tentativa do estágio 2 não produziu uma mídia confirmada: após o estado `Pensando…`, a galeria continuou com cinco links e nenhum texto `White Widow stage 2`. O Flow voltou ao compositor anterior. O estágio 2 será reenviado com o prompt limpo e só será aprovado após aparecer uma nova mídia e ser conferido.

O estágio 2 foi reenviado com prompt limpo e mais curto após a checagem de que a tentativa anterior não criou mídia. O Flow está processando novamente. A saída só será aceita se mostrar uma planta vegetativa compacta, com folhas/ramificação e sem flores.

Na conferência posterior, o projeto do Flow exibiu vários cards `Falha` com `10%` e textos de variações antigas como `gold-strain`, `white-strain`, `blue-strain` e `Defining Growth Stages`. Esses cards não correspondem ao prompt atual da White Widow e não serão usados. O estágio 2 continua sem resultado confiável até que uma nova geração limpa apareça.

O painel revelou uma fila antiga de variações automáticas (gold/white/blue/lime/orange/purple) com muitos cards em `Falha` e títulos `Defining/Expanding Growth Stages`. Essa fila foi interrompida pelo controle `Parar` para não continuar consumindo processamento nem misturar resultados com o lote do jogo. O resultado correto de White Widow estágio 0 e estágio 1 permanece salvo; o estágio 2 ainda não foi aprovado.

A inspeção confirmou que o compositor tinha o botão `Agente` pressionado. Após o clique de alternância, o estado DOM passou para `pressed=false`, indicando que a criação direta está selecionada. Isso evita que o prompt de imagem seja interpretado como uma tarefa de agente com variações antigas.

A imagem salva como `white-widow-stage-2-flow` foi conferida em tamanho real e reprovada: o Flow entregou uma planta clara/esbranquiçada em um cubo de substrato, com fundo branco e sombra. Não corresponde ao estágio vegetativo compacto pedido e não será integrada. O prompt precisa proibir explicitamente vaso/cubo de substrato e pedir folhas verdes em tom natural.

Após reabrir o projeto, o Flow mostrou oito mídias geradas sem falha: `c3fde29f-55da-4ec7-aaf9-fa9e21a718bc` (início da floração com buds azulados), `5756771e-5f28-44b7-8c0d-b427d9e281e8` (vegetativa azul-esverdeada), `347806cf-beed-4142-858e-3b0f96a72ee5` (muda com tom roxo), `6148e010-85ef-4d07-b908-c7026a906e8f` (muda verde-frost), além de `4a4dca43-8528-41af-aac3-14c4e8dca905`, `a702f7cf-191c-4a63-b4f4-7eb56942e973`, `06b2b41d-9d38-47e2-a73d-d6b3482288fd` e `fd686936-0398-48d5-8a7e-afb946dc82ad`. Os quatro últimos ainda precisam ser identificados visualmente por seus prompts/saídas; nenhum foi integrado ao jogo até aprovação.
