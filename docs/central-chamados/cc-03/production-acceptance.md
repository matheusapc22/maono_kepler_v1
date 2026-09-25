# CC-03 — Production Acceptance controlado

## Decisão operacional e estado do gate

Em **25/09/2026 às 17:04:56 BRT**, o usuário dispensou homologação com D1 fisicamente separado neste ciclo e definiu **Production Acceptance controlado**, diretamente em Produção / `maono_maps`. O risco adicional foi aceito sob escopo limitado, dados identificáveis de teste, rastreabilidade, possibilidade de correção, monitoramento e interrupção diante de comportamento inesperado.

Essa decisão substitui a exigência anterior de homologação isolada. Sua ausência deixa de ser bloqueio. O gate passa a **Production Acceptance controlado — Pendente de execução**. Build, CI, Preview e merge continuam independentes do aceite real.

O registro final solicitado pelo usuário somente será utilizado após comprovação dos fluxos: “Homologação isolada dispensada por decisão operacional. Acceptance executado diretamente no ambiente real/produção, com risco adicional conhecido e aceito, condicionado à execução controlada, rastreabilidade das evidências e manutenção dos gates independentes de migrations e rollout.” Até lá, registrar preparação e resultados parciais, sem afirmar acceptance executado.

### Evidências preservadas

- Banco: `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`.
- 0025/0026 aplicadas e verificadas no alvo, conforme relatórios recebidos. A decisão não reabre esses gates e não autoriza nova migration. Qualquer migration adicional permanece **PENDENTE DE CONFIRMAÇÃO** até evidência de aplicação autorizada no alvo correto. 0021/0022/0023 continuam fora desta operação.
- Reconciliação das organizações 3, 4, 6, 7, 8 e 9 concluída, com replays aprovados. Inventário final `0ff77c11-2f5d-477c-9ec6-51c68e38ba0b`, em `2026-09-25T19:52:24.803Z`: todas prontas, nenhuma pendência, dois chamados canônicos na organização 3 e zero nas demais.
- A organização “Maõno Preview QA” é um registro no banco de produção. A política de proteção do Preview permanece válida; o alvo desta decisão é Produção.

## Primeira operação: conferir o alvo sem escrita

Registrar projeto Pages, URL canônica de produção, branch, deployment, SHA integral, binding `DB` e flags observáveis. Configuração desejada de projeto e configuração disponível do deployment são evidências distintas. Campo ausente ou armazenado como segredo significa **desconhecido**, não `false`. Se o deployment mudar durante a leitura, repetir a conferência.

Projeto esperado: `maono-kepler-v1`; conta `09d455fa1cf988b0d9db89987b73eaff`, identificada no link Pages do GitHub e a confirmar pela consulta autenticada. O programa abaixo usa o Wrangler fixado já instalado, captura a credencial somente em memória e faz apenas GETs de metadados do Cloudflare. O relatório separa configuração de produção, deployment canônico e campos não comprovados. `readComplete/ok` dessa inspeção não significa acceptance ou rollout aprovado.

