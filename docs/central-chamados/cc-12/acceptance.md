# Aceite CC-12 e registro de pendências

Status: implementação local CC12-A/B; review/CI remoto, banco remoto, deploy, aceite autenticado e rollout ainda precisam de evidência própria. Teste local com adaptador SQLite não é execução Cloudflare D1 nem Dropbox real.

| Controle | Resultado nesta execução | Para encerrar |
|---|---|---|
| CT-41 | Fixture com 250 autorizados + privados/cross-org excluídos; páginas completas, filtros, percentis e manifesto reconciliados | Repetir autenticado; complementar causas/incidentes após CC-13 |
| CT-42 | Revogação após geração e entre partições, checksum, isolamento, CSV adversarial | Sessões reais e corpus importado/reaberto nos clientes aprovados |
| T03/T04 | Mutação antes/durante persistência, idempotência, conflito e escopo testados | Concorrência e HTTP reais |
| T05/T06 | Lease obsoleto, workers concorrentes, crash/finalize ambíguo, quota, backoff, cancelamento e exaustão testados | Fault injection controlada com Dropbox/D1 reais |
| T07/T08 | TTL, cleanup recuperável, órfão tardio, privacidade e manifestos testados | Autenticação real e inspeção dos objetos privados |
| T09 | Corpus =,+,-,@, aspas, CR/LF, Unicode e roundtrip local | Matriz Excel/LibreOffice/Sheets, inclusive reabertura |
| T10 | 250 linhas, limites de linhas/bytes e paginação cobertos localmente | Budgets aprovados + medições CPU/memória/D1/latência e concorrência |
| T11 | Recusa explícita de causas/incidentes | Bloqueado por CC-13 |
| T12 | Quatro testes Chromium: OFF, mobile, retry idêntico, revogação/org e polling | Teclado/leitor de tela, troca de sessão e resposta realmente atrasada, canário/rollback autenticados |

## Operador protegido — bloqueio B14/P01

PR #201 permanece aberta com conflitos (`mergeable:false`, head `46186289723f6dfcdba323aa09cf15fb09ec1807`, consultada em 29/09/2026). Registry disponível nessa PR contém apenas CC-04. O framework não existe no baseline produto utilizado. Nenhuma suite CC-12 foi registrada ou executada remotamente nesta entrega.

Próxima implementação: resolver a PR201, confirmar contrato do registry e publicar workflow protegido em main. Adicionar suite CC-12 com preflight que confira SHA servido, schema0035, flags, allowlist, sessões de atores permitido/negado e permissões export resolvidas. Fixtures marcadas exclusivamente para QA, pelo menos 250 chamados autorizados e controles privados/cross-org. Disparar job, acompanhar até estado terminal, comparar manifesto/CSV com população bruta autorizada, revogar, exigir negação em histórico/status/download, testar TTL e limpar fixtures/objetos. Evidência deve conter SHA, run, IDs de fixture, contagens, checksums e comprovação de cleanup, sem cookies ou conteúdos privados. Dry-run nunca conta como aceite de produção.

## Pendências preservadas

- P02 CC03: comandos/triagem OFF e aceite adiado conforme orientação anterior.
- P03 CC04: ativação informada; provar CT11–13 e SHA servido. ACL não deve ser desligada como rollback.
- P04 CC05: QA visual, desempenho, CT14–17, deploy/ativação e documentação.
- P05 CC06: CT18–23 autenticados e operação de anexos.
- P06 CC07: Worker, cron, flags/cutoff/allowlist, entrega, CT24/25/15-B, lag/p95/CPU/D1.
- P07 CC08: reconciliação/CR, Worker, actor/allowlist, CT26–29/52, 90 MiB e retry.
- P08 CC09: CT30–32, sessão/org/upload, performance, cleanup e rollout.
- P09 CC10: aprovar fuso/calendário/metas/pausas/resposta/vigência e CT33–36.
- P10 CC11: aprovar h sem default, CT37–40, performance, cleanup e rollout.
- P11 CC13: causas/incidentes e ACL de vínculos; bloqueia CC12-C.
- P12 CC12: aprovação operacional D03–D07, review, quotas, donos nominais e janela.

Merges e migrations0030–0034 já registrados continuam concluídos; não reaplicar. Em particular0034 foi aplicada/pós-validada no run36579850932. Isso não encerra as pendências de produto/operação acima.
