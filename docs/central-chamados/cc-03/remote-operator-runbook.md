# CC-03 — próximo passo após aplicar a 0026

## Situação confirmada em 25/09/2026

O usuário esclareceu: **foi feita a migration, não o merge**. A PR #196 continua separada. O banco informado é `maono_maps`, binding `DB`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`.

Na conversa de validação, o usuário apresentou a 0026 no ledger `d1_migrations`, ID 20, `applied_at = 2026-09-25 17:10:33` UTC (14:10:33 BRT), as cinco tabelas novas, `foreign_key_check` sem linhas e `quick_check = ok`. Esse registro é confirmação do operador, não leitura D1 feita por este agente. A 0025 já havia sido confirmada. Não reaplicar 0026 nem incluir 0021/0022/0023 nesta operação.

O próximo gate é conciliar a fonte legada por organização e registrar seu marcador de prontidão. Depois vêm a versão da aplicação realmente publicada, QA autenticado e ativação explícita. **Manter `MAONO_TICKET_COMMANDS_ENABLED` desligada nesta etapa.** Aplicar schema ou executar backfill não altera flags nem faz merge.

## O que foi acrescentado

O executor `scripts/central-chamados/operator/backfill-d1.mjs` conecta o job já entregue ao D1 remoto usando o binding de Wrangler. Ele roda como processo Node na máquina do operador, sem criar rota de produto ou publicar um Worker de operação.

O pacote de Wrangler fica isolado em `scripts/central-chamados/operator`, com versão e lockfile próprios. O programa gera uma configuração temporária contendo somente o binding `DB`, UUID/nome explícitos e `remote:true`; confere a identidade retornada por `wrangler d1 info` antes de acessar os dados. Usa `getPlatformProxy` e o `DB.batch` original: não transforma uma transação em comandos SQL individuais pela rede.

O modo padrão é **inventário somente leitura**. A aplicação exige uma organização, operador super admin ativo, autor substituto ativo pertencente à organização, confirmação literal do UUID e declaração explícita da pausa dos escritores. Antes da escrita, consulta um bookmark atual de Time Travel e o registra no relatório; isso não é um teste de restauração nem executa restore.

O executor não lê/escreve valores das flags do Pages, não concede permissões, não aplica migrations, não ativa notificações e não faz merge/deploy. Não passa a considerar todo o ambiente pronto após processar uma organização.

**Correção de 25/09/2026:** o primeiro inventário de produção no commit `61fe77e` foi bloqueado por um defeito na captura do JSON do Wrangler. Atualizar para a correção descrita em [operator-json-fix.md](operator-json-fix.md) antes de repetir. Preservar o relatório anterior e escolher outro nome; não reaplicar migrations nem reinstalar dependências, pois o lockfile não mudou.

## 1. Obter o código em uma pasta separada

PowerShell, a partir do seu repositório. A pasta separada evita misturar a operação com alterações locais. Estes comandos não fazem merge:

```powershell
Set-Location 'C:\maono_dev\Dev_Plataform_Maono\maono_kepler_v1'
git fetch origin feat/cc-03-ticket-command-lifecycle
if ($LASTEXITCODE -ne 0) { throw 'Falha ao obter a branch da CC-03.' }

$OperatorSha = (git rev-parse FETCH_HEAD).Trim()
$OperatorRoot = Join-Path $env:USERPROFILE ('Maono-CC03-Backfill-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
git worktree add --detach $OperatorRoot $OperatorSha
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar a pasta isolada.' }
Set-Location $OperatorRoot

node --version
npm.cmd --prefix scripts/central-chamados/operator ci
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o operador.' }

$Wrangler = Join-Path $OperatorRoot 'scripts/central-chamados/operator/node_modules/wrangler/bin/wrangler.js'
node $Wrangler whoami
```