Depois de atualizar o worktree para o commit que contém este programa, executar no computador autenticado:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $ShaEsperado = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao identificar o commit local.' }
    $Relatorio = Join-Path (Get-Location).Path ('cc03-producao-preflight-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')
    $Erros = "$Relatorio.stderr.txt"
    $Codigo = $null
    try {
        $ErrorActionPreference = 'Continue'
        $Saida = & node scripts/central-chamados/operator/production-preflight.mjs `
          --account-id 09d455fa1cf988b0d9db89987b73eaff `
          --project-name maono-kepler-v1 `
          --expected-database-id 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db `
          --expected-commit $ShaEsperado `
          --report $Relatorio 2> $Erros
        $Codigo = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = 'Stop' }
    if ($Saida) { Write-Host ($Saida -join [Environment]::NewLine) }
    if (Test-Path -LiteralPath $Relatorio) {
        Write-Host "Relatório: $Relatorio"
    }
    if ($null -eq $Codigo -or $Codigo -ne 0) {
        if (Test-Path -LiteralPath $Erros) { Get-Content -LiteralPath $Erros -Raw | Write-Host }
        throw "Conferência incompleta. Preserve: $Relatorio e $Erros"
    }
}
```

A primeira conferência compara o deployment com a implementação proposta no worktree. Se a publicação usar um commit de merge/release diferente, a conferência da janela deve receber esse SHA integral confirmado em `--expected-commit`. Uma divergência inicial identifica trabalho de conferência/publicação; não autoriza redeploy e não significa falha de migration.

A API Pages pode não oferecer prova do binding efetivo do deployment. Nesse caso, registrar a limitação e conferir a configuração efetivamente publicada por evidência autenticada, sem promovê-la a verificada por inferência. `/api/health` não fornece UUID do D1 ou todas as flags CC-03. A dispensa de homologação não executa merge/deploy automaticamente; primeiro identificar a versão no alvo e então preparar qualquer publicação necessária. Não reclassificar Preview como `production` para contornar sua política.

## Janela, atores e limites

1. Revalidar banco, SHA publicado, sessão e operador. Candidatos: **organização 6 — Maõno Interno - Testes**, **operador 1 — Matheus Andrade**. Sua vinculação já foi observada; atividade/permissões ainda precisam ser conferidas na janela. Não conceder acesso apenas para fazer um teste passar.
2. `MAONO_TICKET_COMMANDS_ENABLED` permanece **false fora da janela**. A flag é global por ambiente, sem allowlist de organização/ator. Escolher a org6 limita os dados do roteiro, mas não a disponibilidade às demais organizações: coordenar usuários e pausar outros escritores da Central durante a janela.
3. Antes de ativar, registrar operador de teste, responsável pelo desligamento, início, duração máxima e canal de interrupção. Ao atingir o prazo, encerrar a janela mesmo com roteiro incompleto.
4. Capturar restore point/bookmark atual e configuração anterior. Restaurar integralmente o D1 requer decisão própria e reconciliação das alterações posteriores; o bookmark não autoriza rollback automático.
5. Repetir inventário de prontidão se escritores foram retomados, ou organizações/legados surgiram. Conferir schema/ledger sem reaplicar migrations. Nenhum marcador é presumido a partir de um resultado antigo.
6. Na janela autorizada, triagem habilitada antes de comandos. Confirmar a configuração do deployment em execução. Ao encerrar, comandos voltam a false; não reverter a triagem arbitrariamente se ela já integra a operação aprovada.

O primeiro lote usa **um único chamado novo**, com prefixo `CC03-PA-<UTC>-<identificador>`, descrição inequívoca de teste e nenhum dado de cliente. Congelar chave e payload antes do primeiro POST; todos os passos seguintes usam exclusivamente o ID retornado. Não substituir a fixture por chamado real nem criar outro chamado diante de resposta incerta.

Não alterar projetos, MapConfig, anexos/Dropbox, grants ou membros nesse lote. Registros de teste permanecem identificados e encerrados: hard delete não é limpeza compatível com a trilha da CC-03. Sessões e credenciais ficam no computador do operador; não copiar cookies, tokens ou cabeçalhos de autorização para evidências compartilhadas.

## Roteiro principal por API

Base `B = /api/organizations/6/tickets`, chamado `T`, execução `R`. Usar o host de produção confirmado e a sessão real. Obter o ETag opaco atual em `GET B/T/state` antes de mutações; não derivá-lo da versão nem trocá-lo silenciosamente após conflito. Leituras de lista/detalhe antes do cutover podem acionar importação legada; não classificá-las genericamente como livres de DML.

Criação com `Idempotency-Key: R`:

```json
{
  "subject": "<R> — aceite técnico controlado",
  "description": "Registro fictício para validar a CC-03; sem demanda real.",
  "category": "map",
  "priority": "normal",
  "assignedTo": 1,
  "demandNature": "question_request",
  "expectedResult": "Validar o ciclo técnico sem alterar dados existentes.",
  "context": "Acceptance controlado em produção autorizado.",
  "impact": "individual",
  "urgency": "flexible",
  "priorityReason": "Prioridade normal para teste controlado.",
  "triageAnswers": {},
  "triageFormVersion": 1,
  "nextAction": "Executar o roteiro de aceite."
}
```

| Comando persistido | Requisição | Esperado |
|---|---|---|
| 1 | `POST B`, payload acima e chave estável. | 201, um chamado, versão 2, ciclo 1. |
| 2 | Exatamente dois `PATCH B/T` simultâneos, mesmo ETag, `nextAction` sintética CAS-A/CAS-B. | Um 200 e um 412; somente um comando vencedor, versão 3. Não repetir o perdedor. |
| 3 | `POST B/T/transitions`: `status:open`, próxima ação de teste. | Versão 4; triagem/responsável válidos. |
| 4 | Mesma rota: `status:in_progress`, próxima ação. | Versão 5. |
| 5 | `POST B/T/waits`: `action:start`, motivo de teste, `responsibleId:1`, próxima ação. | Versão 6; um intervalo. |
| 6 | Mesma rota: `action:end`, motivo e próxima ação. | Versão 7; intervalo encerrado. |
| 7 | Transição `in_review`, com evidência sintética e próxima ação. | Versão 8. |
| 8 | Transição `closed`, com fechamento fundamentado de teste. | Versão 9; ciclo 1 encerrado. |
| 9 | `POST B/T/reopen`, motivo e próxima ação. | Versão 10; ciclo 2, preservando conclusão anterior. |
| 10 | `POST B/T/events/E/corrections`, onde E é o evento de criação desse chamado; motivo e complemento sintéticos. | Versão 11; evento corretivo novo, original intacto. |
| 11 | Transição `closed` para encerrar o teste. | Versão 12; dois ciclos encerrados. |

Nos dois fechamentos, usar `closure` com `outcomeCode:no_action`, `summary`, `evidence` e `communication` explicitando a execução R e o teste, e `pendingChangeAcknowledged:false` porque esse lote não contém CR. Comunicação significa registro conferido pelo próprio operador, sem afirmar mensagem externa enviada.

Casos intercalados previstos, sem comando persistido adicional:

- Repetir a criação com exatamente o mesmo payload/chave: 201, `Idempotency-Replayed:true`, mesma resposta original. Repetir depois do CAS também retorna a resposta original versão 2, sem reverter o estado atual; reobter `/state` antes de continuar.
- Reusar a chave com assunto diferente: 409. Não criar outra chave para contornar a rejeição.
- PATCH sem `If-Match`, após criar o chamado com ciclo: 428. Transição `new → in_review`: 409. Iniciar espera já ativa: 409.
- GET `/state`: 200, ETag forte, `Content-Location` correspondente e `Cache-Control: private, no-store`. Comparar evidências antes/depois das leituras feitas após cutover.

**Não testar criação sem chave em produção:** se a flag desligar, esse POST poderia cair no caminho anterior não idempotente. Essa cobertura permanece nos testes locais/CI. A primeira criação e todas as suas repetições sempre levam a chave original.

Timeout, perda de conexão, resposta incompleta, 5xx, entidade adicional ou qualquer resultado fora do caso previsto interrompem o lote. Preservar intenção, chave, payload e evidências; conferir API/banco antes de decidir retomada. Não há retry mutante automático. Negativos esperados só são aceitos no passo que explicitamente os prevê.

## Evidência persistida e demais gates

Consultar D1 somente por leitura, sempre filtrando organização 6 e o ID T validado. Não exportar `result_json` ou conteúdo de terceiros integralmente. Para o roteiro exato, a expectativa é: 11 comandos, 11 eventos, 11 auditorias de sucesso e 11 intenções de outbox; versões 2 a 12; ator 1; dois ciclos encerrados; uma espera encerrada. Qualquer intervenção adicional deve ser registrada e exige revisar essas expectativas.

```sql
-- Substituir :T pelo ID numérico conferido; não executar como script de mutação.
SELECT id, organization_id, status, version, current_cycle_number,
       active_wait_json IS NOT NULL AS active_wait,
       closure_json IS NOT NULL AS has_closure
FROM organization_tickets WHERE organization_id=6 AND id=:T;

SELECT
 (SELECT count(*) FROM ticket_commands
  WHERE organization_id=6 AND json_extract(result_json,'$.state.id')=:T) AS commands,
 (SELECT count(*) FROM ticket_events
  WHERE organization_id=6 AND ticket_id=:T) AS events,
 (SELECT count(*) FROM audit_logs
  WHERE json_extract(details,'$.organizationId')=6
    AND json_extract(details,'$.resourceId')=:T
    AND json_extract(details,'$.result')='success'
    AND json_extract(details,'$.commandId') IS NOT NULL) AS success_audits,
 (SELECT count(*) FROM ticket_command_outbox
  WHERE organization_id=6 AND ticket_id=:T) AS outbox;

SELECT operation, actor_user_id, response_status,
       json_extract(result_json,'$.state.version') AS version
FROM ticket_commands
WHERE organization_id=6 AND json_extract(result_json,'$.state.id')=:T
ORDER BY version;

SELECT cycle_number, origin, opened_at, closed_at,
       closure_json IS NOT NULL AS has_closure
FROM ticket_cycles WHERE organization_id=6 AND ticket_id=:T
ORDER BY cycle_number;

SELECT cycle_number, responsible_id, started_at, ended_at, ended_by
FROM ticket_wait_intervals WHERE organization_id=6 AND ticket_id=:T;
```

Comparar o evento E antes/depois da correção e conferir sua referência no evento corretivo. Inspecionar definições dos triggers por leitura de `sqlite_master`; não provocar UPDATE/DELETE de histórico em produção. Logs de negação são separados da auditoria de comando bem-sucedido. Outbox pendente é intenção, não comprovação de mensagem entregue.

O lote principal **não encerra sozinho** o acceptance:

| Frente adicional | Evidência exigida |
|---|---|
| Permissões | Sessões reais de perfil com leitura sem gestão e de usuário sem acesso à organização; negação de comando/leitura e ausência de efeito de sucesso. Super admin não comprova essas restrições. Se faltarem atores, manter o caso pendente, sem inventar grants. |
| CR pendente | Fixture sintética identificada e autorizada antes da escrita; fechamento recusado sem ciência, aceito com ciência, preservando estado/aprovação do CR. Não usar CR de cliente, Review/Apply ou mudança de MapConfig. Fixture ausente mantém esse caso pendente. |
| Interface | Jornada e conflito/rascunho preservado no deployment real, com capturas identificando o chamado de teste. HTTP simulado local não substitui esse aceite. |
| Encerramento da janela | Comandos desligados na configuração publicada; replay da mesma criação/payload/chave retorna 503 sem novo chamado. Replay 201 significa desligamento ainda não comprovado: parar e reconferir. |

Fault injection, corrupção de schema, stress, exclusão e restauração integral permanecem fora desse lote. A validação local de falhas transacionais complementa a evidência, mas não deve ser rotulada como execução em produção.

### Conferência local do roteiro

Na preparação, passaram **231 testes locais**, incluindo os **28 testes do novo preflight**, sem falhas ou casos ignorados. A revisão independente não identificou bloqueios P0/P1. O preflight foi exercitado com fixtures; não houve autenticação real nem consulta Cloudflare nessa validação. O workflow de contratos passa a executar esses testes nas alterações do operador.

Uma simulação independente usou as rotas HTTP reais e SQLite em memória para a organização 6/ator 1. O caso passou, confirmando a sequência de 11 comandos, as quatro contagens 11, versões 2–12, dois ciclos encerrados, uma espera encerrada, CAS 200/412, replays antes/depois da edição, negativos previstos e 503 após desligamento. O evento original e a conclusão do primeiro ciclo foram preservados, e as consultas de conferência foram exercitadas na fixture. Essa simulação comprova a coerência do roteiro, **não execução em produção**.

## Registro e fechamento da janela

Cada caso registra execução/horário, host/deployment/SHA, banco/binding comprovados, organização, ator, método/rota, correlação, resultado esperado/observado, ETags, IDs de entidades/comandos/eventos, consultas, screenshot quando pertinente e motivo de interrupção. Remover credenciais e dados de terceiros antes de compartilhar.

Ao concluir ou interromper: suspender novas ações, desligar comandos, comprovar configuração e registrar estado dos testes. Chamados com ciclo adotado ficam sem edição de core enquanto a flag estiver desligada; não restaurar writer antigo irrestrito. Se uma fixture ficar aberta por falha, preservar seu ID para correção em janela posterior, sem limpeza destrutiva ou alegação de rollback de efeitos duráveis.

Atualizar separadamente decisão operacional, migrations, dados, versão publicada, janela/flags, casos funcionais, perfis, CR, UI e revisão humana. Caso obrigatório sem evidência mantém acceptance pendente. Rollout permanente exige sua própria decisão; término de testes não mantém a flag habilitada automaticamente.

Referências: [contratos](api-contract.md), [implantação/rollback](migration-runbook.md), [reconciliação](reconcile-empty.md), [operador D1](remote-operator-runbook.md).

Referências do preflight: [API Pages — projeto](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/), [API Pages — deployment](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/get/) e [Wrangler — comandos de autenticação](https://developers.cloudflare.com/workers/wrangler/commands/general/).
