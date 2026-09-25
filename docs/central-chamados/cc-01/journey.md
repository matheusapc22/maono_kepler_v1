# CC-01 — Jornada e ensaio do atendimento

**Artefato de desenho, não implementação do domínio.** O protótipo [prototype.html](prototype.html) funciona offline, com conteúdo fictício, e permite ensaiar os cenários CT-02 de dúvida e incidente. Não realiza chamadas HTTP, não usa bibliotecas externas, não persiste dados e não muda permissões. Abrir o arquivo em um navegador moderno; não é necessário iniciar a aplicação.

O walkthrough com pessoas **não foi realizado**. Os roteiros e registros abaixo estão preparados para sua execução. A validação técnica do arquivo e uma simulação automatizada não equivalem a pesquisa com usuários ou aceite humano.

## Base e decisões de desenho

O contrato atual inspecionado em `src/pages/Projects/components/ticket-types.ts` possui cinco estados (`new`, `open`, `in_progress`, `in_review`, `closed`), três prioridades (`low`, `normal`, `high`) e domínio em `category`. A UI da Central fica em `/projects`, na seção `requests`. O protótipo preserva os rótulos existentes e toma como referência visual `src/maono-design-tokens.css` e `src/pages/Projects/projects.css`: superfícies escuras, dourado como destaque de marca e cores semânticas separadas.

| Elemento | Situação atual / proposta neste ensaio |
|---|---|
| Estados e rótulos de prioridade | Existentes; mantidos no protótipo |
| Natureza separada do domínio | Proposta; Dúvida/solicitação e Incidente demonstrados. O catálogo-alvo também inclui Defeito, Melhoria/mudança e Problema recorrente |
| Impacto, urgência, justificativa e resultado esperado | Proposta de triagem; não compõem política de SLA vigente |
| Conversas, confirmação do resultado, motivo de espera e reabertura com ciclo | Propostas; ações locais do protótipo não comprovam existência dos endpoints |
| Perfil Atendente ou Gestor/revisor | Personagem para ensaiar tarefas; não é novo papel de autorização criado no produto |
| Edição, status e atribuição atuais | O PATCH atual exige `ticket.manage`. Permissões `ticket.comment`, `ticket.close` e `ticket.assign` catalogadas não comprovam enforcement granular nessa rota |
| Vínculo técnico atual | CR MapConfig é entidade distinta, sujeita a permissões de projeto. O vínculo não concede revisão |
| Registro geral de mudança | Proposta CC-08 para plataforma/banco/acesso; ACL própria. Não oferece Apply genérico, execução SQL ou concessão de acesso |
| Revisão e Apply | No código atual, Apply pode chamar `ensureApproved`; a separação explícita de decisão/execução é contrato a reconciliar em CC-08. O protótipo nunca aprova ou aplica |

**Hipóteses de jornada para validação:** `new` significa recebimento ainda sem triagem; `open` significa triagem registrada, aguardando assumir a próxima ação; a espera é atributo, não um sexto estado. Neste ensaio, o solicitante confirma o resultado antes do fechamento pelo atendimento; esse critério deverá ser validado para cenários com ausência de resposta, sem inventar encerramento automático ou SLA. Os dois cenários demonstram conclusão normal com resultado confirmado. Desfechos como duplicidade, desistência ou recusa precisam de motivo e comunicação próprios, conforme o contrato de domínio, sem exigir uma execução ou confirmação impossível; essas exceções não estão implementadas neste ensaio. Reabertura do mesmo problema volta a `open`, inicia outro ciclo e preserva histórico. Novo escopo deverá originar outro chamado relacionado, fora da interação demonstrada.

## Quem conduz, próximo passo e saída de cada etapa

| Estado existente | Quem conduz / participa | Próximo passo proposto | Resultado necessário para sair |
|---|---|---|---|
| `new` — Novo | Fila de triagem; solicitante fornece contexto | Classificar natureza e domínio, impacto e urgência; registrar prioridade justificada | Demanda compreendida e resultado esperado explícito |
| `open` — Aberto | Fila de atendimento; pessoa ainda a atribuir | Assumir atendimento e informar a ação seguinte | Responsável identificado e continuidade visível |
| `in_progress` — Em andamento | Atendente responsável; solicitante fornece evidências | Orientar ou restaurar, registrar atualizações e eventual espera | Resultado proposto com evidência; espera encerrada explicitamente |
| `in_review` — Em revisão | Atendente continua responsável; solicitante verifica | Confirmar resultado ou devolver ao atendimento; registrar motivo e comunicação de conclusão | Resultado compreendido/verificado e conclusão comunicada |
| `closed` — Concluído | Atendimento mantém registro do resultado | Acompanhar conclusão; permitir contestação fundamentada do mesmo problema | Histórico preservado; novo ciclo quando houver reabertura |

