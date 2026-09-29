# Evidências locais CC15 — 29/09/2026

Base produto `354d09f828b69de461935b3ea24000a7ceb57a28`. CI/review/merge ficam vinculados ao SHA final da PR no controle. Execuções abaixo usam fixtures locais, não dados reais.

| Verificação | Resultado |
| --- | --- |
| Central completa `node --test tests/ticket-*.test.mjs` | 589/589 antes da adição do último teste de preflight CC15 |
| CC15 + migration gate final | 43/43; 24 testes específicos de feedback +19 do operador |
| D1 nativo local, smoke-feedback-local.mjs | Instrumento, convite, resposta, replay, retirada, rollback e integridade aprovados |
| Chromium feedback + métricas | 9/9 aprovados; 6 CC15 +3 CC11, incluindo publicação, consentimento, retirada, retry, mobile, ACL e troca de organização |
| Preview safety | 23/23 e gate fail-closed aprovado |
| Build | TypeScript + Vite aprovado; warnings existentes de dependências/chunks |
| TypeScript após ajustes de UI | Aprovado |
| Error-sink ratchet estrito | Aprovado; baseline não ampliada |
| SQL | Upgrade e fresh equivalentes; quick_check=ok; foreign_key_check vazio |

Migration0038 SHA256: `4ed27974f8a714fb1d7dedcb95d7faa289b221fbf057479020f7d39f6131345f`.

Concorrência testada na emissão e resposta. Falha após INSERT reverte resposta/recibo/evento. Revogação entre autorização e batch nega resposta e entrega; ACL precede a varredura/contagem. Testes de coorte verificam40%, imaturos, versões, recusa, retirada e futuras respostas excluídas por asOf. Listas e agregados não incluem comentário. A retirada invalida novas projeções, sem afirmar expurgo do histórico.

Preflight rejeita ledger incompleto, ausência de fonte e objetos feedback parciais. Audit e apply revalidam o digest do schema. Nenhum audit/apply remoto, deploy, flag real, publicação de instrumento real ou emissão real foi executado nesta entrega. QA assistivo, carga, budgets, canário, retenção e aceite autenticado permanecem pendentes conforme acceptance.md.
