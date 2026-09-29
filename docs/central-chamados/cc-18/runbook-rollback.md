# Runbook de contenção, rollback e recuperação — CC18 v1

Público: operador responsável pela janela. Preencher antes do ensaio: SHA atual, SHA compatível de retorno, DB/ambiente, flags atuais, filas/jobs em voo, recursos sintéticos, responsável de parada e prova de autorização. Não assumir que rollback de app desfaz schema ou recupera dados.

## Parar e preservar

Interrompa imediatamente em vazamento, perda/corrupção de histórico ou duplicação de efeito. Para latência, erro, backlog e custo use os thresholds aprovados, nunca um valor inventado durante a falha. Registre horário, caso, SHA e identificadores mínimos; preserve logs sem tokens/dados privados.

1. Suspender novas entradas afetadas conforme a configuração aprovada. Desligar comandos conserva chamados adotados em leitura do core; preserve o guard também na versão de retorno. Não retornar para um writer legado que reimporte ou altere chamados adotados.
2. Definir pausar ou drenar cada consumidor. Desligar o Worker não remove lease, job ou efeito externo já iniciado; aguardar o trabalho em voo ou diagnosticar seu estado antes de reiniciar.
3. Não desligar ACL seletiva como resposta a vazamento: OFF pode restaurar comportamento organizacional amplo. Conter acesso/entrada pelo procedimento aprovado mantendo proteção de dados privados.
4. Publicar apenas versão de retorno previamente testada com schema expandido. Confirmar ausência de deployment não terminal antes de configurar ou repetir deploy.
5. Conferir SHA servido, binding, leitura autorizada, histórico, filas, reservas e consistência D1/Dropbox. Se algum resultado é incerto, manter contenção e registrar pendência.
6. Retomar somente após decisão nominal, datada e vinculada à evidência; observar sinais durante a janela acordada.

## Aceite interrompido

No workflow Production Acceptance Operator, `closure` exige SHA esperado e confirmação `RESTORE_PRODUCTION_ACCEPTANCE_SAFE_STATE`. Restaura as flags gerenciadas pela suite e republica o SHA seguro. **Não prova limpeza dos recursos:** `configurationRestored=true`, `cleanupComplete=false` e `RESOURCE_CLEANUP_UNVERIFIED` exigem reconciliação do inventário do run interrompido. Não iniciar outra janela até conferir ambos.

## Recursos e banco

Remover/desativar somente fixtures autorizadas; preservar chamados sintéticos que o contrato declara como trilha de QA. Restauração de configuração e cleanup têm relatórios separados. Não excluir eventos/auditoria nem desativar triggers para fazer o teste passar.

Time Travel é recuperação de banco com risco de perda de alterações posteriores ao bookmark, não rollback rotineiro de uma feature. Preservar bookmark não autoriza restaurá-lo. Recuperação real exige escopo, aprovação própria, análise do período afetado e plano de reconciliação de efeitos externos. Migrations aditivas não recebem DOWN destrutivo automático.

Saída do ensaio: estado inicial/final de flags, SHA servido, jobs em voo/pendentes, inventário de fixtures, cleanup, resultado de leitura/ACL/histórico, responsável e decisão de retomada. CT58 remoto e restauração real permanecem pendentes até prova; fixture local não os encerra.