Atribuição não é primeira resposta. Confirmação automática de abertura não é primeira resposta humana de atendimento. Data alvo não é SLA. A espera identifica motivo e próxima ação; nenhuma pausa de relógio de SLA é calculada neste arquivo. Métricas, calendário, notificações, anexos e persistência são entregas posteriores.

## Cenário 1 — Dúvida sobre exportação

**Ticket fictício:** TKT-DEMO-001, organização Exemplo. O solicitante consegue trabalhar, mas não sabe exportar somente a seleção do mapa. Natureza: Dúvida/solicitação. Domínio: Exportação. Resultado desejado: conseguir exportar a seleção e repetir a operação com autonomia.

1. Solicitante encontra o recebimento, a fila de triagem e o próximo passo. Abre “Como acontece?” e “Ver resultado esperado”.
2. Atendente registra impacto individual, urgência flexível e prioridade **Normal**, com justificativa. Normal é fixture ilustrativa; a decisão humana pode selecionar Baixa ou Alta mediante motivo.
3. Atendente assume a tarefa. Atribuição aparece no histórico, sem contabilizar resposta ou prometer prazo.
4. Atendente registra orientação; solicitante registra o retorno do teste. Se faltar contexto, o atendimento registra espera com motivo e a encerra explicitamente ao retomar.
5. Atendente apresenta evidência de que a exportação contém apenas os registros selecionados. O chamado entra em Em revisão; nenhuma mudança é aprovada.
6. Solicitante confirma o resultado. Atendente preenche motivo e comunicação, concluindo o chamado.
7. Para ensaiar contestação, solicitante informa que a mesma dificuldade continua e reabre. O estado volta a Aberto, o ciclo aumenta e os eventos anteriores continuam consultáveis.

Uma dúvida resolvida por orientação não exige criar uma CR. O botão de mudança permite apenas explorar um vínculo opcional com objeto de revisão separado.

## Cenário 2 — Incidente de acesso ao mapa

**Ticket fictício:** TKT-DEMO-002, organização Exemplo. Toda a equipe deixou de conseguir abrir o mapa de trabalho. Natureza: Incidente. Domínio: Mapa. Resultado desejado: restabelecer ou mitigar o acesso e confirmar a retomada da tarefa.

1. Solicitante identifica o recebimento e a triagem pendente, sem confundir a confirmação automática com atendimento ou garantia de prazo.
2. Atendente registra impacto na organização, operação interrompida e prioridade **Alta**, com justificativa. Esses valores ilustram o caso; não definem severidade ou SLA universais.
3. Atendente assume a coordenação. Registra a próxima ação e atualizações compreensíveis.
4. Durante dependência de evidência, registra espera com motivo. O chamado permanece Em andamento e mantém responsável; não se calcula pausa de SLA.
5. Após retomar, registra evidência da restauração e solicita verificação do resultado. A investigação técnica pode continuar em mudança relacionada.
6. Solicitante confirma que a tarefa voltou a funcionar. Atendente registra motivo e comunicação antes da conclusão.
7. Se o mesmo incidente reaparecer, reabre-se outro ciclo do chamado com motivo. A mudança relacionada conserva sua revisão; reabrir ou fechar o atendimento não decide a mudança.

## Impacto, urgência e prioridade

Os três campos respondem a perguntas diferentes. Não há fórmula automática neste ensaio.

| Campo | Pergunta de triagem | Opções ilustradas |
|---|---|---|
| Impacto | Quem ou qual atividade foi afetada? | Uma pessoa; parte da equipe; organização inteira |
| Urgência | A atividade pode continuar? Existe alternativa? | Pode continuar; alternativa limitada; interrompida |
| Prioridade | Em que ordem a equipe deve tratar este caso, considerando impacto e urgência? | Baixa (`low`), Normal (`normal`), Alta (`high`) |
| Justificativa | Por que essa prioridade faz sentido neste contexto? | Texto obrigatório no ensaio, registrado pela triagem |

Exemplos para discussão: ajuste sem bloqueio pode ser Baixa; orientação necessária com atividade em andamento pode ser Normal; interrupção de toda a operação pode ser Alta. Uma falha individual também pode ser Alta conforme impacto na tarefa e prazo real. O responsável pode revisar a escolha, mantendo motivo e histórico; não inferir SLA a partir do rótulo.

