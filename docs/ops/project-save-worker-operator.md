# Implantação inicial do Worker de salvamento e prévias

Este operador prepara e, somente após autorização separada, cria `maono-project-save-operations` com os dois processadores desligados. Não implanta o Pages, não configura credenciais do Dropbox, não aplica migrations e não ativa funcionalidades.

A PR operacional deve ter base **main**. A implementação do produto continua na PR #225. O workflow usa o SHA imutável `fff7e4c1efdf4f3665e829a79be8a22a69c622e9` e um manifesto com SHA-256 dos 22 arquivos necessários, incluindo imports dinâmicos. Portanto, funciona como bootstrap antes do merge da #225 sem copiar o produto para main ou depender do HEAD móvel de uma branch. Trocar fonte, destino ou ferramenta exige outra PR revisada. Um novo commit em main invalida o hash de autorização anterior. Se o artefato de preflight expirar, faça novo preflight; não há fallback que dispense a evidência.

## O que está fixado

- Conta Cloudflare: `09d455fa1cf988b0d9db89987b73eaff`
- Worker: `maono-project-save-operations`
- D1: `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`, único binding `DB`
- Cron UTC: `* * * * *`; não é garantia de conclusão em um minuto
- Wrangler: `4.139.0`, dependências e integridade fixadas em lockfile isolado
- Compatibilidade: `2026-09-01`
- `MAONO_RUNTIME_ENV=production`, `STORAGE_DRIVER=dropbox`
- `PROJECT_DURABLE_SAVE_WORKER_ENABLED=false`
- `PROJECT_PREVIEW_PROCESSOR_ENABLED=false`
- `PROJECT_DURABLE_SAVE_V1=false`
- Lotes de JSON e PNG: 10 por processador
- Sem endereço `workers.dev`, sem preview URL, sem rota/domínio público, Queue, R2 ou KV

O código tem um handler HTTP que retorna 404. A saúde operacional deve ser verificada pelo relatório, versão, bindings e cron; visitar uma URL não comprova processamento. O bundle é gerado sem credenciais e testado realmente com os dois flags desligados: nenhuma chamada ao banco ou à rede é permitida nesse teste.

## Primeiro: preparar a proteção, sem compartilhar valores no chat

Um administrador autorizado faz esta configuração na interface das plataformas. Criar acesso persistente ou cadastrar o token exige sua própria aprovação; esta PR não realiza esses passos.

1. No GitHub, abra **Settings → Environments** do repositório e crie `production-project-save-worker`.
2. Configure **Required reviewers** com o proprietário `matheusapc22`. O proprietário inicia e aprova o job. Se impedir autoaprovação, haverá necessidade de alterar por PR a política de revisores e de aprovar um segundo revisor; não desative a proteção para contornar o bloqueio.
3. Em **Deployment branches and tags**, selecione regras específicas e permita somente a branch `main`, sem tags nem curingas. Desative o bypass administrativo onde a plataforma disponibilizar essa opção. Confirme que o plano do GitHub oferece revisão obrigatória para este repositório. Se não oferecer, pare; o operador recusa ambiente sem proteção verificável.
4. Após a autorização de acesso, crie na Cloudflare um token dedicado de curta duração, restrito à conta acima. Permissões mínimas previstas: **Workers Scripts: Edit** (a API chama isso de Workers Scripts Write) e **D1: Read**. Não conceda D1 Write, Pages, DNS, Workers Routes, gestão de tokens ou outras contas. A capacidade de editar Workers pode abranger a conta: a restrição adicional ao nome exato é implementada pelo operador, não deve ser descrita como isolamento IAM por Worker.
5. Cadastre o valor somente como **environment secret** `MAONO_PROJECT_SAVE_WORKER_DEPLOY_API_TOKEN` nesse ambiente. Não use secret de repositório/organização, não reutilize `MAONO_D1_MIGRATION_API_TOKEN`, não envie valores a assistentes, logs, comentários, documentos ou artefatos. Se a plataforma exigir permissão adicional, pare e revise o erro; não amplie acesso automaticamente.

O workflow consulta a configuração do ambiente e exige revisão pelo proprietário e regra exclusiva de main antes de admitir o job protegido. Repete essa verificação antes de acesso à Cloudflare. O token de produção só entra no passo final. Instalação de dependências, scripts de pacote, testes e bundle não recebem esse token. O `GITHUB_TOKEN` tem apenas leitura de conteúdo e Actions para consultar essas proteções.

