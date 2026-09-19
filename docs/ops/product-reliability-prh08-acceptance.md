# PRH-08 — Final Reliability/UX, Chaos/E2E e SLO

## Base, escopo e estado

Base de implementação: `mano_kepler_v1`, merge PRH-07 #170, commit `0843881070a94f5366367092bb24f8d22ac121a9` (19/09/2026). O aceite separa implementação/testes de ativação e observação em Production. CI ou merge não comprovam rollout ou SLO.

Nenhuma migration nova ou alteração na 0009. Dependência: D1 Production `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`, conta `09d455fa1cf988b0d9db89987b73eaff`. O operador não chama `d1 migrations apply`.

Evidência remota fornecida pelo operador humano em 19/09/2026:

- Histórico `d1_migrations`: id 14, `0009_organization_storage_invariant.sql`, `2026-09-01 20:28:42`.
- Três colunas TEXT nullable e índice de `storage_status` presentes.
- Status ausente: 0. Organizações: 3 inativas DISABLED, 1 ativa PENDING, 5 ativas READY.
- ID 9 QA: raiz `/Apps/MaonoKepler/preview/qa`, READY. Criada em 06/09, depois do registro da migration. Seu estado não prova falha da aplicação de 0009 nem existência física das pastas.

Não reaplicar 0009. Identificar idade/causa da organização PENDING e revisar política/inventário físico da QA. Não renomear sua raiz no D1, não adotar/excluir órfãos e não marcar READY manualmente. O deployment efetivo do Worker e o binding da aplicação precisam de evidência do ambiente.

## Mudanças de comportamento

1. Recuperação preserva roots; paths que exigem decisão ficam bloqueados. Readiness permanece consulta de estado, sem chamadas Dropbox ou reparo durante leitura.
2. Claim contém incidente e tentativas persistentes; conclusão protege token, timestamp e root. Resposta atrasada não substitui novo claim. Falhas permanentes e orçamento esgotado exigem investigação operacional.
3. Conflito Dropbox só é sucesso se o objeto existente for pasta. READY exige provisionamento da estrutura `documents`.
4. Edição de metadados usa comparação do estado lido; não desfaz desativação ou alteração de caminho concorrente. Organização QA pode ser editada/desativada sem mudar a raiz e sem falso storageReady.
5. Interface usa mensagens seguras e respeita retryable=false. Falhas de documentos não são apresentadas como lista vazia; arquivo selecionado permanece disponível para tentativa explícita, sem duplicação automática.
6. Observações sanitizadas de criação, tentativa, falha e operação são gravadas em `audit_logs`. Falha de telemetria não desfaz provisionamento já realizado; torna incompleta a evidência do SLO.

## Verificação local e CI

```sh
npm install --legacy-peer-deps --no-audit --no-fund
npm run test:reliability
npm run test:foundation-gate
node scripts/audit-user-error-sinks.mjs --baseline scripts/user-error-sink-baseline.json --strict-baseline
npm run build
npx playwright install --with-deps chromium
npm run test:reliability-browser
```

O gate Product Reliability UX cobre backend, scripts e fixtures, além da UI. Chaos usa SQLite em memória para validar SQL e concorrência; mocks de provider injetam timeout, 429, 5xx, conflito e interrupção. Playwright exercita componentes reais com respostas controladas. Esses testes não comprovam autorização Dropbox, binding Production ou SLO remoto.

## Matriz de revisão e aceite

| Fluxo | Proteção / evidência |
| --- | --- |
| Criar/retomar organização | Persistência anterior ao provider; identidade sem duplicação; denominador de criação antes de falha |
| Atualizar/desativar | Snapshot comparado no UPDATE; metadados não reativam organização concorrente |
| Readiness / documentos / tickets | Leitura sem healing; autorização existente preservada; erro seguro |
| Projeto, save e loading | Gates existentes de foundation/save/loading; rascunho e trava contra operação simultânea |
| Reparo periódico/seletivo | Policy compartilhada, lease/CAS, orçamento persistente, falhas permanentes bloqueadas |
| Dropbox | Conflito de arquivo não equivale a pasta; `documents` obrigatório |
| Navegador | Estado indisponível distinto de vazio; retenção de upload e proteção contra resposta de outra organização |
| Operador | Target fixo; empacotamento local dos modos; preflight remoto read-only; baseline disabled e retorno a disabled se ativação falhar |
| SLO | Inventário independente + audit export; cobertura e amostra verificadas; sem dados nunca PASS |

