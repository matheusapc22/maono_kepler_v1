# CC-03 — alinhamento do roadmap após a CC-02

Data da revisão: 25/09/2026. Base funcional lida: [`ddaabcb1ea6038b62da9d90a7d1acd20634bd236`](https://github.com/matheusapc22/maono_kepler_v1/commit/ddaabcb1ea6038b62da9d90a7d1acd20634bd236), merge da [PR #195](https://github.com/matheusapc22/maono_kepler_v1/pull/195). Esta revisão documenta o ponto de partida e os ajustes de escopo; não comprova a implementação ou o aceite da CC-03.

Fontes: contratos Markdown/JSON da CC-01; README, contrato de API e alinhamento da CC-02; plano central de 18 PRs; código no SHA acima. A autorização atual permite implementar a CC-03 com os contratos prospectivos como direção. CT-02 humano e os gates operacionais continuam separados dessa autorização.

## Resultado

O roadmap permanece alinhado. **Preservar os 18 IDs, as dependências e as fórmulas do controle.** A CC-03 passa a fornecer o serviço comum de comandos, concorrência, ciclos, espera, eventos, auditoria obrigatória e intenção durável. As próximas PRs devem consumir essa fundação; não recriar tabelas, versões ou caminhos de escrita paralelos.

A CC-02 entregou classificação estruturada e um guard restrito ao snapshot de triagem lido pelo servidor. Ele cobre a janela leitura/validação→batch, mas não detecta formulário que já estava desatualizado quando a requisição começou. CAS com versão do cliente, idempotência de criação, máquina de estados, espera/ciclos e outbox continuam sendo deltas reais da CC-03.

O usuário confirmou a aplicação da migration **0025**, sem identificar banco/ambiente nesta revisão. Registrar como **confirmação recebida, ambiente a conciliar**, sem transformar isso em evidência de aplicação em todos os D1 ou de ativação da flag. Não foi executado SQL remoto nesta revisão. 0021/0022/0023 permanecem intocadas e sem aplicação inferida; sua ausência na árvore não prova ausência no banco.

## Contratos que a CC-03 deve fechar

| Tema | Delta necessário e limite |
|---|---|
| Criação idempotente | Chave por organização, ator e operação; fingerprint de payload canônico; resultado durável na mesma transação. Repetição concorrente retorna o mesmo Ticket; chave/payload divergentes no mesmo escopo falham. Revalidar autorização antes de consultar/devolver replay. Uploads continuam associados ao Ticket já criado, sem nova criação a cada tentativa. |
| CAS e precondições | Versão fornecida pelo cliente; 428 se ausente e 412 se vencida, conforme contrato ratificado na CC-01. UPDATE, eventos, auditoria e intenção devem usar a mesma condição de vitória. Verificar zero linhas somente depois do batch não desfaz efeitos indevidos já gravados. Preservar rascunho e oferecer recarga/comparação autorizada; não trocar automaticamente a versão e reenviar. |
| ETag | Definir a representação validada. O detalhe atual inclui eventos, anexos, pessoas e link CR, que podem mudar sem alterar a linha do Ticket. Um hash apenas de `ticket.version` não valida fortemente esse corpo completo. Documentar o token de escrita do agregado Ticket ou construir o ETag da representação efetivamente retornada; não introduzir 304 baseado em uma equivalência falsa. |
| Transições | Preservar `new/open/in_progress/in_review/closed`; fechar/reabrir não são PATCHs livres para qualquer status. Comandos explícitos e qualquer PATCH compatível precisam chamar as mesmas regras. Kanban, lista e drawer não podem conservar um desvio que aceite somente `{status}` e ignore as precondições novas. |
| Espera e ciclos | Espera é intervalo com motivo, responsável, próxima ação e início/fim, nunca sexto estado. Reabertura conserva o fechamento anterior e cria ciclo novo. Definir término da espera no fechamento e impedir espera/ciclo duplicados por retry. Prioridade, prazo civil e espera não criam política/pausa SLA. |
| Fechamento | Exigir resultado/outcome, motivo aplicável e evidência ou registro verificável de comunicação. Duplicidade, desistência e rejeição têm desfecho próprio; não inventar execução bem-sucedida. CR pendente gera contexto/aviso autorizado, sem fechar/aprovar/cancelar CR por consequência. |
| Auditoria e outbox | Para comandos da Central, substituir o uso opcional pós-commit por statements obrigatórios no batch. A intenção durável da CC-03 é insumo; entrega de notificação, destinatários, retries e operação do consumidor continuam CC-07. Não marcar intenção persistida como comunicação entregue. |
| Histórico | Correção por novo evento, não edição/remoção de fatos anteriores. Definir envelope versionado, identificador de origem/comando e vínculo com ciclo. Não inventar fatos antigos para satisfazer o novo schema. Imutabilidade deve explicar retenção, exclusão e limites de acesso privilegiado ao banco. |
| Backfill e GET | Retirar importação legada de GET depois de backfill explícito, idempotente e conciliado. GET lista/detalhe estabilizados não escrevem compatibilidade, ciclo ou estado. Auditoria de acesso/download é exceção semântica distinta, descrita abaixo. |

### Precondições sem dependências circulares

As transições propostas em CC-01 mencionam fila/WIP, comunicação e verificação. A CC-03 não deve exigir componentes que só existirão depois para entregar seu contrato básico:

- Usar responsável/próxima ação e evidência existentes para a transição mínima. O modelo de fila e a política configurável de WIP permanecem CC-09; não criar um limite numérico arbitrário na CC-03.
- Antes do compositor CC-05, registrar a comunicação de fechamento de forma auditável: canal/referência/descrição e ator/instante conhecidos. Isso não significa envio automático, confirmação pelo destinatário ou evento elegível de primeira resposta. A CC-05 integrará mensagens reais ao mesmo fechamento.
- Permitir representar legado sem resultado/triagem histórica conhecidos. A próxima ação humana deve atender às regras novas; o backfill não pode fabricar comunicação, motivo, autor original ou tempo de resolução.
- Tratar capability/flag/schema da CC-03 explicitamente. Quando o fluxo novo estiver habilitado, clientes antigos não podem contornar CAS ou fechamento enviando um PATCH antigo. Responder com erro acionável; não aceitar campos e descartá-los. Desligar somente a UI/flag de triagem não deve criar um caminho alternativo que burle invariantes do ciclo já ativado.

## Adaptações mínimas nas CC-04 a CC-18

| PR | Dependências preservadas | Ajuste de escopo/aceite após CC-03 |
|---|---|---|
| CC-04 | CC-03 | Compor autorização de objeto com os comandos, a leitura/replay de idempotência e a resposta de conflito; verificar acesso antes de revelar versão, diferenças ou resultados anteriores. Definir matriz de grants/negações por ação e exceções explícitas. Preservar a retenção introduzida na CC-03: hard delete de usuário com histórico retorna 409 `USER_TICKET_HISTORY_RETAINED`; desativação continua disponível sem apagar autoria. Revogação cobre rascunhos, cache e consumidores futuros. Não criar segunda versão concorrente do Ticket. |
| CC-05 | CC-04 | Mensagens, notas e versões usam o envelope/eventos e a unidade de commit comuns. Distinguir versão da mensagem da versão do Ticket e fixar quais ações alteram cada uma. Conectar comunicação real ao fechamento e ao ciclo; nota interna não satisfaz resposta pública. Rascunhos permanecem após 412/428. |
| CC-06 | CC-03/04/05 | Reusar a publicação D1 de evidência, acrescentando reserva de capacidade, CAS de offset, retomada, expiração e compensação externa. Não confundir versão de upload com versão de Ticket. Provar corrida conclusão de upload×fechamento, sem prometer transação D1+Dropbox. |
| CC-07 | CC-03/04/05 | Evoluir a outbox já criada; não criar outra outbox com o mesmo propósito. Consumidor, deduplicação, destinatário/audiência, reautorização, tentativas, falhas e reprocessamento são a entrega própria. Replay e migração não reenviam comunicação histórica por inferência. |
| CC-08 | CC-03/04/05/07 | Usar adapters/eventos/intenção da CC-03 para reconciliar CR. Preservar idempotência e revisão próprias do CR; `baseRevision` de projeto não é versão de Ticket. Tipos gerais de mudança, Large Apply, autoridade canônica e reconciliação remota permanecem aqui. Apply nunca fecha atendimento automaticamente; reconciliar 0021 histórica antes de qualquer uso. |
| CC-09 | CC-02/03/04 | Lista/kanban/calendário acionam os comandos e exibem ações permitidas, conflito, espera, ciclo e próxima ação. WIP/filas configuradas complementam as precondições mínimas; não substituem CAS. Paginação e contagens seguem autorização e filtros completos. |
| CC-10 | CC-03/05/08 | Consumir eventos de espera/ciclo/fechamento e mensagens elegíveis sem reconstruí-los por `updated_at`. Pausa depende da política, não apenas de entrar em espera. Preservar CC-08 como dependência do aceite integrado; desenho/testes locais podem ser preparados em paralelo. |
| CC-11 | CC-07/09/10 | Reutilizar IDs/versões de eventos para replay, deduplicação, ordem e watermark. Identificar importação e períodos sem evidência. Evento de registro de comunicação não é, por si só, primeira resposta elegível. Abertos/reabertos e ciclos anteriores continuam nos denominadores corretos. |
| CC-12 | CC-04/11/13 | Exportar ciclos/esperas e qualidade/proveniência com manifesto, autorização revalidada e versão das políticas. Manter CC-13 antes do aceite de causas/incidentes. Snapshot de relatório é próprio; não reutilizar ETag do Ticket como versão de uma exportação. |
| CC-13 | CC-05/07/08/09 | Incidente/problema possuem ciclo de vida próprio. Mitigação ou restauração gera relações/eventos autorizados, sem disparar fechamento em cascata dos Tickets. Comandos em lote precisam resultado/idempotência por item e não podem ocultar conflitos. |
| CC-14 | CC-04/05/13 | Vincular artigo à versão de evidência/mensagem com ACL da origem. Conteúdo de outcome/triagem não se torna publicável por estar encerrado. Retificação preserva a referência histórica e passa por revisão própria. |
| CC-15 | CC-05/10/11 | Convite e resposta usam o identificador estável do ciclo encerrado; reabertura não sobrescreve resultado/convite anteriores. Deduplicar convite por ciclo. Não resposta continua sem bloquear fechamento. |
| CC-16 | CC-06/08/09/12/13/14/15 | Ensaiar conflito entre editores, resposta perdida na criação, espera, fechamento excepcional e reabertura com rascunhos. Incorporar CT-02 humano pendente; acessibilidade básica das novas ações já entra em cada PR, não só nesta etapa. |
| CC-17 | CC-16 | Incluir matriz de writers indiretos CR/anexos, falhas em cada statement, retry e imports; testar schemas/flags em coexistência e autorização revogada. Gate remoto exige SHA, banco/schema e perfis confirmados; não converter checks locais em produção aceita. |
| CC-18 | CC-17 | Documentar comandos/412/428/replay, backfill e recuperação de outbox, além de rollout/rollback. Onboarding de cada organização nova exige reconciliação explícita e marker pronto, inclusive sem origem legada. Rollback de flag/código preserva o guard de somente leitura dos Tickets com ciclos adotados; não restaurar writers antigos irrestritos. Registrar a 0025 confirmada pelo usuário sem extrapolar ambiente, e novas migrations separadamente. Fechar requisito→PR→teste→evidência, sem usar quantidade de merges como prova de entrega total. |

## Writers que não podem ficar fora da revisão

**Decisão final de escopo:** a revisão inicial considerou adaptar todos os writers nesta etapa. A CC-03 entrega os helpers e a atomicidade dos seus comandos/backfill, além de testes de compatibilidade dos dois submitters CR. A conversão transacional completa dos writers de CR fica na CC-08; publicação/compensação de anexos fica na CC-06. Defaults preservam os Tickets indiretos com ciclo zero até uma ação observada; não comprovam atomicidade desses fluxos antigos. Essa decisão substitui a sugestão inicial de adaptar todos os writers agora e não muda as dependências do roadmap.

Referências de linhas desta seção correspondem à base indicada no início; podem mudar durante a implementação.

| Writer observado | Risco concreto identificado | Entrega responsável e limite |
|---|---|---|
| `project-change-requests.js:402/450/469` | Cria Ticket, CR, operações e `ticket.created` em batch próprio; auditoria vem depois e é opcional. Não passa por `createTicket`. | **CC-08:** adapter de statements para inicializar versão/ciclo e registrar envelope, auditoria e intenção no mesmo batch existente. Preservar chave/hash/response do CR; não chamar outra criação nem duplicar `ticket.created`. |
| `project-change-request-analysis-submission.js:281/317/334` | Segundo caminho de criação de Ticket/CR; auditoria de submissão CR separada e sem o mesmo registro `ticket.created` de auditoria do outro caminho. | **CC-03:** provar compatibilidade dos dois submitters. **CC-08:** convertê-los ao adapter. Defaults novos sozinhos não criam a linha do ciclo inicial nem a evidência necessária. |
| `project-change-request-review.js:309/349/380` | Atualiza status técnico antes de inserir evento Ticket e auditar em caminhos best-effort. A justificativa de rejeição está no evento (`:583–584`); perdê-lo perde evidência relevante. | **CC-08:** integrar a fronteira local da transição/evidência ao adapter. Estado CR continua canônico no CR. A publicação de configuração remota permanece outra fronteira, reconciliada na CC-08. |
| Mesmo review, `:486–507/:714–730/:820` | Retry de conflito/aplicação pode repetir eventos; um `applied` já consolidado pode impedir reparo de evidência perdida no retry. | **CC-08:** distinguir evento de transição vencedora de evento de tentativa; adotar chave estável de origem/deduplicação. UUID aleatório a cada retry não resolve idempotência. Não chamar projeto+Dropbox+D1 de uma transação. |
| `ticket-center.js:1717–1744/:1825–1853` | Finalização de upload ativa metadata, depois evento e auditoria separadamente; verificação de fechado ocorre antes de I/O remoto. | **CC-06:** publicação D1 da evidência deve validar o estado pertinente e agrupar metadata/evento/auditoria/intenção. Testar corrida com fechamento. Reserva/offset/compensação externa continuam CC-06. |
| `ticket-center.js:1858–1875/:1994–2029` | Catch multipart pode marcar ACTIVE como FAILED e apagar bytes após falha posterior do evento; exclusão apaga bytes antes de consolidar metadata/evento/auditoria. | **CC-06:** revisar a fronteira de sucesso e os catches ao introduzir atomicidade local; mudar apenas o INSERT do evento é insuficiente. Não afirmar rollback do provedor. Preservar estado recuperável quando houver falha externa. |
| `permissions.js:1299`, `optionalRun:313–325` | `await recordAuditLog` captura falhas de DB e retorna null; não é auditoria obrigatória. | **CC-03:** helper/statement obrigatório específico para a transação dos comandos da Central. Não alterar globalmente a semântica de todos os módulos da aplicação por efeito colateral. |
| Download de anexo, `.../attachments/[attachmentId]/download.js:55–75` | GET registra acesso de modo best-effort antes de devolver bytes. | **CC-06:** distinguir auditoria de acesso de backfill/domain DML. Se a auditoria for obrigatória para liberar resposta, falha deve impedir entrega; registrar autorização/serviço, não afirmar recebimento completo pelo cliente. Não criar ciclo, incrementar versão ou emitir outbox de alteração por leitura. |

Anexos mantêm os limites existentes de cinco arquivos, 80 MiB por arquivo e 150 MiB total, além dos gates de storage/autoria/estado. A CC-03 não implementa scanner, reserva integral nem ACL de audiência da CC-05/06. CR continua exigindo autorização de projeto; Ticket/versão/outbox não concedem Review ou Apply.

### ETag e versões de writers indiretos

`getTicketDetails` (`ticket-center.js:873–883`) reúne Ticket, anexos, eventos e responsáveis. CR e anexos alteram partes desse detalhe sem atualizar `organization_tickets`. A implementação deve escolher e testar a fronteira de concorrência: atributos/ciclo/espera/outcome que uma edição pode sobrescrever versus recursos filhos com versão própria. Não incrementar a versão principal a cada chunk apenas para compensar um contrato de ETag impreciso. Mudança de pessoa/responsável exibido e links CR dependentes de autorização também impedem tratar todo detalhe como bytes imutáveis derivados apenas da versão principal.

## Permissões: evitar mudança silenciosa de alcance

Na base, POST exige `ticket.create`; PATCH exige `ticket.manage`, incluindo atribuição/status. `ticket.close` e `ticket.assign` já constam dos catálogos, mas não são os gates do PATCH; `ticket.reopen_own` é somente proposta. O serviço `can()` aplica contexto de organização ativa e negações explícitas; o vínculo de projeto/CR continua independente.

Pivô mínimo recomendado: separar a implementação dos comandos de estado da migração de grants. Se CC-03 preservar `ticket.manage`, documentar isso como compatibilidade e reservar granularidade/privados à CC-04. Se optar por capacidades específicas nesta PR, atualizar API, capabilities da UI, documentação e testes de perfis/negações juntos, sem promover roles nem copiar grants de forma ampla. **Não usar `ticket.manage OR ticket.close/assign` como fallback que contorne uma negação explícita da ação.** Reabrir por autoria não nasce automaticamente da posse de `ticket.create`.

As respostas 412, replays e comparação de versões precisam respeitar a autorização atual. Um conflito não deve revelar dados que o ator perdeu o direito de ler. Mudanças de ACL em CC-04 exigirão essa integração também para intents já enfileiradas.

## Backfill: corrigir limitações observadas antes do cutover

O importador atual (`ticket-center.js:454–559`) procura até 100 linhas ausentes, escreve no caminho GET/POST/PATCH, captura erros e incrementa `migrated` mesmo quando `INSERT OR IGNORE` não inseriu. A normalização (`:400–448`) pode usar o usuário que fez a leitura como criador de fallback e o instante atual como abertura de fallback. Esses comportamentos não são evidência de autoria/data originais.

O job/runbook CC-03 deve:

1. Ter execução explícita e escopo de organização, paginação/checkpoint por origem e relatório de erros. Linhas inválidas não podem ocupar para sempre as primeiras 100 posições e impedir o restante do lote.
2. Usar chaves legadas estáveis e contagens de alterações efetivas; reconciliar origem, já existente, inserido, ignorado/quarentenado e falha. Retry não cria Ticket/evento/ciclo duplicado.
3. Separar executor/importação de autor original desconhecido. Preservar dados disponíveis e identificar fallback/proveniência; não inventar triagem, comunicação, fechamento completo ou precisão temporal.
4. Inicializar versão/ciclo representando o estado conhecido, com histórico parcial explícito. Legado fechado não ganha um outcome fictício; a próxima reabertura preserva o registro anterior incompleto.
5. Não disparar notificações retrospectivas como se uma importação fosse atendimento recém-criado. Se houver evento/intenção de importação, sua natureza deve impedir essa interpretação.
6. Remover os calls de compatibilidade de GET lista/detalhe após conciliação e cutover. Definir se POST/PATCH ainda podem importar algo; preferir um comando explícito, sem herdar o backfill lateral da requisição humana.

## Schema, histórico e gates

Há 20 arquivos de migration nesta base, terminando em `0025_ticket_triage_classification.sql`. Prefixos 0007/0008 já se repetem; inventariar filename completo e checksum. `schema.sql` inclui a triagem para instalação nova; o caminho de expansão deve ser testado separadamente. O próximo número deve ser revalidado contra o HEAD antes de criar arquivo; não reutilizar 0025 nem preencher lacunas 0021–0023 por conveniência.

`ticket_events` possui FKs com exclusão em cascata de Ticket/organização e `actor_user_id ON DELETE SET NULL` (`0010:56–66`). Um trigger que proíbe todo UPDATE/DELETE pode bloquear exclusão/pseudonimização de usuário ou ações administrativas existentes. Definir retenção/arquivamento e autoria histórica antes de alegar imutabilidade absoluta; proteção dos writers normais não equivale a resistência a qualquer operador privilegiado do banco. `audit_logs` também usa FKs `SET NULL`; não remodelar toda auditoria da plataforma nesta PR sem necessidade comprovada.

Migrations e flags remotas permanecem ações separadas da implementação. A confirmação da 0025 não autoriza a migration nova da CC-03, não identifica banco/ambiente e não comprova QA autenticado. A ativação exige verificar schema/ledger/binding e coexistência de writers. Merge/CI/Pages são evidências técnicas distintas do aceite humano, do cutover de dados e da versão realmente liberada.

## Aceite e notas mínimas para o controle

- Manter CT-06 a CT-10 e CT-49 na CC-03: transições/espera/fechamento/reabertura; replay de criação e separação de escopos; concorrência com mesma versão; falha de cada statement; importação idempotente, GET estabilizado e correção de histórico por novo evento.
- Na CC-03, complementar essas provas com compatibilidade de ambos os submitters CR, campos omitidos da triagem preservados, retry dos comandos sem eventos duplicados e separação de versão do projeto/upload/Ticket. A publicação atômica de anexo versus fechamento é aceite da CC-06; a atomicidade/reconciliação completa dos writers CR é aceite da CC-08. Não declarar garantia global com teste somente da rota principal.
- Registrar novos erros/precondições e compatibilidade do cliente no contrato CC-03. Preservar a evidência histórica CC-01/02; atualizar referências de implementação sem reescrever esses snapshots como comportamento já existente neles.
- Nas linhas CC-04/05/06/07/08/09, acrescentar consumo do serviço comum e os deltas da tabela acima. CC-10 e CC-12 mantêm as dependências atuais. Nenhuma renumeração ou reconstrução das fórmulas é necessária.
- Estado de desenvolvimento da CC-03 é independente do aceite de produção. Escrever/testar localmente está autorizado; publicar uma garantia exige evidências no SHA implementado e limites operacionais explícitos.

Esta revisão não alterou implementação, grants, planilha, branch, HEAD, configuração remota ou D1. Este relatório foi atualizado após a implementação para registrar a decisão final de escopo. Os achados e retestes independentes estão em [review.md](review.md).
