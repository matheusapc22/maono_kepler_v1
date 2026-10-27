# Revisão do plano: Organizações

Fonte: critérios do plano recuperado da Library pelo executor coordenador em 27/10/2026, `libfile_89db1ea4dc7c8191a8dd35f29dd95e9c`, 333 linhas. O arquivo separado não veio no ZIP; esta matriz usa os onze critérios transmitidos. A imagem aprovada continua sem arquivo/ID confirmado. Nenhuma equivalência visual exata é afirmada.

## Matriz de cobertura

| Critério | Implementação e evidência | Limite do aceite |
| --- | --- | --- |
| 1. Rota e shell | Integração condicionada à subaba `organizations`; ações no cabeçalho existente, sem título adicional, Atualizar ou zoom. CSS do workspace e de seus dialogs. | Cinco viewports do build real inspecionados, sem overflow global. Sem referência aprovada para equivalência exata. |
| 2. Indicadores e semântica | SQL independente para summary global e total filtrado; pessoas ativas distintas; arquivos contabilizados uma vez por registro, excluindo lixeira/expurgados e órfãos. Owner explícito ativo, sem inferência legada. Datas em America/Sao_Paulo. Atividade usa eventos, não updated_at. | Atividade anterior ao módulo não aparece. Falha de consulta não produz zeros substitutos. |
| 3. Navegação | Filtros rascunho/aplicados, URL, paginação, seleção da página, AbortController e sequências. Uma recarga de workspace ao fim de uma operação/lote. Detalhe carregado sob demanda. | Voltar/avançar, seleção e resposta antiga após revogação aprovados no browser local. |
| 4. Lifecycle | Chave por ator e hash; progresso/lease persistidos. Criação retoma o mesmo registro inclusive enquanto claim de armazenamento está ativo. Nenhum GET cria pasta. Slug/pasta ausentes do contrato de edição. | HTTP Dropbox simulado nos testes locais; não é aceitação do provedor. |
| 5. Pausa e responsável | Pausa via lifecycle, sem DELETE; teste com snapshots de vínculos, projetos, ACL e arquivos. Permissão operacional reconsulta estado do contexto quando o módulo está habilitado. Admin mantém acesso para recuperação. Owner elegível protegido por triggers, sem promoção de papel global. | Proteções de último owner/autodesativação continuam sob os contratos dos endpoints legados de usuários, incluídos na regressão aprovada. |
| 6. Quotas | Mesmo resolver de Projects; uso e reservas ativos; origem do limite visível. Edição/aprovação preservam herança e overrides não editados. Reserva exige versão atual da política. SQL impede downgrade abaixo do uso/reservas. | Usuários, armazenamento e exportações não editáveis como limites operacionais. |
| 7. Solicitações | created_by, requested_limits_json, motivo, valores solicitados e versões exibidos. Decisão/política/evento em batch com asserção transacional; UPDATE sem linhas provoca rollback. Recusa preserva política. | Aprovação apenas de plano/projetos. Outros tipos podem ser consultados/recusados. |
| 8. CSV | UTF-8 estrito, 100 linhas/128 KiB, prévia sem escrita de negócio, contratos fechados, slug/plano/owner/duplicidade validados. Nenhuma URL é buscada. Hash e progresso duráveis; retry apenas recuperável; fórmulas neutralizadas na exportação. | A página precisa permanecer aberta para avançar etapas; não há worker em background. Validação de prévia faz consultas por linha, limitada a 100. |
| 9. Documentos e histórico | Consulta paginada de documentos sem mutação; pastas/uploads/lixeira/configurações permanecem no módulo existente. Histórico gerencial paginado por cursor, sem fabricação retrospectiva. | Divergência aceita apenas como parcial: auditoria antiga sanitizada não foi incorporada. Ela permanece no sistema legado. |
| 10. Segurança e concorrência | Super Admin e permissão server-side por request/item; origem/JSON/header em POST; campos extras rejeitados. 401/403/404 limpam tela, inclusive revogação entre etapas. no-store; nenhum dado admin no localStorage. CAS, dependências e auditoria na mesma transação. | SQLite e handlers reais verificam o contrato local; D1 remoto não executado. |
| 11. Aceite | Casos backend, migrations, suites legadas e casos de navegador separados abaixo. | Lint, typecheck, build, browser, benchmark e CI só contam quando seus resultados estiverem registrados. |

## O que os testes verificam

`tests/organization-management.test.mjs`: contratos CSV/exportação, totals/filtros, paginação, número constante de statements da listagem, chaves/leases/replay, validação de owner, rejeição de privilégios, CSRF, documentos e histórico. Usa SQLite com schema reduzido e adapters de lifecycle/autenticação sintéticos; não comprova integração sozinho.

`tests/organization-management-integration.test.mjs`: schema completo, sessões, ACL, Pages handler, lifecycle e quotas do produto. Verifica revogação, isolamento de operadores, pausa sem perda, criação idempotente, edição concorrente, armazenamento parcial, request legado com quota efetiva, auditoria antes/depois, migration sobre dados existentes, defaults/overrides e reserva com política antiga. O único provedor externo simulado é HTTP Dropbox.

As suítes de lifecycle, concorrência, wiring e project-creation-limits cobrem regressões existentes. A contagem agregada é informativa; não substitui os cenários nem os gates pendentes. O log da execução final deve prevalecer sobre checkpoints anteriores.

## Resultado e pendências explícitas

533 regressões passaram (2 skips Bash no Windows), incluindo 14 integrações do módulo. TypeScript e build completos aprovados. Lint dos 8 TS/TSX alterados limpo; lint global preexistente com 109 erros e 44 avisos, comparado arquivo a arquivo com as duas bases. Não declarar ready enquanto gate obrigatório falhar.

Navegador: 18 casos aprovados (17 + toque adicional), cinco viewports inspecionados. Quatro casos usam sessões/ACL/handlers reais com SQLite. Os demais verificam UI com HTTP interceptado. Teste humano com leitor de tela e homologação de dispositivos reais permanecem pendentes.

Benchmark local de 6/50/500: 30 amostras, p50/p95 e statements em `organization-management-benchmark.json`. Não é medição de D1, latência de rede ou carregamento completo da página. O número de statements permanece 8; linhas retornadas não equivalem a linhas lidas.

Auditoria antiga sanitizada continua fora do histórico novo (entrega parcial nesse critério). Imagem aprovada indisponível; sem alegação de fidelidade exata. Preview, Produção, provedor real e migration remota não executados. CI e SHA remoto são registrados na PR draft nova. Evidências detalhadas e reversão: `organization-management.md` e `organization-management-validation.json`.
