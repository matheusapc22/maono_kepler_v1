# CC-16 — Execução de experiência e acessibilidade

REQ-CC-35/36 · CT53/54 · branch `feat/cc-16-central` · base `mano_kepler_v1`.
Baseline: `1f37c8c03c12c003a8b0776dab5d07cf4c5e5552` (CC15/PR215).
Registro: 29/09/2026. Implementação e evidência automatizada locais; aceite humano e produção permanecem abertos.

Planejamento e controle: https://docs.google.com/spreadsheets/d/19z4Agp5YZHPDTefzolldHzvhiPi3NRXpqy4p52HB-R0/edit
PDFs aprováveis de planejamento: https://drive.google.com/drive/folders/1d4idGeUJcgWDVdoSr13gy6KFXCvqhqdo

## Baseline e mapa de superfícies

| Superfície | Componentes | Contrato preservado |
|---|---|---|
| Entrada e navegação | TicketsSection, TicketListView, TicketKanbanView, TicketCalendarView | filtros, deep-links, seleção alternativa ao arrastar; CC09 |
| Criação/classificação | NewTicketPopover, TicketTriageFields | cinco naturezas, limites, campos obrigatórios e intenção CC02/03 |
| Detalhe e ciclo | TicketDetailDrawer, TicketLifecyclePanel | ETag/CAS, espera, encerramento e reabertura CC03 |
| Conversa e anexos | TicketConversationPanel, TicketAttachmentList | audiência, rascunho, upload retomável e ACL CC04/05/06 |
| Operação | TicketChanges, TicketSlaPanel | decisão separada de Apply; parâmetros aprovados CC08/10 |
| Relatórios | TicketMetricsPanel, TicketExportsPanel | população, geração e exportação completa CC11/12 |
| Casos e conhecimento | TicketCasesPanel, TicketKnowledgePanel | privado, revisão editorial, proveniência CC13/14 |
| Resultado e esforço | TicketFeedbackPanel | consentimento e instrumento aprovado CC15 |

Nenhuma capacidade, flag, política, limite, binding ou backend foi alterado. A existência do código na baseline não comprova flag ativa nem SHA servido em produção.

## Problemas reproduzidos e mudanças

1. Efeitos de foco dependiam da identidade de `onClose`: renderizações podiam mover o foco para o início. O hook compartilhado usa callback atual sem reiniciar, cancela timers, considera visibilidade/fieldset disabled, contém Tab/Shift+Tab, trata o diálogo superior e devolve foco ao acionador conectado.
2. Atualização da conversa substituía texto ainda não salvo e a troca de audiência descartava alterações. Atualizações preservam o rascunho local e sua versão original; a troca salva primeiro ou permanece na audiência atual após falha.
3. Conflito de rascunho exige revisão explícita antes da adoção da versão do servidor. Falha ao persistir retorna ausência de confirmação, impedindo o envio de um rascunho antigo.
4. Envio ambíguo preserva chave e payload. “Verificar envio anterior” repete exatamente a requisição original, inclusive após consumo do rascunho. Campos ficam bloqueados; o drawer espera confirmação antes de fechar. Não há persistência do payload em armazenamento local do navegador.
5. Fechar criação mantém o formulário na mesma sessão/organização. Escape durante criação/upload informa espera. Fechar detalhe pede confirmação quando há alterações não confirmadas ou upload; troca forçada de contexto limpa estado e aborta upload. Callbacks de upload cancelado não anunciam sucesso.
6. Seletores nativos de arquivo continuam acessíveis por teclado; retomadas de anexos de rascunho ficam no compositor, sem exigir edição de mensagem enviada.
7. Compositor e edição têm nomes acessíveis; audiência informa seleção; progresso numérico usa `progressbar`; marcos de operação usam anúncio estável, sem anunciar cada chunk. Alertas duplicados no erro de detalhe foram removidos.
8. Foco visível, quebra de texto, reflow e respeito a movimento reduzido foram acrescentados aos componentes afetados. A revisão visual local em 320px não mostrou overflow horizontal.

## Contrato de interação implementado

| Estado | Informação e ação |
|---|---|
| Editando | Texto local preservado; diferença entre não salvo, salvando e salvo |
| Persistência falhou | Erro visível; conteúdo permanece; não confirmar envio usando versão antiga |
| CAS 412/428 no rascunho | Preservar texto; mostrar versão atual; adoção somente por ação explícita |
| Envio incerto | Bloquear edição/audiência; verificar a intenção anterior sem gerar nova chave |
| Operação em curso | Informar espera; impedir fechamento que descarte resultado desconhecido |
| Anexo parcial | Manter chamado criado e apresentar arquivos falhos, retry/retomada ou conclusão explícita |
| Revogação/troca de contexto | Remover conteúdo não autorizado; não transportar rascunho para outra organização |
| Diálogo | Tab e Shift+Tab contidos, Escape consistente, retorno ao acionador |

