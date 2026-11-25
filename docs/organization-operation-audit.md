# Auditoria e recuperação de operações de Organizações

Esta entrega reúne a base durável, a nova interface de Auditoria, a recuperação de operações e a retirada dos relatórios técnicos dos formulários de Organizações. Os outros módulos permanecem no inventário AU05 e precisam de instrumentação e aceite próprios.

## Estado de ativação

**MIGRATION PENDENTE DE CONFIRMAÇÃO**

Migration: `0045_operation_audit_frames.sql`.

SHA-256: `53fefc0df47c3ccf7951cd4fcc9868b664ad223e649574910c5bd4770463ae75`.

O alvo de produção é o binding `DB` do D1 `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`. Preview e QA exigem identificação e evidência do próprio binding. Código, CI, Preview e merge não comprovam aplicação.

| Controle | Valor seguro inicial | Condição para habilitar |
| --- | --- | --- |
| `ADMIN_AUDIT_OPERATIONS_V1` em Pages | `false` | Migration confirmada, schema validado e decisão operacional correspondente |
| `ADMIN_AUDIT_OPERATIONS_V1` nos Workers de exclusão e armazenamento | `false` | Mesmo schema e versão compatível dos produtores |
| `VITE_ADMIN_AUDIT_OPERATIONS_V1` | `false` | Backend e caminhos substitutos disponíveis; requer novo build |

O fluxo de Organizações também mantém o gate existente `ORGANIZATION_MANAGEMENT_V1` e seu par de build. A limpeza dos formulários exige a flag da interface e a capacidade `auditOperations` confirmada pelo servidor. A negociação `X-Maono-Audit: operations-v1` preserva o contrato antigo de listagem para clientes antigos.

## Comportamento do produto

- O formulário de origem permanece montado durante a espera, com o círculo dourado sobreposto.
- A criação avança para os dados confirmados da organização. Sucesso ou falha comum não fecha a janela automaticamente.
- Sucesso aparece no canto inferior direito por 3 segundos. Falha aparece no canto superior direito por 10 segundos, com opção de fechar o aviso.
- Auditoria limita suas requisições a 20 segundos. Um resultado não confirmado exige consulta antes de liberar nova tentativa.
- UUIDs, códigos, etapas e relatórios técnicos saem dos formulários no fluxo novo. Os detalhes técnicos ficam em seção explícita da Auditoria.
- `Resolver impedimentos` continua acessível quando a exclusão está indisponível. A disponibilidade de cada ação vem do servidor.
- Negação de acesso ou troca de identidade descarta o contexto privado anterior. Preservar um formulário não autoriza conservar dados após perda de acesso.

## Registro e interpretação

`audit_operation_frames` conserva snapshots e resultados de etapas; `organization_operation_reconciliations` acrescenta evidências de consulta. Os registros são append-only e não usam FKs que apaguem o histórico com a organização.

Alterações confirmadas em D1 e seus recibos obrigatórios compartilham a transação. Uma atualização sem efeito não é promovida a sucesso; uma falha no recibo obrigatório impede a confirmação da alteração. Operações externas mantêm intenção, tentativa, checkpoint e resultado incerto quando não há prova suficiente.

Autorização concedida, solicitação recebida e conclusão são estados distintos. O sucesso de uma etapa não prova a conclusão de todas as etapas da operação. Registros legados sem evidência suficiente permanecem como resultado não comprovado. Nomes antigos, responsáveis ou rotas ausentes não são reconstruídos a partir de cadastros atuais.

## APIs e recuperação

| API | Finalidade |
| --- | --- |
| `GET /api/admin/audit` com negociação V1 | Lista unificada, filtros e cursor estável |
| `GET /api/admin/audit/organizations` | Identidades históricas para filtros, inclusive organizações excluídas |
| `GET /api/admin/audit/:eventId` | Detalhes, alterações permitidas, tentativas e ações disponíveis |
| `GET /api/admin/audit/operations/:operationId` | Localiza evidência já registrada; não fabrica histórico |
| `POST /api/admin/audit/:eventId/retry` | Comando de domínio escolhido pelo servidor e validado contra o estado atual |
| `POST /api/admin/organization-management/operations/:operationId/consult` | Consulta explícita e eventual reconciliação comprovada |

As rotas exigem Super Admin, usam respostas privadas sem cache e limitam os campos expostos. Comandos não aceitam SQL, URL, payload arbitrário ou reexecução de uma operação descontinuada.

Nesta etapa, a recuperação exige o autor original e autorização atual. Outro Super Admin pode consultar a evidência, mas não assumir a operação por uma autorização implícita. Versão, lease, estado, alvo e confirmação destrutiva continuam validados no domínio.

Repetir a mesma intenção conserva a chave de idempotência. Uma resposta perdida não libera outra execução. Após consulta explícita válida, a interface pode criar uma nova intenção quando o servidor disponibilizar a ação. A falha anterior permanece no histórico.

**Consultar resultado por POST pode gravar uma observação ou reconciliação.** Para diagnóstico exclusivamente de leitura, usar somente os GETs autorizados e registrar essa distinção.

## Proveniência de migrations anteriores

O snapshot `scripts/migrations/references/organization-schema-pre-0045.sql` conserva exatamente o schema do baseline `e1613ce803c5852f5eacb838f9f7d81c0a091ac7`. Ele é fonte estrutural histórica, não o bootstrap atual.

O perfil `deletion-historical-safety-v2.json` fixa as fontes atuais do runtime separadamente. O contrato V1, o manifesto de 530 objetos e ambos os SQLs de M44 permanecem intactos. O binding V2 invalida evidências e aprovações V1 para novas execuções; os vetos do ledger continuam impedindo reaplicação de M44.

Uma alteração futura nas fontes fixadas exige revisão explícita do perfil e novas evidências. Não atualizar hashes automaticamente para ocultar drift ou reaproveitar uma autorização antiga.

## Validação, rollout e rollback

Os testes locais usam SQLite, sessões sintéticas, provedores simulados e a aplicação no navegador com HTTP controlado. Não demonstram execução em D1 remoto, implantação nem aceite autenticado.

A sequência operacional depende do `AGENTS.md`: CI normal, auditoria protegida da migration, relatório com hash exato, autorização específica, aplicação isolada e pós-validação. A janela de aceite e a ativação permanente têm autorizações distintas.

A suite existente `organization-management-readiness` é somente preflight de leitura. Ela não comprova o aceite funcional desta entrega. Uma suite funcional de produção precisa de manifesto, escopo sintético, testes e contrato de limpeza revisados; não adicionar credenciais pessoais ou de Super Admin ao CI.

Rollback de apresentação e comandos: desativar os controles correspondentes e republicar o frontend com a flag de build desligada. Isso preserva o histórico; não desfaz efeitos já executados, não remove a migration e não interrompe necessariamente os triggers de registro já instalados. Reversão de schema exige análise própria.

## Pendências que exigem evidência própria

- Aplicação de M45 em cada binding e integração real entre Pages, Workers e provedores.
- Identificação autenticada de `Maõno 2`; não presumir equivalência com `MRA 2/#11` e não excluir a organização para diagnosticar.
- Aceite T16 herdado da PR302 e aceite dos fluxos novos.
- Instrumentação e aceite de AU05 por módulo.

Registros da execução: [pasta no Drive](https://drive.google.com/drive/folders/1ky0RSDZzfpJSpx-y4cByynI_b4uyW98x) e [planilha de controle](https://docs.google.com/spreadsheets/d/1bd6bWjeqbNcc6xOwbSMROt5T6MGJy-VyGlwkWRiaI9A/edit).
