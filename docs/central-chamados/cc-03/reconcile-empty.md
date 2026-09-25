# CC-03 — reconciliação de organizações sem fonte legada

## Evidência e ajuste de escopo

O inventário remoto fornecido pelo usuário (`6754ddce-adf2-4701-a587-6c72f3ee6656`, 25/09/2026 às 18:02 UTC) confirmou o D1 `maono_maps`, schema/ledger 0025/0026 íntegros e fonte elegível vazia para as organizações 3, 4, 6, 7, 8 e 9. Todos os marcadores estavam ausentes. A organização 3 já possuía dois chamados canônicos.

A consulta seguinte identificou os usuários ativos vinculados a cada organização:

| Organização | IDs elegíveis como fallback de uma importação |
|---|---|
| 3 — Demo Maono | 2, 4, 10 |
| 4 — MRA | Nenhum |
| 6 — Maõno Interno - Testes | 1 |
| 7 — Cliente Alfa - Testes | 2, 4, 5, 6, 7 |
| 8 — Cliente Beta - Testes | Nenhum |
| 9 — Maõno Preview QA | 1, 2, 10 |

O operador super admin é o ID 1. O modo `apply` exige fallback membro porque pode importar registros sem autoria válida. Essa autoria não é usada ao certificar uma fonte vazia. O novo modo explícito `reconcile-empty` atende essa operação distinta e não cria vínculos ou concede acesso. `apply` conserva integralmente a exigência de fallback membro ativo.

Não há nova migration, alteração de flag, merge ou escrita remota nesta preparação. As confirmações já recebidas para a 0026 de produção continuam válidas. O desenvolvimento das próximas PRs permanece no roadmap existente.

## Contrato do novo modo

- Uma organização explícita e ativa, operador super admin ativo, nome/UUID conferidos, schema/ledger válidos, bookmark atual e declaração real de pausa dos escritores.
- Não aceita `--fallback-user-id` e não chama o caminho de importação.
- Exige `sourceCount = 0`; fonte não vazia já importada também é recusada, mesmo com `pendingCount = 0`.
- Um único `INSERT ... ON CONFLICT ... DO UPDATE` revalida a contagem elegível, a organização e o operador no próprio SQL. Se a tabela de origem estava ausente, a cláusula verifica que ela continua ausente.
- Apenas `ticket_command_backfills` pode ser alterada. Chamados existentes, membros, permissões, ciclos, eventos, comandos, auditoria de atendimento e outbox são preservados. O relatório registra operador, organização, runId e bookmark.
- Marcador `ready` coerente com fonte zero não é regravado: `meta.changes = 0`, preservando o runId e timestamp anteriores. O replay executa a conferência/statement condicionado, sem alterações duráveis.
- A inspeção final revalida a fonte e o marcador. Origem surgida após o commit impede sucesso; o relatório informa a escrita já confirmada, sem alegar rollback. Resposta perdida é resultado desconhecido que exige inventário antes de nova operação.

## Execução piloto na organização 3

Atualizar primeiro o worktree para o commit publicado que contém este documento. As dependências não mudaram.

Antes da escrita, reservar uma janela sem alterações nos chamados: fechar as telas que podem acionar o caminho legado e pausar integrações/escritores. `--writers-paused` é a declaração do operador; o programa não pausa outros processos.

O bloco abaixo registra a reconciliação da organização 3 e a repete imediatamente. Os dois relatórios têm nomes novos. `Get-Content -Encoding UTF8` evita que o PowerShell interprete nomes UTF-8 usando a codificação ANSI da sessão.

```powershell
$ProdDbId = '5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'
$Resumo = @()
$Lote = Get-Date -Format 'yyyyMMdd-HHmmss'

foreach ($Etapa in @('reconciliacao', 'replay')) {
    $Arquivo = Join-Path (Get-Location).Path "cc03-org3-$Etapa-$Lote.json"
    node scripts/central-chamados/operator/backfill-d1.mjs `
      --mode reconcile-empty `
      --database-name maono_maps `
      --database-id $ProdDbId `
      --confirm-database-id $ProdDbId `
      --organization-id 3 `
      --operator-user-id 1 `
      --writers-paused `
      --report $Arquivo

    if ($LASTEXITCODE -ne 0) { throw "Falha na etapa $Etapa. Preserve o relatório e interrompa a operação." }
    $Dados = Get-Content $Arquivo -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $Dados.complete -or $Dados.final.sourceCount -ne 0 -or $Dados.final.marker.status -ne 'ready' -or $Dados.migrated -ne 0 -or $Dados.final.canonicalTotal -ne 2) {
        throw 'Resultado diferente do inventário aprovado. Interrompa e revise o relatório.'
    }
    if ($Etapa -eq 'replay' -and ($Dados.writesPerformed -or -not $Dados.reconciledReplay)) {
        throw 'O replay não confirmou ausência de novas alterações.'
    }
    $Resumo += [pscustomobject]@{ etapa=$Etapa; arquivo=$Arquivo; runId=$Dados.runId; complete=$Dados.complete; migrated=$Dados.migrated; writesPerformed=$Dados.writesPerformed; reconciledReplay=$Dados.reconciledReplay; canonicalTotal=$Dados.final.canonicalTotal; marker=$Dados.final.marker }
}
$Resumo | ConvertTo-Json -Depth 6
```

Não habilitar flags a partir desse piloto: as organizações 4, 6, 7, 8 e 9 continuam com evidências próprias pendentes. Após verificar os relatórios do piloto, repetir a operação explícita e o replay por organização; para as demais, o total canônico observado foi zero, mas deve ser conferido novamente antes da escrita.

Ao final, executar um único inventário geral. Exigir `allOrganizationsReady:true`, `pendingOrganizationIds:[]` e marcadores coerentes. Isso não substitui merge efetivo, versão publicada no alvo correto, QA autenticado e decisão separada de ativação. `releaseAuthorized` permanece false nos relatórios.

## Validação técnica

- 203 testes de comandos, backfill, operador e modo vazio aprovados em Node 24.19.0; inclui 19 casos novos do helper e 11 casos de integração do modo.
- Oito cenários Wrangler/D1 nativos locais aprovados, incluindo fonte surgida entre preflight e SQL, preservação de dois canônicos e organização sem membros.
- Casos de concorrência: fonte nova, tabela antes ausente que surge, revogação de super admin/organização, outro reconciliador vencedor, resposta perdida e fonte surgida após commit. Nenhum teste depende de credenciais de produção.
- Evidências: `evidence/reconcile-empty-tests.log`, `evidence/reconcile-empty-runtime.json`, [revisão independente](reconcile-empty-review.md).

Os ensaios comprovam a implementação local; nenhum marcador remoto é declarado gravado nesta entrega.
