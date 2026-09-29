# Migration CC15

Arquivo: `0038_ticket_feedback.sql`. Adiciona instrumentos, convites, respostas, eventos, retiradas, guard e índices/triggers; não altera as migrations0010–0037 nem cria convites históricos. Preserva os fluxos CC03–CC14. Risco: expansão de schema e novos registros imutáveis/FKs; retenção depende de política posterior. O preflight CC15 verifica ledger/dependências/colunas, conflitos de objetos parciais e digest de schema revalidado antes de apply.

Banco: `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`. Produto: `mano_kepler_v1`. Operador: `.github/workflows/production-d1-migration-operator.yml`, disparado de `main`, Environment `production-d1-migrations`.

1. Após merge, fixar Git SHA de40 caracteres e SHA256 do arquivo. Conferir ambiente/token apenas no operador protegido.
2. Disparar `audit` para somente0038. Relatar SHA do produto/SQL, identidade D1, digest das pendentes, migrations anteriores pendentes, integridade, bookmark Time Travel, caminho do relatório e approval hash.
3. PARAR e aguardar autorização humana específica da0038 com o hash do audit. A ordem “Execute CC15” não autoriza este write.
4. `apply` isolado, com re-audit e validação de drift. Não apontar executor genérico para toda a pasta migrations.
5. Registrar ledger/applied_at, quick_check=ok, foreign_key_check vazio, bookmark e relatório. PARAR novamente. A0037 já aplicada não deve ser reaplicada.

Contenção: desligar somente feedback e interromper reconciliação. Não desligar ACL, não bloquear fechamento e não apagar histórico. Para recuperação estrutural, operador revisa o bookmark e impacto em todos os dados posteriores antes de restaurar; não existe down automático destrutivo. Nenhuma credencial de produção foi solicitada ou carregada no agente.
