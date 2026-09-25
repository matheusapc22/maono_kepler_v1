# CC-02 — Contrato implementado de classificação e triagem

Este documento descreve o código desta entrega, não uma confirmação de implantação. Não comprova aplicação de migration, schema D1 remoto ou QA autenticado. Evidências de execução e aceite são registradas separadamente.

Fontes principais: `functions/_lib/ticket-triage.js`, `functions/_lib/ticket-center.js`, os handlers de tickets em `functions/api/organizations/[id]/`, `migrations/0025_ticket_triage_classification.sql` e os componentes/helpers de triagem em `src/pages/Projects/components/`.

## 1. Rotas e autorização preservadas

Base `B = /api/organizations/:id/tickets`. IDs de organização e chamado são positivos e verificados conjuntamente no servidor.

| Método | Rota | Autorização atual | Resultado |
|---|---|---|---|
| GET | `B` | `ticket.view` no contexto organizacional | `200`, lista, facetas, paginação, responsáveis, limites e `triageEnabled` |
| POST | `B` | `ticket.create` no contexto organizacional | `201`, `{ok:true,ticket}` |
| GET | `B/:ticketId` | `ticket.view` no contexto organizacional | `200`, detalhe, eventos, anexos, responsáveis, limites, vínculo CR autorizado e `triageEnabled` |
| PATCH | `B/:ticketId` | `ticket.manage` no contexto organizacional | `200`, `{ok:true,ticket}` |

Não foi criada permissão por natureza. A CC-02 não altera o controle de organização ativa nem autoriza revisão/aplicação de CR pelo vínculo. As regras de anexos permanecem: cinco arquivos, 80 MiB por arquivo, 150 MiB por chamado, chunks de até 8 MiB e multipart compatível de até 10 MiB. Métodos não suportados mantêm `405` e `Allow`.

## 2. Ativação, capability e compatibilidade

`MAONO_TICKET_TRIAGE_ENABLED` está desabilitada por padrão. O servidor considera habilitado somente o valor textual `true`, após remover espaços e normalizar maiúsculas/minúsculas. A UI não lê essa configuração: utiliza exclusivamente a capability recebida de GET lista/detalhe, e só apresenta os novos campos quando `triageEnabled === true`.

| Configuração/schema | Leitura | Escrita |
|---|---|---|
| Flag ausente ou desabilitada | `triageEnabled:false`; Ticket conserva o formato anterior, sem campos públicos novos | Payload anterior continua aceito. Qualquer um dos oito campos de triagem enviados provoca `503 TICKET_TRIAGE_DISABLED` |
| Flag habilitada, colunas de triagem completas | `triageEnabled:true`; Ticket inclui classificação e procedência | POST/PATCH habilitados, com validação descrita abaixo |
| Flag habilitada, colunas novas ausentes/incompletas | `triageEnabled:false`; leitura do formato anterior continua quando o schema base da Central está disponível | Toda criação/alteração de ticket falha com `503 TICKET_TRIAGE_SCHEMA_OUTDATED`, inclusive payload de cliente antigo, antes da escrita |
| Cliente UI conversa com servidor antigo, sem capability | Campo ausente é tratado como falso | UI não envia os campos novos nem exige a classificação estruturada |

A verificação de capability procura todas as colunas listadas em `TICKET_TRIAGE_COLUMNS`; não aplica migration. Falta de schema base da Central continua sujeita ao contrato anterior de `TICKET_CENTER_SCHEMA_OUTDATED`.

O caminho de importação legada já existente em GETs é mantido com flag desabilitada ou capability disponível. Quando a flag está habilitada mas o schema de triagem está incompleto, os handlers pulam essa importação antes da leitura. Isso não transforma todos os GETs antigos em operações estritamente sem DML; a CC-02 não promete essa mudança geral.

**Compatibilidade de POST:** mesmo com triagem habilitada e schema completo, um cliente antigo que envie **nenhum** campo de triagem pode criar um chamado. Ele permanece `demandNature:null`, `triageSource:"legacy"`, `needsTriage:true`, sem classificação inferida do assunto ou domínio. A nova UI, quando recebe capability verdadeira, exige escolha humana e formulário completo. Payload parcialmente novo não é tratado como legado: ele precisa satisfazer as validações da triagem.

