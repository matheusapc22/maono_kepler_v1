# CC-03 — revisão da correção da saída JSON do Wrangler

Revisão concluída em 25/09/2026 sobre o incremento local à base `61fe77eff20d6a1492bd053d478b2403a49c8963`. O commit da correção ainda estava pendente ao capturar os hashes abaixo. **Nenhum bloqueador P0/P1 foi encontrado no delta revisado.** A revisão anterior permanece como registro histórico e não foi alterada.

## Causa confirmada

O usuário relatou instalação bem-sucedida do pacote no Windows, seguida de `OPERATOR_WRANGLER_READ_FAILED` com identidade ainda não verificada. O wrapper daquela base configurava `WRANGLER_LOG=none` no subprocesso e tentava interpretar o stdout como JSON.

No código instalado do Wrangler 4.140.0, tanto `d1 info --json` quanto `d1 time-travel info --json` emitem o resultado com `logger.log(JSON.stringify(...))`. O filtro do logger também suprime esse payload quando o nível é `none`. Assim, mesmo um subprocesso bem-sucedido pode devolver stdout vazio; `JSON.parse` falha e o catch anterior converte a condição em erro genérico que sugere autenticação. Isso comprova um defeito determinístico do wrapper; não permite concluir se a autenticação remota do usuário está correta ou incorreta.

Reprodução independente com o CLI real fixado, `CI=true`, configuração D1 **local**, credenciais Cloudflare removidas do ambiente do processo e somente `SELECT 1`:

| Nível do subprocesso | Exit code | Bytes stdout | Resultado |
|---|---|---|---|
| `WRANGLER_LOG=none` | 0 | 0 | Sem JSON para interpretar |
| `WRANGLER_LOG=log` | 0 | 139 | JSON válido com resultado 1 |

Nenhuma consulta ao D1 remoto foi necessária para reproduzir a supressão. O mesmo mecanismo de logger foi confirmado pela leitura das implementações de info e Time Travel.

## Delta verificado

- O subprocesso JSON usa `WRANGLER_LOG=log`, mantendo `CI=true`, telemetria desligada e `WRANGLER_WRITE_LOGS=false`. Stdout/stderr continuam capturados; a correção não os imprime nem os anexa aos erros.
- O processo pai continua usando `none` durante `getPlatformProxy`; a configuração do subprocesso não muda o logger do pai. Execução permanece via Node/`execFile`, com argumentos separados e `shell:false`, inclusive para config com espaços no caminho.
- Instalação ausente, versão divergente, comando encerrado com erro, stdout vazio e JSON/shape inválidos recebem códigos distintos e mensagens fixas. O erro interno, comando, tokens e diagnósticos brutos não são encadeados na resposta pública.
- O parser continua exigindo um objeto; arrays, null e escalares falham. UUID/nome e bookmark continuam validados pelos chamadores. Não foi introduzido fallback, autenticação alternativa ou relaxamento da identidade.
- Injeções de `readPackage`/`execCommand` permitem testar a fronteira do subprocesso. O caminho normal do CLI continua usando a versão fixada e o executor real; nenhum novo argumento público seleciona mocks.

## Validação

Execução independente restrita à suíte afetada:

```sh
node --test tests/ticket-backfill-operator.test.mjs
```

**34 testes aprovados, zero falhas, zero skips.** São 27 cenários anteriores e sete novos para identidade/bookmark, opções do subprocesso, erros sanitizados, saída vazia, JSON/shape inválidos e instalação/versão. `git diff --check` passou. Não foi repetida a suíte ampla da aplicação.

O agente principal executou o smoke nativo ampliado entre 17:51:17 e 17:51:37 UTC; esta revisão leu o [script](../../../scripts/central-chamados/operator/smoke-local.mjs) e a [evidência](evidence/operator-json-fix-runtime.json). Os seis cenários terminaram com `ok:true`, Node v24.19.0, Wrangler 4.140.0, `servedBy:miniflare.db`, `remoteBindings:false` e `remoteD1Access:false`.

O novo cenário chama o CLI real por `runPinnedWranglerJson`, com `d1 execute DB --local` e SELECT 1. O callback somente captura, interpreta e verifica o JSON real, devolvendo o resultado original sem convertê-lo. Como `d1 execute` retorna array, o parser de identidade rejeita corretamente o shape com `OPERATOR_WRANGLER_INVALID_JSON`. Portanto o smoke demonstra que o payload atravessa a fronteira real de logger/execução mesmo com `none` no pai, preservando a rejeição de uma resposta incompatível. Os cinco cenários nativos de inventário, paginação, replay/isolamento, rollback/retomada e prontidão continuam aprovados.

## Limites preservados

A execução nativa ocorreu no host local de desenvolvimento, sem autenticação Cloudflare. Não foi executado `d1 info` remoto nem reproduzido o ambiente Windows autenticado do usuário. A correção resolve a causa comprovada de stdout suprimido e permite que eventuais problemas adicionais sejam distinguidos pelos novos códigos. A próxima inspeção remota continua necessária para confirmar o alvo real; não presumir identidade a partir da instalação do pacote ou deste smoke.

Não houve alteração de schema, migration, flags, grants ou lógica de importação neste delta. Merge, backfill remoto e ativação não foram executados por esta revisão; os gates de aprovação e entrega permanecem separados.

## Conteúdo revisado

Hashes SHA-256 antes do commit:

| Arquivo | SHA-256 |
|---|---|
| `scripts/central-chamados/operator/backfill-d1.mjs` | `802a6d3233be14a4c1125131e9bb88f70942154b3934caa17e46b5fe79d6f05f` |
| `scripts/central-chamados/operator/smoke-local.mjs` | `31d4dac72978609757d99a137dc3522ccdeffdb7f1417b7bd247757db24b9e0d` |
| `tests/ticket-backfill-operator.test.mjs` | `a15c7376c45655dcd49c3a8f3d18c54564ddc22dd1d6eb780b24d3588beac76d` |
