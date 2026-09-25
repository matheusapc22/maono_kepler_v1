# CC-02 — validação técnica e pendências de entrega

Execução local em 25/09/2026, sobre a base pós-merge da CC-01 `b0f62ba6d00b1627ad9fcec45125da9ea3544232`. Os arquivos desta pasta e o código serão publicados juntos na branch `feat/cc-02-triage-classification`; PR, SHA publicado e checks remotos são registrados no [controle](https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit). Este documento registra evidência local anterior à publicação, sem presumir o resultado dos checks remotos.

## Resultado executado

| Verificação | Resultado | Evidência |
|---|---|---|
| Contratos de baseline CC-01 | Passou: 16 endpoints, 3 enums, 10 referências e 12 invariantes propostos reconciliados | [baseline.log](evidence/baseline.log) |
| Triagem e regressão Ticket | 52 testes passaram: 9 unitários, 8 helpers UI, 27 integração SQLite e 8 regressões Ticket | [triage-tests.log](evidence/triage-tests.log) |
| Segurança Preview | 23 testes e assert estático passaram | [preview-safety.log](evidence/preview-safety.log) |
| Regressão Change Requests | 98 testes passaram | [cr-regression.log](evidence/cr-regression.log) |
| Build completo | TypeScript e Vite passaram | [build.log](evidence/build.log) |
| Componentes React em navegador local | Dez combinações, falha/retry, perfil somente leitura, classificação legada e geometria mobile passaram | [ui-smoke.json](evidence/ui-smoke.json) |
| Revisão independente | Sem P0/P1 identificado após correções descritas abaixo; diff sem erro de whitespace | Revisão do diff final e dos três testes determinísticos de concorrência |

Total das três suítes automatizadas de domínio/regressão: **173 testes aprovados**. O navegador usa Chromium 140 com dados fictícios e HTTP interceptado; não representa sessão QA autenticada. O build emitiu avisos de dependências e de tamanho dos bundles, registrados integralmente no log; otimização global do bundle não pertence a esta entrega.

## Rastreabilidade do aceite

| Caso / requisito | Evidência implementada | Limite |
|---|---|---|
| CT-03 / REQ-CC-03 e 04 | Cinco naturezas × dois domínios persistem separadamente; perguntas e resultado esperado validados; GET lista/detalhe refletem os campos | SQLite real descartável, não D1 remoto |
| CT-04 | Domínio/prioridade/reclassificação exigem motivo aplicável; ator, antes/depois e instante registrados; natureza e prazo não mudam por inferência | SLA e políticas continuam na CC-10 |
| CT-05 | SQL literal da 0010 seguido da 0025 conserva chamados ambíguos como `legacy`/natureza nula; classificação humana explícita preserva histórico | Não é backfill em produção; não é remoção do importador GET da CC-03 |
| Compatibilidade | Flag ausente/desligada; schema antigo/incompleto; POST antigo sem campos novos; writer real de CR e replay com flags ligada/desligada | Aplicação e ativação remotas pendentes |
| Consistência | Rollback real quando falha o evento/UPDATE; isolamento por organização; proveniência não falsificável pelo payload | Não comprova imutabilidade/auditoria obrigatória global |
| Concorrência restrita | Reclassificação e edição simultânea na mesma natureza fazem a tentativa perdedora retornar 409 sem eventos; PATCH de contexto preserva status/responsável/prazo concorrentes | Janela leitura/validação do servidor→batch; sem versão do cliente, formulários anteriormente desatualizados continuam escopo CC-03 |
| Jornada UI | Cinco naturezas × dois domínios; sem editor para perfil somente leitura; motivo de domínio; troca de natureza limpa respostas após confirmação; rascunho preservado após 503 e retry | Teste funcional local; revisão humana/acessibilidade com tecnologias assistivas pendentes |

## Correções decorrentes da revisão

1. Mudança de domínio passou a exigir motivo novo e registrar o evento com valores reais antes/depois.
2. O drawer envia apenas controles alterados: classificar não reconverte o horário do prazo nem reenvia status e responsável.
3. Snapshot das onze colunas de triagem protege a validação contra mudança concorrente antes do batch.
4. Limite do JSON serializado de respostas é validado antes da escrita; erros públicos não expõem nomes de migration.
5. Campos se ajustam aos limites do formulário e o anúncio de acessibilidade possui estilo local.

## Reprodução local

Ambiente utilizado: Node `v24.19.0`, dependências existentes do projeto instaladas sem alterar o lockfile. CI de contratos usa Node 22 com suporte a remoção de tipos e SQLite. Nenhum token real, dado de cliente ou chamada externa é necessário nos testes novos.

```sh
node scripts/central-chamados/validate-cc01.mjs
node --experimental-strip-types --test tests/ticket-triage*.test.mjs tests/ticket-center.test.mjs
npm run test:preview-safety
npm run test:change-requests
npm run build
node scripts/central-chamados/smoke-triage-ui.mjs
git diff --check
```

O ensaio de interface requer as dependências do projeto e o Chromium do Playwright instalado. `CC02_EVIDENCE_DIR` pode apontar para uma pasta local para salvar as duas capturas. O script cria servidor em `127.0.0.1`, intercepta as respostas da API, bloqueia chamadas inesperadas e encerra os recursos ao terminar. [Desktop](evidence/triage-desktop.png) e [celular 390 px](evidence/triage-mobile.png) foram inspecionados visualmente.

## Estado operacional

- Código preparado para revisão e merge; nenhum merge de CC-02 foi executado nesta validação.
- **Migration `0025_ticket_triage_classification.sql` necessária e pendente de autorização/aplicação/confirmação por ambiente.** Somente SQLite descartável foi alterado.
- `MAONO_TICKET_TRIAGE_ENABLED` permanece desabilitada por padrão. Não houve alteração de configuração, mutações Preview ou D1 remoto.
- QA autenticado, aceite humano e prova de produção permanecem pendentes. As pendências humanas/operacionais da CC-01 não foram apagadas pelo merge.
- Migrations históricas 0021/0022/0023 continuam sob seus gates próprios, sem aplicação ou ativação por esta entrega.

Procedimento de expansão, conferência, ativação e rollback: [migration-runbook.md](migration-runbook.md). Hashes dos artefatos locais: [manifest.json](evidence/manifest.json).