Usar Node compatível com o pacote (mínimo declarado em seu `package.json`). Se `whoami` não estiver autenticado, executar `node $Wrangler login` e concluir o login na conta correta. Não colar tokens ou cookies no chat. Se houver múltiplas contas, usar o `--account-id` correto nas chamadas do operador; a identidade nome/UUID ainda será conferida.

## 2. Fazer o inventário, sem escrita D1

```powershell
$ProdDbName = 'maono_maps'
$ProdDbId = '5bc4dc32-f3bd-4c92-bbd1-cbda63e467db'
$ReportDir = Join-Path $OperatorRoot 'cc03-relatorios'
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
$InventoryPath = Join-Path $ReportDir ('inventario-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')

node scripts/central-chamados/operator/backfill-d1.mjs `
  --database-name $ProdDbName `
  --database-id $ProdDbId `
  --report $InventoryPath

if ($LASTEXITCODE -ne 0) { throw 'Inventário não aprovado; leia o relatório antes de continuar.' }
Get-Content $InventoryPath -Raw
```

Ler o relatório para identificar as organizações alcançadas e os IDs elegíveis. Para detalhar uma organização e seus possíveis autores substitutos, repetir o inventário com `--organization-id ID_REAL` e **outro nome de relatório**. Não preencher IDs por adivinhação; cada relatório é criado exclusivamente e não sobrescreve evidência anterior.

O inventário confere schema e ledger necessários. Zero pendências de importação não equivale a `ready`: uma organização sem fonte ou sem legado também precisa de uma execução explícita para gravar a reconciliação zero. Organizações inativas não são liberadas automaticamente; se voltarem a ser utilizadas, devem ser conciliadas.

No inventário, `complete:true` significa que a consulta terminou. A prontidão está em `allOrganizationsReady` e `pendingOrganizationIds`, calculados a partir dos marcadores e contagens atuais. Mesmo com todas prontas, `releaseAuthorized:false` preserva os demais gates de release.

## 3. Preparar a janela de reconciliação

Antes de executar `apply`, combinar uma janela em que usuários e integrações não alterem chamados legados/canônicos. Pausar os escritores antigos identificados e encerrar as telas que acionam importação por leitura. `--writers-paused` é uma declaração do operador de que essa pausa foi feita; o programa não bloqueia sozinho outras aplicações ou pessoas.

Escolher os IDs a partir do inventário: `--operator-user-id` identifica quem conduz a operação e precisa ser super admin ativo; `--fallback-user-id` identifica o autor substituto explícito para registros cuja autoria válida não é conhecida, devendo ser ativo e membro da organização. A procedência registra essa substituição, sem afirmar que essa pessoa criou originalmente o Ticket.

O bookmark pré-migration anteriormente informado não deve ser confundido com o ponto atual pré-backfill. O executor consulta um bookmark novo no começo da aplicação. Se não conseguir obter identidade, schema/ledger, atores ou bookmark, encerra antes de importar.

## 4. Aplicar a uma organização

O bloco abaixo pede os IDs já conferidos, sem oferecer valores fictícios como padrão:

```powershell
$OrgId = Read-Host 'ID da organização conferida no inventário'
$OperatorUserId = Read-Host 'ID do super admin ativo que executa a operação'
$FallbackUserId = Read-Host 'ID do autor substituto ativo e membro desta organização'
$ApplyPath = Join-Path $ReportDir ('aplicacao-org-' + $OrgId + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')

node scripts/central-chamados/operator/backfill-d1.mjs `
  --mode apply `
  --database-name $ProdDbName `
  --database-id $ProdDbId `
  --confirm-database-id $ProdDbId `
  --organization-id $OrgId `
  --operator-user-id $OperatorUserId `
  --fallback-user-id $FallbackUserId `
  --writers-paused `
  --page-size 50 `
  --max-pages 10 `
  --report $ApplyPath

$ApplyExitCode = $LASTEXITCODE
Get-Content $ApplyPath -Raw
Write-Host "Código de saída: $ApplyExitCode"
```

Executar esse bloco **somente após a pausa combinada**. O programa trabalha por páginas limitadas; pode importar apenas parte do lote. `complete:true`, as contagens e o marcador final são os critérios, não a ausência de erro visual. Se houver mais páginas, repetir com novo relatório e os mesmos IDs: identidades já importadas não são duplicadas. Em falha, conservar relatório e resolver a causa antes de repetir; não apagar Tickets/eventos para simular rollback.

Cada nova linha legada é uma transação com Ticket, comando, evento, auditoria e outbox. Linhas completas de páginas anteriores permanecem duráveis se uma página posterior falhar. O relatório distingue o total desta execução dos resultados da página que falhou.

Em falha de rede após um commit, `migrated` é o **mínimo confirmado**, não prova de ausência de escrita: `commitOutcomeUnknown:true` exige novo inventário/reconciliação. Falha ao atualizar o relatório interrompe novas páginas; o JSON também é emitido em stdout. Não interpretar erro de processo como rollback de toda a execução.

## 5. Validar reexecução e cobertura

Para cada organização processada:

- Reexecutar o mesmo `apply` em novo arquivo de relatório: `reconciledReplay:true`, `migrated = 0`, `writesPerformed:false` e marker `ready` demonstram a reconciliação sem duplicação. No replay, as contagens estão em `organizations[0]`; após uma aplicação com páginas, também há a inspeção `final`.
- Verificar `sourceCount = canonicalCount`, `pendingCount = 0`, `marker.skippedCount = 0` e `marker.completedAt`/`marker.runId` preenchidos (no banco: `completed_at`/`last_run_id`).
- Comparar os totais antes/depois, os IDs legados e a procedência. Não confundir `canonicalTotal` (inclui Tickets novos) com `canonicalCount` (somente identidades legadas elegíveis).
- Fazer outro inventário geral e guardar os relatórios com o SHA usado. A flag é por ambiente: **todas as organizações ativas alcançadas precisam estar prontas**, não só a testada.

A reconciliação compara identidades e contagens. Não sobrescreve Tickets canônicos existentes nem prova que seu conteúdo é uma cópia byte a byte da fonte: o atendimento pode tê-los alterado legitimamente. Divergência semântica suspeita exige análise específica; não corrigir textos/status em massa. Uma nova linha legada depois da reconciliação invalida o gate de prontidão até nova execução explícita.

## 6. Quando considerar a ativação

Somente depois de: reconciliação de todas as organizações alcançadas; reexecução sem duplicações; PR da CC-03 efetivamente mergeada e versão correspondente publicada no ambiente correto; binding conferido; QA autenticado da jornada e dos perfis; evidências registradas no controle.

Depois disso, habilitar a triagem e considerar `MAONO_TICKET_COMMANDS_ENABLED=true` pelo procedimento separado de release. Não usar Preview como prova de isolamento nem habilitar `MAONO_PREVIEW_MUTATIONS_ENABLED`. O operador não altera nenhuma dessas flags.

Manter os writers antigos pausados até concluir a decisão de cutover ou encerrar formalmente a janela. Se a ativação for adiada e a operação normal retomada, fazer nova reconciliação antes de ativar. Organizações criadas depois também precisam de marcador explícito.

## Referências de implementação

- [Backfill e regras de procedência](backfill-runbook.md)
- [Implantação e rollback da CC-03](migration-runbook.md)
- [Aceite complementar](operator-acceptance.md) e [revisão independente](operator-review.md)
- [Cloudflare: getPlatformProxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)
- [Cloudflare: bindings remotos, incluindo D1](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)
- [Cloudflare: comandos de Time Travel](https://developers.cloudflare.com/d1/wrangler-commands/#d1-time-travel-info)

Os recursos remotos exigem a autenticação Cloudflare da máquina que executa o operador. A preparação e os ensaios locais não afirmam que o backfill remoto foi executado.