## Mudança e autorização no protótipo

O botão “Explorar vínculo de mudança” permite selecionar CR técnico MapConfig ou registro geral de mudança. Somente personagens do atendimento vinculam uma proposta fictícia. O vínculo não altera o estado do chamado nem concede direitos de revisão.

- **CR técnico MapConfig:** o estado e a decisão canônicos pertencem à CR e ao projeto. Um registro geral que a referencie apenas projeta andamento, sem segunda aprovação paralela.
- **Registro geral:** revisão depende de sua própria ACL e capacidade de mudança. Proposta de banco/acesso não contém executor SQL ou mecanismo de concessão de acesso.
- **Solicitante/atendente:** veem a representação segura do vínculo, sem detalhe técnico de revisão neste fixture.
- **Gestor/revisor autorizado:** personagem com direito de revisão fictício; pode registrar parecer, preservando estado Em revisão. Não existe botão para aprovar ou aplicar.

Selecionar personagem é um controle do ensaio, não mecanismo de segurança. A implementação real deve autorizar cada objeto e operação no servidor. Na UI real, a própria existência ou metadados da mudança restrita podem precisar ser omitidos; o marcador do protótipo é didático e fictício, não um contrato de exposição.

## Catálogo de mensagens da jornada

| Código de desenho | Momento | Texto proposto / intenção | Situação |
|---|---|---|---|
| J-01 | Recebimento | “Chamado recebido. A equipe fará a triagem e indicará a próxima ação.” | Proposta; sem prazo inventado |
| J-02 | Triagem incompleta | “Explique a prioridade antes de registrar a triagem.” | Implementado apenas na simulação |
| J-03 | Assumir tarefa | “Atendente Exemplo assumiu o acompanhamento e informou o próximo passo.” | Simulação; atribuição não é resposta |
| J-04 | Espera | “Espera registrada como atributo; estado preservado.” | Simulação; não pausa SLA por inferência |
| J-05 | Retomada | “Atendimento retomado.” | Simulação com evento próprio |
| J-06 | Evidência ausente | “Registre uma evidência do resultado antes da verificação.” | Simulação |
| J-07 | Confirmação | “Resultado confirmado. Atendimento ainda precisa registrar a conclusão e a comunicação.” | Simulação; confirmação não fecha sozinha |
| J-08 | Fechamento incompleto | “Motivo de conclusão e comunicação são obrigatórios.” | Simulação |
| J-09 | Reabertura | “Explique por que o mesmo problema exige reabertura.” | Simulação com novo ciclo |
| J-10 | Vínculo sem direito | “O link não fornece autorização de revisão.” | Simulação didática; contrato real protege também existência/metadados |
| J-11 | Parecer | “Parecer registrado. Estado Em revisão preservado; nenhuma aprovação ou Apply.” | Simulação; decisão separada |
| J-12 | Sucesso parcial futuro | “O chamado foi criado. Alguns anexos falharam; repita apenas os arquivos pendentes.” | Contrato a detalhar na entrega de anexos; não há upload aqui |
| J-13 | Conflito futuro | “O chamado mudou desde sua última leitura. Confira a versão atual antes de tentar novamente.” | Proposta para CAS/412; não há concorrência de servidor aqui |

Mensagens de estado usam região `role=status` com atualização não intrusiva. Modais têm título e fechamento por botão/Escape; controles nativos permitem teclado. Dourado representa marca; cores semânticas não são o único indicador de estado.

## CT-02 — Roteiro de walkthrough com pessoas

**Objetivo:** verificar se solicitante e atendente entendem a natureza da demanda, quem conduz, qual o próximo passo e como reconhecer uma conclusão. Observar também a diferença entre atendimento e revisão de mudança.

**Participantes necessários:** ao menos uma pessoa no papel de solicitante e uma no papel de atendimento; gestor/revisor pode participar da etapa de mudança. Registrar pseudônimos, consentimento apropriado ao processo interno e contexto da tarefa; não inserir dados de clientes. O número é proposta operacional para este primeiro ensaio, não amostra que permita inferência estatística.

**Condução:** abrir `prototype.html` offline. Não explicar previamente a resposta esperada às perguntas. Pedir à pessoa para pensar em voz alta, observar hesitações e separar comportamento observado de interpretação. O facilitador pode trocar o personagem quando for necessário continuar uma etapa externa, registrando a ajuda. Troca de cenário/reinício descarta o estado daquele ensaio; os registros do walkthrough devem ficar na tabela, não no protótipo.