## Segundo: preflight protegido, somente leitura

Depois do merge **autorizado separadamente** da PR operacional em main:

1. Abra **Actions → Project save Worker operator → Run workflow**.
2. Use branch **main**, modo `preflight`, confirmação `PREPARE_PROJECT_SAVE_WORKER` e deixe `approval_hash` vazio.
3. Revise o artefato de build e aprove o ambiente protegido para a consulta somente leitura.
4. Aguarde resultado completo. O operador valida a identidade real do D1 e exige que o Worker ainda não exista. Uma resposta ambígua ou lista incompleta bloqueia a operação.
5. Guarde o ID numérico da execução (`preflight_run_id`), o relatório e seu `approvalHash`, além do SHA do operador, SHA de origem e hash do bundle. Compartilhe somente esses dados sanitizados para a decisão de implantação. **Pare aqui.**

O hash inclui código do operador, manifesto, lockfile, bundle, configuração e a política de uma invocação Wrangler com possíveis retries internos. A aprovação de uma PR ou de um preflight não autoriza o deploy. A autorização de implantação deve identificar o Worker, o hash atual, a conta/D1 e o estado inicial desligado.

## Terceiro: criação desabilitada, após autorização explícita

1. Execute o mesmo workflow em **main**, modo `deploy_disabled`.
2. Confirmação: `DEPLOY_DISABLED_PROJECT_SAVE_WORKER`. Copie o `approvalHash` do preflight concluído para `approval_hash` e seu ID numérico para `preflight_run_id`. O operador verifica uma execução anterior concluída com sucesso, iniciada pelo proprietário em main, com o mesmo SHA e workflow, além do artefato de preflight não expirado e seu conteúdo. Um hash calculado localmente, sem esse preflight, não permite implantação.
3. Aprove o job protegido somente depois de conferir a autorização e o hash. Se main mudou, faça um novo preflight e obtenha nova autorização; não substitua o hash por tentativa.
4. O job reconstrói o mesmo bundle antes de receber o token, compara os hashes, recusa drift de main, confirma conta/D1 e ausência do Worker, e invoca Wrangler uma vez para publicar o bundle auditado com `--no-bundle`. O Wrangler fixado pode repetir internamente uploads/transações após falhas de rede; essas tentativas usam o mesmo artefato desligado e destino. A autorização de implantação deve considerar esse comportamento. O operador não faz uma segunda invocação após resultado incerto.
5. A conclusão exige leitura de retorno confirmando a versão implantada, único binding DB, todos os valores fixos, cron e URLs públicas desligadas. O relatório deve dizer `deploymentVerified=true`, `complete=true` e `processors=disabled`.
6. Pare novamente. Nenhum segredo Dropbox foi configurado. Nenhum processamento ou rollout foi ativado.

Este é um operador de **criação inicial**, não de atualização. Se o Worker já existir, ele para para evitar substituir uma instalação ativa ou adulterada. Não apague um Worker existente para fazer o bootstrap passar. Atualizações, alteração de flags, reparo de publicação parcial e rollback exigem inspeção e procedimento revisado específico. O proprietário deve evitar alterações simultâneas pelo dashboard: a API não fornece um compare-and-swap atômico entre a verificação de ausência e a publicação.

## Credenciais de runtime: etapa separada

Após autorização específica, o usuário responsável configura diretamente no armazenamento protegido da Cloudflare, no Worker acima, somente os nomes necessários:

- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`

Os valores precisam corresponder à mesma aplicação/conta/contexto de armazenamento usado pelo Pages. Não existe neste código uma variável `DROPBOX_NAMESPACE` que corrija divergências. Não usar inputs do workflow para valores nem nomes de secrets. Criar/renovar OAuth ou outra autorização persistente também permanece separado. Esta PR não oferece comando de inclusão de secrets, nem pede os valores.

## Antes de qualquer ativação ou publicação do Pages

- As migrations `0039_project_save_operations.sql` e `0040_project_preview_operations.sql` já foram aplicadas e verificadas no checkpoint de 6 de outubro de 2026. Preserve essa evidência; não reaplique migrations como parte deste deploy.
- Confira capacidade e limites da conta Cloudflare, D1 e Dropbox, além do inventário de revisões antigas WRITING/READY, sem apagar dados.
- A recuperação JSON usa `PROJECT_DURABLE_SAVE_WORKER_ENABLED`; a de PNG usa `PROJECT_PREVIEW_PROCESSOR_ENABLED`. `PROJECT_DURABLE_SAVE_V1` é admissão e não precisa ficar true no Worker para recuperar operações.
- Habilitar os processadores, configurar segredos, abrir janela de aceitação e publicar/ativar o novo Pages são decisões separadas. A execução desabilitada não comprova recuperação JSON/PNG real.
- O novo produto remove o escritor antigo. Publicá-lo com admissão desligada pausa novos saves; planeje a janela e não suponha compatibilidade automática com o escritor anterior.
- Use o [operador de aceitação](../runbooks/production-acceptance-operator.md) conforme as suítes efetivamente registradas no SHA escolhido. A suíte JSON anterior não prova PNG real em produção, e uma suíte de PNG pela rota Pages não prova, sozinha, recuperação independente pelo Worker.

## Custos, retenção e evidências

- Cron a cada minuto representa aproximadamente 43.200 invocações em um mês de 30 dias, mesmo com processadores OFF. Isso não é promessa de custo zero. Preço real depende do plano, CPU, invocações, leituras/escritas D1, armazenamento, tráfego e limites Dropbox; confirmar no painel/faturamento antes de ativar.
- Lote 10 é limite por passagem, não teto mensal de custo nem garantia de throughput. O volume pendente, latência e concorrência precisam ser observados na ativação autorizada.
- O código da fonte tem janelas de processamento/expiração; não confundir esses prazos com garantia de remoção física de payloads, journals ou arquivos temporários. Política final de retenção e limpeza em Dropbox/D1 ainda exige revisão operacional.
- Artefatos sanitizados deste workflow ficam no GitHub por 14 dias. Isso é retenção da evidência do operador, não dos dados de produção. Preserve os IDs/hashes em local autorizado antes da expiração se necessários para auditoria.
- Os artefatos deste operador não incluem bodies brutos de API nem stdout/stderr de comandos autenticados. Logs internos do Wrangler permanecem no runner temporário e não são anexados. O relatório guarda apenas identidades, hashes, flags e IDs de versão, nunca tokens ou conteúdo de projetos.

## Falha, interrupção e recuperação

- Falha antes de `writeAttempted=true`: nenhuma publicação foi iniciada por este operador. Corrija a causa, refaça preflight se houver drift e mantenha a autorização correspondente.
- Falha/cancelamento depois desse ponto: o resultado pode ser parcial ou desconhecido. **Não reexecute o deploy automaticamente.** Primeiro inspecione versão, bindings, cron e flags por uma via somente leitura autorizada. Os dois flags enviados eram false, mas isso só fica comprovado após leitura de retorno.
- Se existir Worker após uma execução incompleta, o bootstrap recusa nova escrita. Prepare reparo específico com autorização; não force a ausência nem remova recursos para desbloquear.
- Para uma futura instalação ativa, rollback do Pages começa por pausar novas admissões e preservar leitores/recibos. Operações já aceitas podem precisar dos processadores para escoar; não desligue recuperação cegamente. Restaurar versão, alterar cron ou excluir Worker é outra operação e não está incluída aqui.

## Validação local sem credenciais

No checkout desta PR operacional, com Node 22 e acesso de leitura ao repositório:

```sh
node --test tests/project-save-worker-operator.test.mjs
npm ci --prefix scripts/project-save-worker --ignore-scripts --no-audit --no-fund
mkdir -p .tmp
git clone --no-checkout https://github.com/matheusapc22/maono_kepler_v1.git .tmp/project-save-worker-source
git -C .tmp/project-save-worker-source checkout --detach fff7e4c1efdf4f3665e829a79be8a22a69c622e9
node scripts/project-save-worker/operator.mjs prepare
node scripts/project-save-worker/operator.mjs bundle
```

O último comando executa dry-run tanto do bundle quanto da configuração de upload sem recompilação. O produto e suas dependências npm não são instalados ou executados no runner protegido. Não invoque o comando `protected` localmente; ele exige contexto verificado de GitHub Actions/main/proprietário e ambiente aprovado.

Referências oficiais: [Wrangler deploy/dry-run](https://developers.cloudflare.com/workers/wrangler/commands/workers/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [ambientes GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [consulta de D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/).
