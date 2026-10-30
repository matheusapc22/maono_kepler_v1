# Organizações: estrutura e readiness somente leitura

Esta extensão não aplica migrations, executa acceptance funcional ou ativa flags.
O dispatcher oficial continua em main; seus jobs validam e fixam um SHA de
mano_kepler_v1 antes de carregar os scripts/registro desse produto. Os dois
workflows protegidos e seus Environments, secrets e confirmações não mudam.
O dispatcher de acceptance em main inclui um gate adicional dos orçamentos
190/210 minutos, ausente da cópia do produto; a extensão preserva esses valores.
Esse gate também precisa passar sobre o SHA de produto candidato.

## Estrutura 0042

No modo postvalidate do production-d1-migration-operator, selecionar somente
0042_organization_management.sql. approval_hash permanece vazio. A aprovação
humana do Environment production-d1-migrations continua obrigatória.

O novo coletor somente lê metadados usando 27 consultas fixas. Compara as
12 colunas, quatro tabelas, cinco índices nomeados, autoíndices das constraints
e onze triggers da0042, incluindo defaults, nullability, FKs, ações de exclusão,
CHECKs, índices parciais e predicados de triggers. Não recebe SQL/identificadores
do usuário. A referência vem do SQL revisado com SHA256 fixo e do baseline local,
executados somente em SQLite na memória do runner.

As definições completas das seis tabelas são comparadas, incluindo constraints
de tabela, colunas anteriores e opções. Todos os índices/triggers pertencentes
a essas tabelas entram na comparação, mesmo fora do namespace da 0042. Drift
histórico também bloqueia e exige revisão; não é descartado como compatível.

O relatório inclui nomes conhecidos, checks e digests; não inclui linhas de
organizações/usuários, SQL remoto ou defaults arbitrários. Também exporta o
ledger inteiro (id/nome/appliedAt), contagem/digest, pendências/digest finais e
bookmark Time Travel fresco. Confere o ledger antes e depois da coleta; drift,
entrada inválida/duplicada ou ausência das migrations necessárias bloqueiam.
Isso não é snapshot transacional: atomicDatabaseSnapshot=false é explícito.

As leituras inicial e final do coletor validam todas as linhas brutas antes de
normalizar/projetar campos; nomes vazios/nulos, tipos inválidos e duplicações
geram erro explícito. A leitura inicial também precisa concordar com o estado
anterior do operador. O helper legado de audit/apply permanece inalterado.

Schema incompatível produz ok=false e exit2 no postvalidate, preservando o
relatório. Erros de identidade, autorização, transporte ou ledger não autorizam
retry ou outro caminho. O comportamento de audit/apply não é alterado.
Nenhum novo bookmark implica que restore foi testado.

## Readiness de configuração

Suíte registrada: organization-management-readiness, versão1.
Modo admitido: somente preflight; confirmação oficial
PREPARE_PRODUCTION_ACCEPTANCE. O Environment production-acceptance permanece
protegido. Usar ID de organização sintética previamente delimitado: o input é
somente reserva de escopo, não valida a existência/propriedade dessa organização.

O executor faz somente os dois GETs existentes do control-plane Pages. Não faz
login, request à aplicação, consulta ao D1, browser, PATCH de flags ou retry de
deployment. Portanto não visita /api/health nem tenta contornar um403 anterior.
run e closure são recusados antes de qualquer acesso de rede; a função run da
suíte também é uma barreira de recusa independente.

A observação admite exatamente:
- ORGANIZATION_MANAGEMENT_V1;
- VITE_ORGANIZATION_MANAGEMENT_V1;
- PROJECT_QUOTA_RESERVATION_V1.

Esses nomes não passam a ser flags gerenciáveis. managedFlags permanece vazio;
a allowlist de mutação existente fica intacta. Outras suítes não podem adicionar
observedFlags/preflightOnly para ampliar acesso.

O preflight conserva os gates de projeto, branch, SHA canônico limpo, binding D1
e ausência de deploy não-terminal. Valores ausentes, secretos ou inválidos
permanecem distintos de false e impedem sucesso. Configuração e snapshot do
deployment precisam concordar; não se presume que flags estejamOFF. Mesmo quando
todos os valores são observados e iguais, o relatório é pages_control_plane_only:
não comprova comportamento HTTP, compilação efetiva da UI, schema, identidades QA
ou autorização de rollout. A observação de true não concede uma nova ativação.

## Publicação e próximos gates

1. Revisar o diff local, executar os testes de migration/acceptance e CI normal.
   Não é necessário alterar os dispatchers em main: eles já carregam o produto
   fixado e executam os comandos/contratos atualizados.
2. Só após revisão e integração autorizadas, fixar o novo SHA de produto e
   reconfirmar o deployment antes de usar evidências. Não reutilizar609358f9 como
   se fosse o SHA da extensão.
3. Executar postvalidate e preflight em execuções separadas, cada qual com seu
   Environment e somente leitura. Nenhum deles deve disparar o outro nem apply.
4. Conferir os artefatos antes de elaborar a janela funcional.

O readiness não depende de uma suíte funcional para observar o control-plane.
Acceptance funcional exige uma suíte futura separada, versionada e revisada,
escopo sintético/identidades exatos, journal e cleanup/retention, baseline e
restauração de flags, autorização RUN_PRODUCTION_ACCEPTANCE e aprovação humana
do Environment. Esta entrega não implementa essa escrita.

Credenciais administrativas pessoais/Super Admin não entram emCI/prompts.
As ações administrativas necessárias à futura suíte precisam de um contrato
próprio; manualAdministration atualmente bloqueia /api/admin e não foi ampliado.
Quotas e flags têm impacto global; não ativar reservas implicitamente para
completar um teste. Rollback de código/OFF não desfaz triggers, FKs ou auditoria.

## Validação local

Os testes novos usam SQLite descartável e respostas Cloudflare sintéticas.
Cobrem metadados ausentes/alterados, predicados e literais, FKs, unicidade,
defaults, nullability, drift do ledger, queries recusadas, allowlists, sigilo,
flags ausentes/secretas/inválidas, diferença configuração/canônico e recusa de
run/closure antes da rede. As suites anteriores e seus asserts/timeouts ficam
preservados. Resultados locais não são evidência de Produção.