| Passo CT-02 | Tarefa ou pergunta ao participante | Critério observável |
|---|---|---|
| 01 | Escolha Dúvida como Solicitante. O que aconteceu e quem deve agir agora? | Distingue recebimento de triagem e atendimento |
| 02 | Qual é o resultado desejado? Onde ele aparece? | Encontra e explica o resultado da tarefa, sem confundir com status |
| 03 | Como Atendente, classifique impacto, urgência e prioridade. Explique a escolha. | Separa natureza/domínio e justifica prioridade; não presume SLA |
| 04 | Assuma a tarefa. Quem conduz e o que fará em seguida? | Identifica responsável e próximo passo |
| 05 | Registre uma atualização e uma espera. O estado mudou? Quem acompanha? | Reconhece espera como atributo e mantém responsável |
| 06 | Retome e apresente o resultado. A revisão aprovou uma mudança? | Distingue verificação do atendimento de aprovação CR |
| 07 | Como Solicitante, conteste uma vez; como Atendente, apresente nova evidência; depois confirme. | Entende devolução ao atendimento e verificação explícita |
| 08 | Como Atendente, conclua com motivo e comunicação. | Identifica evidência e informação transmitida, não apenas status |
| 09 | Reabra pelo mesmo problema. O que foi preservado e o que mudou? | Novo ciclo; histórico e eventual mudança separados |
| 10 | Repita para Incidente. O que precisa ser restaurado e verificado? | Distingue restauração de investigação técnica posterior |
| 11 | Explore vínculo e parecer com o personagem revisor. Quem autoriza a mudança? | Entende autorização própria e ausência de autoaprovação/Apply |
| 12 | Percorra controles por teclado e em tela estreita. | Acesso às ações e mensagens, foco e leitura utilizáveis |

**Aceite humano proposto:** os dois perfis centrais conseguem explicar responsável, próximo passo e resultado esperado nos dois cenários; não interpretam atribuição como resposta, prioridade como SLA, espera como novo estado ou vínculo como permissão. Se houver erro conceitual ou tarefa bloqueada, registrar achado, ajustar desenho e repetir a parte afetada. Não declarar aprovado apenas porque o HTML funciona.

### Registro do walkthrough — pendente

Esta tabela é o modelo a transcrever para a aba de controle da entrega CT-02. Não contém resultados inventados.

| Sessão / data | Participante / papel | Cenário / passos | Responsável compreendido? | Próximo passo compreendido? | Resultado compreendido? | Ajuda / achado / evidência | Decisão / responsável / prazo | Status |
|---|---|---|---|---|---|---|---|---|
| A preencher | Solicitante | Dúvida / 01–09 | Pendente | Pendente | Pendente | Não executado | A definir | Pendente de walkthrough humano |
| A preencher | Atendimento | Dúvida / 03–09 | Pendente | Pendente | Pendente | Não executado | A definir | Pendente de walkthrough humano |
| A preencher | Solicitante | Incidente / 10 | Pendente | Pendente | Pendente | Não executado | A definir | Pendente de walkthrough humano |
| A preencher | Atendimento | Incidente / 10 | Pendente | Pendente | Pendente | Não executado | A definir | Pendente de walkthrough humano |
| A preencher | Gestor/revisor | Vínculo / 11 | Pendente | Pendente | Pendente | Não executado | A definir | Pendente de walkthrough humano |

Registrar também versão/commit do protótipo, navegador/viewport, evidência autorizada e se a pessoa realizou a tarefa sem ajuda. Uma decisão de aceite deve apontar para esses registros e não substituir campos pendentes por sucesso implícito.

## Limites da entrega CC-01

Este arquivo HTML e esta jornada não criam tabelas, endpoints, permissões, UI de produto, migrations ou automações. O fluxo não mede tempos, envia mensagens, anexa arquivos, aplica CRs ou grava auditoria real. Não há dados reais nem chamadas de rede. A interface de produção, persistência de rascunhos, concorrência, acessibilidade abrangente e testes autenticados ficam nas PRs correspondentes do planejamento; os controles visuais aqui servem para validar a jornada antes dessas mudanças.

**Migration:** nenhuma criada ou necessária para abrir este protótipo. Dependências históricas da Central/CR continuam com seu estado operacional próprio; uma simulação local não confirma aplicação de schema remoto nem libera os gates 0021/0022/0023.
