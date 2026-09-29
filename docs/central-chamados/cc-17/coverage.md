# CC17 — cobertura e limites

Inventário sobre CC16 `a9fb981d4122ed2d2ddb9eab906770fdf10e3047`, acrescido da integração CC17. Testes automatizados preservam contratos; a matriz não declara os casos humanos/operacionais aceitos. Fontes: documentos de cada CC, `tests/` e controle mestre.

| Origem / casos | Automação executada na regressão | Limite que permanece |
|---|---|---|
| CC01 · CT01–02 | Validador de contratos, ticket-center e Preview | Walkthrough humano CT02 |
| CC02 · CT03–05 | ticket-triage, migração/legado e criação | Aceite por natureza/domínio no alvo |
| CC03 · CT06–10/49 | ticket-commands, HTTP, legacy-backfill e binding D1 nativo local | Cutover e recuperação por organização no alvo |
| CC04 · CT11–13/50 | ticket-access; operador CC04 registrado | Execução autenticada com cleanup e flags comprovados |
| CC05 · CT14–17 | ticket-conversation*: audiência, CAS, rascunho, idempotência | QA remoto, leitura humana e decisão operacional |
| CC06 · CT18–23 | ticket-attachment*: perda de ACK, retomada, capacidade, hash, reconciliação | Sessões e armazenamento reais sob janela aprovada |
| CC07 · CT24–25/15B | ticket-notifications + navegador | Worker, parâmetros, alertas e latência reais |
| CC08 · CT26–29/52 | ticket-changes/project-change-request* + navegador | Reconciliação e aceite produtivo |
| CC09 · CT30–32 | ticket-flow + navegação | Uso autenticado e desempenho D1 |
| CC10 · CT33–36 | ticket-sla + navegador | Políticas, calendários, responsáveis e aceite |
| CC11 · CT37–40 | ticket-metrics + navegador | População real, budgets e configuração |
| CC12 · CT41–42 | ticket-exports + navegador | Retenção, worker/storage reais, quotas e aceite |
| CC13 · CT43–44 | ticket-cases + navegador + D1 nativo local | Casos reais, audiências e decisões operacionais |
| CC14 · CT45–46 | ticket-knowledge + navegador | Revisão editorial/ratificação e aceite |
| CC15 · CT47–48 | ticket-feedback + navegador | Coortes, parâmetros, participação humana e aceite |
| CC06 · CT51 | ticket-attachment-uploads-integration: D1 falha após commit Dropbox; storage não READY e hash/reconciliação | Confirmar comportamento no alvo e scanner/quarentena se configurados; ausência de scanner não é aprovação |
| CC16 · CT53–54 | Nove testes de acessibilidade entre os 59 testes de navegador | Leitor de tela, zoom/contraste, 15 jornadas e compreensão humanas |
| CC17 · CT55 | 18 testes integrados compartilham cinco perfis/duas organizações, ACL, revogação, canais indiretos | Sessões/URLs reais e cobertura de cada ação na janela |
| CC17 · CT56 | Benchmark misto local, contagens, hash, rejeição SOURCE_CHANGED e recuperação | Budgets, escala, duração, custo e observabilidade reais |
| CC17 · CT57 | Atomicidade, replay, CAS, armazenamento/outbox; fixtures existentes de upload | Falhas reais controladas, alerta, contenção e retomada |
| CC17 · CT58 | Schema expandido, escrita OFF, leitura privada autorizada e consumidores pausados | Rollback de versão servida, drenagem e prova de restauração |

Entrada principal: `tests/ticket-integrated-gate.test.mjs`; schema conjunto: `tests/helpers/ticket-integrated-db.mjs`; gate: `tests/cc17-evidence.test.mjs`; operador: `tests/production-acceptance-operator*.test.mjs`. O harness Dropbox foi extraído sem mudar o contrato dos testes existentes.

Os 32 registros herdados e nove pendências pós-CC16 da planilha contêm referências cruzadas; não são 41 problemas únicos. Não foram encerrados automaticamente. A CC18 deve reconciliar requisito → PR → teste → evidência e tratar cada bloqueador pelo seu ID original.
