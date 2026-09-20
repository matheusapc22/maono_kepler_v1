# Recuperação manual de candidato em RECYCLE (OB-02)

## Alcance e condições

`RECYCLE` é um marcador em uma revisão `FAILED`, não um status novo. Ele cerca o caminho enquanto o dono do token exclui o artefato anterior. Uma exclusão incerta ou a interrupção da instância deixa o marcador para inspeção. Idade do registro, novo retry ou `published_at` ausente não autorizam destravar.

Este runbook e o SQL associado são material revisável. Não são migration, endpoint, job, operador ou autorização para executar em Preview/Production. O ensaio é inteiramente local, usando SQLite e o transporte real com HTTP do provider simulado. Aceite com D1/Dropbox reais pertence a OB-04.

## 1. Conter e reunir evidências

- Identificar conta, projeto, deployment/SHA e bindings reais. Confirmar organização, projeto, revisão e namespace Dropbox; usar a organização da sessão legítima, sem expor credenciais.
- Obter autorização para o reparo específico e definir responsável. Pausar novas escritas desse projeto pelo mecanismo operacional autorizado. Não ativar operador nem habilitar mutação de Preview.
- Aguardar/cancelar todas as escritas e exclusões em voo, inclusive instâncias da versão anterior, sessões de upload e retries. Registrar como a quiescência foi comprovada. **Um timeout, processo local encerrado ou GET not_found isolado não prova isso.** Se não for possível provar, manter RECYCLE e escalar.
- Guardar export consistente das linhas D1 e inventário/cópia dos objetos. Bookmark/backup de D1 não restaura arquivos Dropbox. Não mover, renomear ou excluir o objeto como forma de diagnóstico.

## 2. Inspecionar sem escrever

Usar SELECT com IDs conferidos (parâmetros vinculados, não interpolação de texto):

```sql
SELECT p.id, p.organization_id, p.slug, p.lifecycle_state,
       p.config_revision, p.config_checksum, p.config_storage_ref,
       p.dropbox_root_path, p.default_config_file,
       r.revision, r.status, r.error_stage, r.error_code, r.transition_id,
       r.attempts, r.checksum, r.checksum_algorithm, r.size_bytes,
       r.storage_provider, r.storage_ref, r.storage_provider_version,
       r.storage_provider_hash, r.published_at, r.updated_at
FROM projects p
JOIN project_config_revisions r ON r.project_id = p.id
WHERE p.organization_id = ? AND p.id = ? AND r.revision = ?;
```

Derivar o nome com `getMapConfigRevisionFileName` e o caminho com `joinDropboxPath` existentes. Consultar metadata do objeto nesse namespace e registrar ID, rev, content_hash e tamanho, se presente. Quando necessário e autorizado, comparar bytes/hash com o ledger. `sha256` e `dropbox-content-hash` são algoritmos distintos. 403, 429, 5xx, erro de rede ou namespace incerto são **desconhecido**, nunca ausência.

## 3. Decidir

| Observação | Decisão |
| --- | --- |
| HEAD já publicou essa revisão, é posterior, ou algum HEAD referencia seu storage_ref | Parar. Preservar objeto/ledger e investigar inconsistência; não executar o SQL de destravamento. |
| Exclusão/upload/retry ainda em voo, ou ausência de prova de quiescência | Manter RECYCLE. Uma exclusão antiga pode atingir o próximo conteúdo depois do desbloqueio. |
| Provider desconhecido, root/namespace divergente, erro ao ler metadata | Manter RECYCLE e resolver o diagnóstico. |
| Objeto presente, mesmo que hash pareça correto | Preservar. Requer reconciliação específica e revisão; este procedimento não publica, sobrescreve ou apaga esse objeto. |
| Objeto confirmado ausente pelo provider correto, quiescência comprovada, candidato FAILED/RECYCLE não publicado em HEAD+1 | Candidato ao reparo condicionado abaixo, após reconferir o snapshot D1. |

O escopo implementado recupera o caso de exclusão concluída sem confirmação D1. Os demais estados têm uma decisão segura de preservação; não existe reparador automático genérico.

## 4. Reparar somente o caso de ausência comprovada

O arquivo `scripts/project-revisions/recover-verified-absent.sql` é a única atualização deste procedimento. Vincular os 12 parâmetros documentados no arquivo a valores observados. O novo incident/recovery ID deve ser diferente do token RECYCLE. Não entregar SQL com IDs ou segredos reais no repositório.

O compare-and-swap confere organização, projeto, revisão sucessora, HEAD, lifecycle, root, arquivo, status, marcador, token, checksum, tentativa, referência e ausência de referência publicada. Mantém `FAILED` e a metadata antiga, troca o marcador para `RECOVERY` e incrementa `attempts` para invalidar callbacks antigos. Não muda HEAD, lifecycle, arquivo ou schema. O próximo save passa novamente por reserva, verificação e publicação normais.

Exigir **exatamente uma linha retornada**. Zero linhas significa snapshot obsoleto ou pré-condição não satisfeita: parar e reinspecionar, sem alargar o WHERE. Mais de uma linha é incidente. Não repetir com novos parâmetros automaticamente. Ausência do objeto e quiescência são pré-condições externas, que SQL em D1 sozinho não consegue comprovar.

## 5. Retomar e validar

1. Confirmar a linha `FAILED/RECOVERY`, incremento de tentativa e HEAD inalterado.
2. Repetir uma única operação autorizada pelo caminho normal do produto, com expectedRevision atual. Mesmo conteúdo e novo conteúdo passam pelas respectivas regras de reserva já existentes.
3. Conferir objeto, hash/tamanho, READY e publicação única. Reabrir e comparar configuração. Confirmar que callbacks antigos e replay do snapshot de reparo não alteram o novo estado.
4. Observar retries/conflitos e registrar evidências sanitizadas, SHA, ator e horário. Fechar o incidente só após validação operacional; o ensaio local não fecha OB-04.

## Reversão

Não voltar cegamente a uma versão anterior à PR #184 enquanto houver RECYCLE ou limpeza em voo: ela não respeita a cerca. Parar novas escritas, comprovar quiescência e preferir uma correção compatível. Qualquer restauração exige consistência de D1 **e** objetos Dropbox. Não restaurar somente um lado nem marcar READY manualmente para contornar a falha.

## Ensaio reproduzível

`node --test tests/project-recycle-recovery.test.mjs`

O ensaio executa o mesmo SQL de reparo em memória e retoma pelos serviços de produção. Nenhum acesso remoto ou sessão de QA é necessário.