## 3. Campos, enums e limites

Campos existentes de criação continuam válidos: `subject` obrigatório até 160 caracteres; `description` obrigatório até 5.000; `priority`, `category`, `dueAt` e `assignedTo` conforme o contrato anterior. Estado inicial continua `new`.

| Campo JSON | Tipo e valores | Regra da classificação estruturada |
|---|---|---|
| `demandNature` | String: cinco códigos abaixo | Escolha explícita; não é inferida de `category` ou descrição |
| `expectedResult` | String, até 2.000 caracteres | Obrigatório para todas as naturezas; texto não vazio |
| `context` | String, até 2.000 caracteres | Opcional; quando omitido na criação normaliza para string vazia |
| `impact` | `individual`, `team`, `organization` | Obrigatório; alcance observado, não severidade automática |
| `urgency` | `flexible`, `soon`, `blocked` | Obrigatório; condição de continuidade da atividade |
| `priorityReason` | String, até 1.000 caracteres | Obrigatório nos casos da seção 5; opcional na criação estruturada com prioridade Normal |
| `triageAnswers` | Objeto JSON de strings | Somente chaves da natureza selecionada; perguntas obrigatórias devem ser respondidas |
| `triageFormVersion` | Número inteiro `1` | Obrigatório na primeira classificação; `"1"` textual e outras versões não são aceitos |

O backend remove espaços das extremidades antes de validar/persistir textos. O limite de texto é contado com `String.length` de JavaScript, não em bytes. Valores de texto `null`, números, arrays e objetos são rejeitados. Campos opcionais podem ser omitidos; não é necessário enviar `null`.

Cada resposta de `triageAnswers` admite até 2.000 caracteres após trim. O objeto normalizado, serializado em JSON, também é limitado a 14.000 caracteres. Chaves extras, inclusive respostas de outra natureza, são rejeitadas. Não há upload, execução de comandos ou interpretação de código nesses campos.

| `demandNature` | Rótulo | Perguntas obrigatórias em `triageAnswers` | Perguntas opcionais |
|---|---|---|---|
| `question_request` | Dúvida / solicitação | Nenhuma; enviar `{}` | Nenhuma |
| `incident` | Incidente | `startedAt`, `impactDescription` | `workaround` |
| `defect` | Defeito | `stepsToReproduce`, `actualResult`, `affectedVersion` | Nenhuma |
| `improvement_change` | Melhoria / mudança | `problemToSolve`, `expectedBenefit` | Nenhuma |
| `recurring_problem` | Problema recorrente | `recurrenceFrequency`, `relatedContext` | Nenhuma |

`startedAt` é texto de contexto, não timestamp calculado: pode informar data/horário/fuso conhecidos ou “horário não identificado”. `affectedVersion` aceita versão conhecida ou contexto suficiente da ocorrência; não obriga o usuário a inventar uma versão. Em recorrência, `relatedContext` pode descrever episódios comuns ou informar que ainda não há outro chamado identificado. Nenhum desses textos cria relacionamento de autorização entre recursos.

Domínios existentes permanecem `map`, `database`, `permission`, `export`, `support`, `other`. Prioridades permanecem `low`, `normal`, `high`. Natureza, domínio, prioridade e estado são dimensões distintas. Selecionar domínio não modifica natureza; impacto/urgência não calculam prioridade nem SLA. `dueAt` continua prazo de calendário.

## 4. GET e procedência dos registros

`triageEnabled` aparece no topo de GET lista e GET detalhe. POST/PATCH continuam respondendo `{ok:true,ticket}`, sem exigir capability no topo dessas respostas. Com a capability disponível, o Ticket inclui:

| Campo público | Interpretação |
|---|---|
| Oito campos de entrada da seção 3 | Valores persistidos; `triageAnswers` retorna objeto, não texto JSON |
| `needsTriage` | `true` se não houver natureza válida ou se `triageSource` não for `human` |
| `triageSource` | `legacy` ou `human` |
| `triagedAt` | Instante ISO gerado pelo servidor durante classificação/edição estruturada, ou `null` |
| `triagedBy` | ID numérico do ator autenticado, ou `null` |