## Ativação controlada (pendente de evidência real)

1. Merge da PRH-08 após gates. Disponibilizar apenas o workflow de operação na default branch `main` via PR de bootstrap. O workflow faz checkout do SHA auditado de `mano_kepler_v1`; não transportar a aplicação inteira para main.
2. Confirmar aplicação e Worker vinculados ao mesmo Production `maono_maps`. Confirmar secrets sem expô-los nos logs. Não habilitar mutações de Preview e não fabricar sessão QA.
3. Rodar operador `validate`, depois `deploy_disabled`. Guardar SHA, resultado e config. Não afirmar ativação por sucesso de build.
4. Rodar `deploy_dry_run` com evidência da 0009. Preflight consulta histórico/schema/identidade e captura bookmark; guardar artefato. Conferir candidatos, bloqueios, contador e correlação em execuções reais. Dry-run grava audit_logs.
5. Inventariar QA e organização PENDING. Caminhos protegidos permanecem report-only. Antes de `deploy_apply`, estabelecer janela operacional e ponto de recuperação recente; bookmark D1 não restaura arquivos Dropbox.
6. Liberar lote pequeno somente após revisar dry-run. Validar root/documents físicos, transições e ausência de duplicação. Exercitar fluxo autenticado organização → primeiro projeto → documentos/save com conta legítima autorizada.
7. Em regressão: kill switch/desabilitar Worker, preservar eventos e investigar. Não executar restauração global automática do D1, pois pode apagar escritas concorrentes legítimas.

O merge técnico pode ocorrer antes da janela completa de SLO; o encerramento operacional permanece pendente até evidências suficientes. Change Requests #147/#149/#150/#151 e migrations 0021/0022/0023 permanecem fora deste rollout.

## Coleta e relatório SLO

Contrato versionado: `scripts/organization-storage/reliability-slo-contract.json`. Janela de 30 dias; pelo menos 1.000 organizações novas ativas e 100 incidentes transitórios. Metas: 99,9% operacionais em até 5 minutos, 99% recuperados em até 60 minutos, sem intervenção manual. Percentis p50/p95/p99 têm contagem de amostra; falhas e pendências permanecem no denominador. Os prazos e amostras são parâmetros operacionais desta versão, não medições já atingidas.

No PowerShell, a partir da raiz do repositório, com a configuração isolada apontando para o UUID verificado:

```powershell
$EvidenceDir = Join-Path $env:TEMP ("maono-prh08-evidence-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $EvidenceDir -ErrorAction Stop | Out-Null
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
# $ConfigPath deve ser o arquivo já conferido para maono_maps Production.
$Rows = & npx wrangler@4.112.0 d1 execute maono_maps --remote --config "$ConfigPath" --file "scripts/organization-storage/reliability-organizations-export.sql" --json
if ($LASTEXITCODE -ne 0) { throw "Falha ao exportar organizações" }
[System.IO.File]::WriteAllText((Join-Path $EvidenceDir "organizations.json"), ($Rows -join "`n"), $Utf8NoBom)
$Rows = & npx wrangler@4.112.0 d1 execute maono_maps --remote --config "$ConfigPath" --file "scripts/organization-storage/reliability-audit-export.sql" --json
if ($LASTEXITCODE -ne 0) { throw "Falha ao exportar auditoria" }
[System.IO.File]::WriteAllText((Join-Path $EvidenceDir "audit.json"), ($Rows -join "`n"), $Utf8NoBom)
Copy-Item "scripts/organization-storage/reliability-evidence-manifest.example.json" (Join-Path $EvidenceDir "manifest.json")
```

Preencher manifest com janela UTC, SHA efetivamente observado, cobertura e referências verificáveis. Não alterar flags de cobertura para contornar dados ausentes. Export truncado/incompleto exige nova coleta paginada e reconciliação, não aprovação. Registrar incidentes de perda silenciosa/duplicação/vazamento em evidências próprias: zero eventos desse tipo no audit export, isoladamente, não comprova ausência.

```powershell
node scripts/organization-storage/reliability-slo-report.mjs --manifest "$EvidenceDir/manifest.json" --organizations "$EvidenceDir/organizations.json" --audit "$EvidenceDir/audit.json" --output "$EvidenceDir/report.json" --gate
```

Consultar a saída e o exit code do CLI. `PASS` exige todos os critérios. `INCONCLUSIVE` mantém gate aberto; testes simulados nunca substituem `production-observation`. Guardar export, manifest, relatório e hashes juntos em local restrito.