Esse contrato técnico é verificável em testes; a aprovação de UX/Produto e responsáveis nominais (D01-D06) não foi presumida.

## Validação

- `node --test tests/ticket-*.test.mjs`: **590/590**.
- Regressão de browser: **32 testes existentes** das integrações CC07/08/10/11/12/13/14/15, todos aprovados (execução inicial conjunta: 38/38 com seis testes novos).
- `tests/browser/ticket-accessibility.spec.ts`: **9 testes novos**, cobrindo preservação de texto, CAS, replay, audiência/revogação, retomada, foco/teclado, fechamento com rascunho, espera com fieldset desabilitado e limpeza por organização/reflow.
- `npm run build`: aprovado (avisos existentes de dependências/chunks).
- `npx tsc -b`: aprovado no código final.
- `npm run test:preview-safety`: **23/23**, gate OK.
- Auditoria `audit-user-error-sinks.mjs --strict-baseline`: aprovada, inventário sem regressão.
- CI: job `cc16-experience-accessibility` executa Chromium sobre o head da PR, com artefatos de falha. Resultado remoto deve ser associado ao SHA final no controle.

Fixtures HTTP locais não demonstram aceite de leitor de tela real, compreensão de usuários, deployment, nem escrita em produção. Não há certificação geral WCAG nesta entrega.

## Schema e publicação

Revisão do diff contra a baseline: **sem migration**. Não há mudança em SQL, `schema.sql`, funções de API, workers, bindings ou dependências. Não criar 0039 nem reaplicar 0038 por causa da CC16. A recuperação é por reversão da aplicação, mantendo schema/ledger existentes.

A PR deve ser revisada antes do merge. Depois, registrar o SHA servido e executar aceite controlado com capacidades atuais; Preview continua fail-closed para mutações. Esta execução não autoriza ativação de flags, mudança de parâmetros ou ações produtivas de teste.

## Pendências e sequência para encerramento

| ID | Próximo passo | Papel responsável | Evidência exigida |
|---|---|---|---|
| C16-P01 | Revisar PR/CI e realizar merge quando aprovado | Revisor/maintainer | revisão, checks e SHA mergeado/servido |
| C16-P02 | Executar CT53 real por teclado e leitor, incluindo zoom/contraste e anúncios | QA/UX a designar | SO, navegador, leitor e versões; passos, achados e reteste |
| C16-P03 | Executar CT54 nas 15 jornadas da aba Jornadas | Produto/UX a designar | participantes/consentimento, ambiente/SHA, compreensão, falha parcial, reabertura e reteste |
| C16-P04 | Regularizar operador de aceite PR201 | Operador/engenharia | PR201 segue aberta com conflito; solução revisada e suítes aprovadas |
| C16-P05 | Confirmar flags, atores, fixtures, parâmetros aprovados e cleanup dos módulos herdados | Operador/produto | D01-D06 e pendências CC15/heranças resolvidas ou explicitamente aceitas |
| C16-P06 | Fazer aceite integrado após merge e fechar gates G03-G07 | QA/produto | evidência do ambiente alvo, sem depender apenas de mocks |
| C16-P07 | Formalizar passagem CC17 após aceite CC16 | Produto/operador | pendências com dono e decisão; segurança/caos/carga não executados implicitamente |

As 12 pendências da CC15 e 20 heranças CC14/CC13 continuam registradas no controle. Merge e migration da CC15 já confirmados não as encerram automaticamente. O fluxo de QA controlado em produção anteriormente escolhido não foi substituído por exigência de homologação isolada.

## Roteiro manual CT53/54

Para cada papel (solicitante, atendente, gestor) e natureza (dúvida/solicitação, incidente, defeito, melhoria/mudança, problema recorrente): abrir e preencher campos aplicáveis; anexar com teclado; localizar estado/erro; consultar conversa na audiência permitida; provocar falha parcial e conflito em fixture autorizada; recuperar sem duplicar; acompanhar fila/SLA/caso/mudança/exportação/conhecimento/feedback quando aplicável; encerrar e reabrir usando as capacidades reais do papel. Nunca ampliar ACL para completar roteiro.

Registrar por jornada: participante, consentimento, papel/natureza, SHA servido, flags, leitor/navegador/SO, tarefa, resultado compreendido, dificuldade, severidade, responsável e reteste. Solicitantes não devem executar ações exclusivas de gestão. Não marcar CT53/54 aprovados apenas porque os testes de browser passaram.

Contenção: diante de envio incerto, manter painel e verificar a tentativa original; diante de CAS, revisar conteúdo atual antes de adotar nova versão; diante de upload interrompido, retomar a sessão do mesmo arquivo; diante de revogação, recarregar e respeitar a restrição. Não reenviar automaticamente com chave nova nem modificar banco para contornar o fluxo.