`legacy` identifica ausência de classificação humana estruturada; não significa necessariamente que a linha foi criada antes do deploy. Writers antigos, inclusive fluxos existentes de CR que não enviem classificação, continuam produzindo registros pendentes pelos defaults compatíveis.

Uma classificação completa válida passa a `human`. Uma alteração estruturada posterior registra o ator e instante dessa atualização; esses campos não são um carimbo imutável da primeira triagem. Enviar apenas `priorityReason`, por exemplo em mudança de prioridade/domínio, não classifica um legado e não fabrica autor ou data de triagem.

Os campos de procedência são controlados pelo servidor. Informações como `triagedBy`, `triagedAt`, `triageSource` ou `needsTriage` enviadas pelo cliente não são utilizadas para atribuir autoria.

Exemplo de **fragmento de resposta** para um ticket pendente, com demais campos do Ticket omitidos deste fragmento:

```json
{
  "triageEnabled": true,
  "ticket": {
    "demandNature": null,
    "expectedResult": "",
    "context": "",
    "impact": null,
    "urgency": null,
    "priorityReason": "",
    "triageAnswers": {},
    "triageFormVersion": null,
    "needsTriage": true,
    "triageSource": "legacy",
    "triagedAt": null,
    "triagedBy": null
  }
}
```

Quando a capability é falsa, esses campos de triagem são omitidos do Ticket público; não se deve inferir disponibilidade pela existência prévia de dados no cliente.

## 5. Escrita parcial, justificativa e reclassificação

Na criação estruturada, os campos obrigatórios devem estar completos. `priorityReason` é obrigatório quando a prioridade inicial é `low` ou `high`; é opcional em `normal`. A exceção de compatibilidade do POST sem qualquer campo novo continua válida, sem transformar esses clientes antigos em clientes de triagem.

Com triagem habilitada, PATCH exige uma justificativa **enviada na requisição atual** quando:

- a prioridade realmente muda;
- o domínio (`category`) realmente muda;
- uma natureza já classificada, não nula, muda para outra natureza.

A justificativa persistida anterior não satisfaz essas mudanças automaticamente. A UI limpa o motivo no formulário ao alterar prioridade/domínio e ao confirmar troca de natureza. A primeira classificação explícita de um legado não é uma reclassificação de natureza anterior inexistente.

PATCH apenas de status, prazo, responsável, assunto ou descrição continua independente da classificação. PATCH só de prioridade/domínio mais justificativa pode deixar um legado pendente. Não é necessário preencher todo o formulário para essas operações.

Em ticket já classificado, campos estruturados não enviados são preservados e a validação considera a combinação com os valores atuais. Entretanto, ao trocar natureza é obrigatório enviar **novo objeto `triageAnswers`** correspondente à natureza escolhida: respostas anteriores não são herdadas. Para a primeira classificação de um legado, o pacote precisa formar uma classificação completa válida, incluindo perguntas e versão. Não existe comando de “desclassificar” usando `demandNature:null`.

O drawer envia somente os controles realmente alterados, mais os campos explicitamente editados da triagem. Assim, classificar um ticket não reconverte seu prazo existente nem reenvia status/responsável sem necessidade. O backend preserva propriedades omitidas. A UI pede confirmação antes de limpar respostas específicas já digitadas durante a troca de natureza; resultado esperado, contexto, impacto e urgência permanecem no rascunho para revisão humana.

### POST — dúvida simples

`POST /api/organizations/12/tickets`, `Content-Type: application/json`:

```json
{
  "subject": "Como exportar somente a seleção?",
  "description": "Consigo usar o mapa, mas preciso de orientação para exportar a área selecionada.",
  "priority": "normal",
  "category": "export",
  "demandNature": "question_request",
  "expectedResult": "Exportar somente os registros selecionados e conseguir repetir a operação.",
  "context": "Tela do mapa, comando de exportação.",
  "impact": "individual",
  "urgency": "flexible",
  "priorityReason": "",
  "triageAnswers": {},
  "triageFormVersion": 1
}
```

### POST — defeito com evidências de reprodução

