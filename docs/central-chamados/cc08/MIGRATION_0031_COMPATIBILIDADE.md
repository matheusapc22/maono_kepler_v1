# CC-08 — compatibilidade SQL da migration 0031

## Evidência de produção em 2026-09-27

- Apply #22 (36356062710): WRANGLER_APPLY_FAILED, categoria SQLITE_SYNTAX, exit 1. O diagnóstico não preservou a instrução exata. Apply iniciado, conclusão não confirmada.
- Bookmark pré-apply: `000003a4-00000000-000050f3-3e168712b508af0c3a6bbc66eb2d58f3`.
- Postvalidate #23 (36356490437): 0031 ausente do ledger, quick_check=ok, nenhuma violação FK, nenhuma escrita.
- Audit #24 (36356674515): somente 0031 pendente; schema preflight compatível, digest `53a810828b36cc5505b3d8f48bc9c4454becb7fa32bf37fb9cf3941ac7f94ae8`, igual ao anterior. Isso não é uma comparação de todos os dados/objetos do banco.
- SHA auditado: `29bb5914a56b7748c16c2566acd8ca1857301ced`.

## Alteração proposta

Parentetizar as dez expressões SELECT CASE...END nos triggers da 0031 e no schema de instalação. A expressão, suas condições, mensagens RAISE e regras de negócio são preservadas. O UPDATE CASE fora dos triggers permanece igual.

Motivação: https://github.com/cloudflare/workers-sdk/issues/4727 documenta confusão do parser entre END de CASE e END de trigger e o contorno com parênteses. É um relato histórico fechado, não comprovação de que o serviço atual tenha o mesmo defeito. O código do Wrangler 4.140.0 usa caminhos distintos: local divide instruções antes de db.batch; migrations remotas enviam o SQL ao endpoint query. Sucesso local não reproduz necessariamente o parser remoto.

Esta alteração é uma proposta de compatibilidade. A categoria SQLITE_SYNTAX isolada não comprova a causa raiz da #22. Nenhuma aplicação remota foi feita para testar esta proposta.

## Validação

`node --test tests/ticket-changes.test.mjs tests/production-migration-gate.test.mjs`: 38 testes aprovados. Incluem schema novo/upgrade, integridade, transições, imutabilidade, histórico, versões e gates de autorização.

SHA-256 novo da migration: `f2bd9a08f29b67e54b80e976d020b2362677168968f9ed75da12b581bd247aac`.

## Continuidade

Após revisão/merge, executar novo audit da 0031 a partir de main. O SQL e Git SHA mudam: o approval anterior é inválido. Reportar o novo audit e obter autorização humana específica antes de qualquer apply. Manter flags desligadas e acceptance autenticado pendente. Não aplicar 0021/0022/0023. Em nova falha, parar escritas e preservar relatório/bookmark.
