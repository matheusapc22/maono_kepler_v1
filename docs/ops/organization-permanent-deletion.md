# Exclusão permanente de organizações

## Escopo e autorização

Esta implementação retira a importação de novas organizações e prepara a exclusão de uma organização elegível, sem dados de negócio vinculados. Não é exclusão em cascata. Contas globais de usuários e dados de outras organizações são preservados.

Somente um Super Admin pode ver a ação e usar a API. A confirmação exige o texto literal `EXCLUIR PERMANENTEMENTE`. A interface não substitui autorização, versão e inventário conferidos no servidor.

A pasta Dropbox também faz parte da exclusão, após comprovação de raiz canônica exclusiva. A confirmação final depende das etapas de armazenamento e banco. Retenção de histórico e backups do Dropbox continua sujeita às regras do serviço; `files/delete_v2` não comprova eliminação irrecuperável de todas as cópias.

## Limites operacionais

- Nenhuma exclusão real integra os testes ou esta PR.
- A nova capacidade começa desligada e deve falhar de forma segura se seu schema não estiver disponível.
- Histórico e checkpoints de operações são preservados. Não limpar registros para contornar restrições de integridade.
- Fechar a página ou abortar uma requisição não desfaz uma operação já aceita pelo servidor. Consultar seu estado antes de retomar.
- Não restaurar automaticamente dados ou pastas depois de uma exclusão parcial. Reconciliar o checkpoint e o estado do provedor.
- Rollback de código ou flag interrompe novas ações, mas não recupera dados já removidos.

## Validação e publicação

Testes usam SQLite isolado, usuários sintéticos e provider simulado. Esses resultados não são evidência de aceite em Produção nem de retenção real no Dropbox.

Seguir `AGENTS.md` para qualquer operação posterior. Migration exige audit protegido, relatório, autorização humana do hash exato, apply isolado e pós-validação. PR, merge, deploy, janela de aceite e rollout permanente são decisões distintas. Nunca fornecer credenciais de Produção a runtimes gerais.

## Contrato implementado

Base da API: /api/admin/organization-management.

- GET /organizations/:id/deletion-preview: elegibilidade, versão e impedimentos, sem mutação nem acesso ao Dropbox.
- POST /organizations/:id/permanent-delete: inicia com version, confirmation literal e Idempotency-Key. Não apaga a pasta nessa requisição.
- GET /deletions/by-key?key=... e GET /deletions/:id: reconciliação somente leitura, restrita ao ator.
- POST /deletions/:id/step: avanço explícito e retomável da operação; requer nova autorização de sessão/escopo em cada chamada.

Estados: pending, storage_deleted e completed. Apenas completed confirma a exclusão. A resposta inclui notBefore; durante a drenagem a API retorna ORGANIZATION_DELETE_DRAINING sem chamar o provedor. A interface não executa novas etapas automaticamente após reabrir.

A organização deve estar pausada e com armazenamento estabilizado há pelo menos dois minutos. O claim acrescenta outra janela durável de dois minutos. Esses prazos são proteção operacional complementar, não prova de cancelamento de requisições remotas. A elegibilidade depende também dos registros de operações e das barreiras de gravação.

## Dados e integridade

0044_organization_permanent_deletion.sql cria tombstones, auditoria de fases, arquivo dos eventos gerenciais e triggers de exclusão. O bootstrap schema.sql inclui a mesma definição. A migration não é aplicada remotamente nesta entrega.

A rotina conta dados ativos, inativos e históricos nas tabelas relacionadas. Projetos, documentos, chamados, reservas, uploads e operações existentes impedem exclusão. Tabelas opcionais/desconhecidas sem os guards esperados bloqueiam o fluxo mesmo vazias; não são ignoradas. Exemplos históricos são organization_exports e roadmap_*, ausentes do bootstrap canônico. Se estiverem no schema implantado, esta versão bloqueia todas as candidatas até inventário e extensão revisada dos guards. Novas extensões do schema exigem revisão do contrato antes de habilitar exclusão.

Vínculos de usuários, delegações e permissões pertencentes à organização são removidos no fechamento. Sessões perdem somente active_organization_id. Contas globais não são apagadas. Eventos gerenciais são arquivados antes da remoção do cadastro; operações e reservas históricas de identidade permanecem. Slug/pasta ficam bloqueados contra reutilização e replay por tombstone.

No Dropbox, apenas a raiz canônica exclusiva é aceita. Sobreposição com outras raízes, pasta compartilhada, identidade substituída ou conteúdo não previsto bloqueiam a execução. Aceita-se somente raiz vazia ou com subpasta documents vazia. A remoção usa ID imutável da pasta e verifica ausência por caminho e por ID antes de finalizar D1. A existência de uma raiz legada /organizations/<id> também bloqueia a exclusão: ela não é apagada silenciosamente fora do alvo aprovado.

## Importação e rota legada

Novas importações e validação CSV retornam 410 / ORGANIZATION_IMPORT_RETIRED. Operações antigas continuam consultáveis, mas não executam novas etapas. Seus payloads, resultados e organizações existentes não são apagados. Links antigos de importação não abrem o formulário.

A sincronização legada sync-dropbox é um fluxo separado e permanece disponível. Os guards de tombstone impedem recriar organizações/caminhos excluídos; esta PR não descontinua essa sincronização.

DELETE /api/admin/organizations/:id deixa de desativar/remover vínculos/apagar Dropbox: a API exige o novo fluxo explícito. Pausa e reativação permanecem operações gerenciais próprias, não equivalentes à exclusão.

## Critério de rollout

Antes de autorizar rollout, revisar cobertura de todos os caminhos de escrita e commits no Dropbox, inclusive operações em voo, e verificar em ambiente isolado os checkpoints, perda de resposta e reconciliação. Timeout de rede não prova que o provedor cancelou a gravação. Não declarar segurança de Produção apenas porque testes simulados passaram.

Manter ORGANIZATION_PERMANENT_DELETE_V1 ausente ou false até completar a revisão e receber autorizações distintas de migration, aceite e rollout. Desligar o flag não remove tombstones nem libera caminhos já bloqueados.


## Orçamento de chamadas D1

A introspecção de metadados e as contagens usam lotes somente leitura de até 64 statements, sem cache de schema entre requisições. Falhas, resultados incompletos e dependências desconhecidas continuam bloqueando a exclusão. No fixture de 107 tabelas com handler/sessão/ACL reais, foram medidas 23 chamadas para prévia, 44 para início, 36 para etapa e 11 para consulta. O teste exige menos de 50 chamadas por fluxo medido.

Segundo https://developers.cloudflare.com/d1/platform/limits/, cada db.batch conta como uma chamada no limite por invocação; limites individuais de SQL continuam valendo por statement. Essas contagens locais não comprovam latência, plano contratado ou desempenho no schema implantado.