```json
{
  "subject": "A seleção exportada contém registros de fora da área",
  "description": "O arquivo exportado diverge da seleção visível no mapa.",
  "priority": "high",
  "category": "export",
  "demandNature": "defect",
  "expectedResult": "O arquivo deve conter somente os registros selecionados.",
  "context": "Projeto de demonstração, filtro por polígono.",
  "impact": "team",
  "urgency": "blocked",
  "priorityReason": "A equipe não consegue concluir a entrega com o recorte necessário.",
  "triageAnswers": {
    "stepsToReproduce": "Selecionar uma área por polígono e acionar a exportação da seleção.",
    "actualResult": "O arquivo inclui registros visíveis fora do polígono.",
    "affectedVersion": "Versão não identificada; ocorrência na tela de mapa durante a exportação."
  },
  "triageFormVersion": 1
}
```

Os exemplos usam conteúdo fictício e não representam falhas reproduzidas ou dados reais de cliente.

### PATCH — classificar explicitamente um legado

`PATCH /api/organizations/12/tickets/345`:

```json
{
  "demandNature": "question_request",
  "expectedResult": "Compreender como exportar a seleção.",
  "context": "Orientação solicitada na tela do mapa.",
  "impact": "individual",
  "urgency": "flexible",
  "priorityReason": "Demanda de orientação, sem interrupção da atividade.",
  "triageAnswers": {},
  "triageFormVersion": 1
}
```

Estado, domínio, prioridade, prazo e responsável ficam preservados. O servidor registra fonte `human`, ator autenticado, instante e evento da classificação.

### PATCH — alterar prioridade de um legado sem classificá-lo

```json
{
  "priority": "high",
  "priorityReason": "A atividade passou a bloquear a equipe e precisa ser priorizada."
}
```

Se o ticket era legado, continua com `demandNature:null`, `needsTriage:true` e `triageSource:"legacy"`. A mudança de prioridade e seu motivo são registrados; o sistema não inventa natureza, respostas ou data de triagem.

### PATCH — reclassificar dúvida como incidente

```json
{
  "demandNature": "incident",
  "expectedResult": "Restaurar o acesso ao mapa e retomar a atividade.",
  "impact": "team",
  "urgency": "blocked",
  "priorityReason": "A investigação mostrou interrupção da atividade, e não apenas necessidade de orientação.",
  "triageAnswers": {
    "startedAt": "Horário não identificado; percebido na primeira tentativa da manhã.",
    "impactDescription": "A equipe não consegue abrir o mapa utilizado na operação.",
    "workaround": "Ainda não foi identificada alternativa."
  },
  "triageFormVersion": 1
}
```

A natureza muda e as perguntas são substituídas pelo objeto enviado. `priority`, `category`, `dueAt` e `status` não mudam por consequência dessa seleção. O contexto adicional anterior, omitido no exemplo, permanece.

### PATCH — mudar domínio com motivo, sem alterar natureza ou prazo

```json
{
  "category": "database",
  "priorityReason": "O diagnóstico localizou a dificuldade na base de dados usada pela exportação."
}
```

O motivo explica o reenquadramento do domínio. Não modifica natureza, SLA, prazo ou permissão. Em um legado, continua sendo uma atualização independente da classificação completa.

## 6. Consistência e eventos implementados

Com triagem habilitada, criação e atualização usam um batch D1 para manter a mutação do ticket e seus eventos de domínio relacionados na mesma transação local. O evento `ticket.triage.changed` registra valores anteriores/posteriores; criação usa `from:null`. Alterações de prioridade e domínio possuem eventos próprios (`ticket.priority.changed`, `ticket.category.changed`) com `from`, `to` e `reason`. Os eventos identificam ator e instante.

A atualização estruturada compara um snapshot das **11 colunas de triagem** entre a leitura/validação feita pelo servidor e o batch de escrita: natureza, resultado esperado, contexto, impacto, urgência, justificativa, respostas, versão do formulário, fonte, data e ator da triagem. Se qualquer valor desse snapshot mudar nesse intervalo, a escrita protegida retorna `409 TICKET_TRIAGE_CONFLICT`, sem registrar um evento da alteração que não ocorreu.

