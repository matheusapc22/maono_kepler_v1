# Evidências locais CC14 — 29/09/2026

Base produto: `d37cd1e9aa95a5f5ea55fdc400a13e96c0bde461`. Validações abaixo são locais; CI final fica vinculado ao SHA da PR no controle.

| Gate                                                             | Resultado                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Regressão Central (`node --test tests/ticket-*.test.mjs`)        | 565/565 aprovados antes da adição do teste final de create concorrente                     |
| Suíte final CC14 (`node --test tests/ticket-knowledge.test.mjs`) | 23/23 aprovados, incluindo create concorrente idempotente                                  |
| CC13 + migration operator + CC14                                 | 59/59 aprovados na rodada anterior ao teste adicional de create                            |
| Chromium CC13/CC14                                               | 9/9 aprovados; 5/5 CC14 reexecutados após ajustes finais de UI                             |
| D1 nativo local (`smoke-knowledge-local.mjs`)                    | Ciclo editorial, mensagem/proveniência, replay, retirada, rollback e integridade aprovados |
| `npm run test:preview-safety`                                    | 23/23; gate fail-closed aprovado                                                           |
| `npm run build`                                                  | TypeScript + Vite aprovados; warnings de dependências/tamanho de chunks existentes         |
| TypeScript final (`tsc -b`)                                      | Aprovado após últimos ajustes de UI                                                        |
| Error-sink ratchet estrito                                       | Aprovado; baseline não ampliada                                                            |
| `git diff --check`                                               | Aprovado                                                                                   |

CT45 valida fonte privada, rascunho restrito, publicação sem revisão bloqueada e revisão por pessoa distinta. CT46 valida edição humana, envio único, referência v2 e retirada. Negativas cobrem cross-org, publicação privada, grant/membership revogados, seleção de outro ator, retirada/substituição antes do envio, CAS e payload divergente. Falha injetada após início da gravação reverte mensagem, eventos, outbox, recibo e proveniência.

Histórico testado com 203 revisões: páginas de 20 revisões e 100 decisões, sem bloquear a revisão201. UI testa mobile sem overflow, renderização de HTML como texto, confirmação humana renovada após edição, retry do payload preservado, troca de organização e limpeza de corpo após negação. Esses testes não substituem QA manual assistivo ou carga real.

Migration0037 SHA256: `3c2a3f9f64513126fe2643ac5b0049aba5184d3254aff58188e753cfe806acb0`. Sem audit/apply remoto, alteração de flags, dados reais ou permissões. Não houve execução do production-acceptance-operator.
