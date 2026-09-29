# Migration CC14 — 0037_ticket_knowledge.sql

**Preparada e validada localmente; aplicação remota não executada.**

SHA256: `3c2a3f9f64513126fe2643ac5b0049aba5184d3254aff58188e753cfe806acb0`.

Schema aditivo: sete tabelas (`articles`, `revisions`, `sources`, `commands`, `events`, `uses`, `guard`) sob prefixo ticket_knowledge, índices e triggers de integridade, imutabilidade e geração. Sem DROP, backfill ou modificação de migrations anteriores. Depende de schema CC04/05/12/13, incluindo0035/0036. Verificar ledger e integridade no ambiente real.

Após merge, usar Actions → **Production D1 migration operator**, branch `main`, modo `audit`, arquivo `0037_ticket_knowledge.sql`. O produto continua a branch `mano_kepler_v1`; registrar seu SHA completo pinado. Não confundir SHA do dispatcher com SHA do produto.

Seguir AGENTS.md: reportar nome/hash SQL, Git SHA, D1 `maono_maps` / `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`, risco/operações, ledger, pendências anteriores, pending digest, quick_check, foreign_key_check, bookmark Time Travel, caminho do relatório e approval hash. **Parar e aguardar autorização humana posterior ao audit para a SQL/hash exata.**

Somente então despachar `apply` com a mesma SQL/hash; o workflow reaudita drift e aplica uma única migration com diretório temporário. Credencial de escrita fica exclusivamente no Environment protegido `production-d1-migrations`. Não solicitar token ao runtime geral.

Depois, confirmar ledger/applied_at, quick_check=ok, FK sem violações, bookmark e post-apply.json. A migration0036 já foi aplicada e não deve ser reaplicada. Outras pendências exigem audit/autorização próprios.

Contenção: `MAONO_TICKET_KNOWLEDGE_ENABLED=false`, preservando ACL e leitura da proveniência nas mensagens. Schema aditivo permanece; não apagar histórico. Restauração Time Travel exige procedimento específico considerando todas as escritas posteriores. Apply não autoriza rollout nem dispensa aceite autenticado.