O snapshot é obtido quando o servidor processa a requisição, não quando a pessoa abriu o formulário. Um formulário já antigo no momento em que o PATCH chega pode ainda enviar valores desatualizados: não existe ETag/versão de ticket enviado pelo cliente nesta entrega. A proteção restrita ao intervalo leitura–batch não é CAS geral, não protege todos os campos do chamado e não implementa a CC-03.

O log administrativo (`audit_logs`) continua separado do batch dos eventos de domínio. Não se afirma auditoria obrigatória global, outbox, criação idempotente, imutabilidade completa ou transação conjunta D1/Dropbox nesta entrega. O fluxo com flag desabilitada mantém o comportamento anterior.

## 7. Erros e comportamento do cliente

O envelope de falha preserva o formato Ticket: `{ok:false,error,code,requestId,stage?}`; `error` é texto público e `X-Request-Id` permite correlação. O conjunto abaixo acrescenta os códigos de triagem; autenticação, autorização, parsing, schema base, validações anteriores e rate limit mantêm seus códigos existentes.

| HTTP / código | Condição | Conduta esperada |
|---|---|---|
| `400 TICKET_TRIAGE_INVALID` | Campo inválido, obrigatório vazio, tipo/enum incorreto, excesso de tamanho, respostas extras ou perguntas incompletas | Corrigir o formulário; preservar o rascunho |
| `400 TICKET_TRIAGE_REASON_REQUIRED` | Requisição que exige motivo não envia justificativa válida | Solicitar motivo novo para prioridade/domínio/natureza |
| `400 TICKET_TRIAGE_FORM_VERSION_INVALID` | Versão diferente do número `1` | Recarregar o formulário compatível; não converter silenciosamente |
| `409 TICKET_TRIAGE_CONFLICT` | Uma das 11 colunas de triagem mudou entre a leitura/validação do servidor e o batch protegido | Recarregar a classificação atual e revisar as respostas antes de tentar novamente |
| `503 TICKET_TRIAGE_DISABLED` | Flag desabilitada e payload contém campo de triagem | Atualizar a capability; não repetir automaticamente removendo conteúdo digitado |
| `503 TICKET_TRIAGE_SCHEMA_OUTDATED` | Flag habilitada sem schema completo para escrita | Bloquear escrita; equipe responsável verifica disponibilidade e pré-requisito de schema |
| `400 EMPTY_PATCH` | Nenhum campo de edição reconhecido e nenhum campo de triagem elegível | Não enviar PATCH vazio |

Precisão do motivo: quando a propriedade `priorityReason` é omitida em uma alteração que exige justificativa, o código específico é `TICKET_TRIAGE_REASON_REQUIRED`. Quando a propriedade é enviada com texto vazio ou tipo/tamanho inválido, a validação textual pode retornar `TICKET_TRIAGE_INVALID`. Ambos significam que a operação não deve prosseguir sem justificativa válida; o cliente não deve depender exclusivamente de um código para validar esse campo.

A UI valida campos e comprimentos antes do envio, conserva o formulário em erro de rede/servidor e permite nova tentativa. Em detalhe, um refresh de anexos não substitui automaticamente o rascunho modificado. Classificação/prazo não são descartados silenciosamente para contornar erro de capability. O controle no navegador não substitui validação e autorização no servidor.

## 8. Pré-requisito de migration e limites do rollout

**Migration pendente de confirmação:** `0025_ticket_triage_classification.sql`, no D1 vinculado à aplicação em cada ambiente alvo. Ela acrescenta campos, defaults e checks de classificação/procedência, além do índice `(organization_id, demand_nature, created_at DESC, id DESC)`; não preenche classificação por inferência em registros antigos.

O banco de produção de referência do projeto é `maono_maps`; ID/binding e ambientes Preview/produção precisam de verificação e confirmação próprias. Aplicar e confirmar a migration é pré-requisito **antes** de habilitar `MAONO_TICKET_TRIAGE_ENABLED=true`. Este documento não autoriza nem declara aplicação. Build, teste, Preview e merge verdes não comprovam schema aplicado.

A flag desabilitada permite manter o protocolo anterior durante a expansão compatível de schema. Nenhuma rotina aplica a migration automaticamente. Os gates históricos das migrations 0021/0022/0023 e do rollout de Change Requests permanecem independentes e não são liberados pela CC-02.
