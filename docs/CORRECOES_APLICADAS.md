# Correções aplicadas — Quintal 3D

## Resumo

A correção foi aplicada diretamente sobre os arquivos fornecidos, sem sobrescrever os originais. Uma cópia dos arquivos originais foi preservada em `backup-auditoria-20260825-184918/`.

## Correções de segurança e autoridade

O servidor agora emite e valida sessões HMAC, ignora `persistId` como prova de posse, rejeita sessões duplicadas, exige handshake antes de ações, sanitiza nomes, valida propriedade e distância, escolhe o spawn oficial e aplica colisão server-side.

Dinheiro, banco de sementes, estoque, munição, armas, armadura, nível, XP, imóveis, territórios, empregados, clientes-NPC, produção online, vendas, dano, morte e respawn passaram a ter decisão server-side. O endpoint inseguro `colher_local`, que aceitava genética, saúde e quantidade fornecidas pelo cliente, foi desativado até que esses canteiros sejam entidades server-side.

O cliente deixou de aplicar previsões econômicas online em compras, vendas, XP, munição, armadura, funcionários, imóveis e territórios. Ele recebe snapshots e estados do servidor. Clientes-NPC são criados, movidos e resolvidos pelo servidor, com IDs compartilhados em snapshots AOI. Funcionários são persistidos por cargo, restaurados após reinício e executam rega/colheita server-side.

## Persistência e inicialização

O schema SQLite/Postgres foi ampliado para munição, armadura, funcionários, imóveis, nível, XP e territórios, com migrações compatíveis para tabelas existentes. O servidor aguarda a inicialização do banco e a carga dos lotes antes de aceitar conexões. O segredo de sessão é lido de `AUTH_SECRET`; se a variável não existir em ambiente local, um segredo é criado em `.quintal-session-secret`. Em produção, configure `AUTH_SECRET` como variável persistente da hospedagem.

O `package.json` agora aponta para `servidor-1.js` e o script `npm start` executa esse arquivo.

## Validações executadas

| Verificação | Resultado |
|---|---|
| `node --check servidor-1.js` | Aprovado |
| Extração e `node --check` do JavaScript inline do HTML | Aprovado |
| Validação do `package.json` e do entrypoint | Aprovado |
| Inicialização real do servidor com SQLite temporário | Aprovado |
| Handshake e emissão de token assinado | Aprovado |
| Rejeição de plantio forjado | Aprovado |
| Correção anti-teleporte | Aprovado |
| Rejeição de sessão duplicada | Aprovado |
| Rejeição de `hello` duplicado | Aprovado |
| Alteração server-side de portão | Aprovado |
| Snapshot de clientes-NPC server-side | Aprovado |

O teste automatizado principal está em `testes/test-seguranca.js`; os demais contratos ficam nos testes irmãos dessa pasta.

## Como executar

```bash
npm ci
AUTH_SECRET='defina-um-segredo-longo-e-aleatorio' npm start
```

Para Render ou outra hospedagem, configure `AUTH_SECRET` e, para persistência no plano correspondente, `DATABASE_URL` apontando para PostgreSQL. Não reutilize o segredo de teste usado no ambiente local.

## Observação funcional

A colheita de canteiros locais da estufa, grow room e fazenda fica bloqueada no modo online em vez de aceitar dados falsificáveis. O modo offline continua disponível. Para reativar esses canteiros no multiplayer, é necessário concluir a migração de todos os slots locais para entidades server-side com ciclo de crescimento, rega, adubação, estágio e colheita persistidos.
