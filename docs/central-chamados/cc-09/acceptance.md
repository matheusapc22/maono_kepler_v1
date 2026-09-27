# Aceite CC-09 — evidência e pendências

## Executado localmente

- SQLite real:250 itens com empates nos4 sorts, inserção e edição entre páginas; nenhum ID omitido/duplicado na composição congelada.
- ACL reavaliada, contagem sem privados, revogação, token de outro ator/org/query/expirado rejeitado, rollback e limpeza cascade.
- Paginação por coluna até250 itens; filtros de prazo/sem data; CAS concorrente na última vaga, exceção auditada, edição concorrente de política e HTTP sem ticket.manage rejeitado.
- Chromium com componentes reais/cliente HTTP real e respostas fictícias: lista até250, Kanban até250, filtros/voltar/reload, deep-link404, resposta atrasada descartada na troca de organização upload interrompido na troca de organização, paginação por teclado e calendário mobile. Não equivale a login/aceite em ambiente remoto.
- TypeScript, build e regressões anteriores. Comandos/resultados exatos em `evidence/validation.json`.
- Benchmark SQLite com1000 itens, página50,5 amostras: primeira página7–13ms, seguinte5–7ms nesta máquina. Orçamento local proposto500ms/página; P95 remoto proposto1500ms, **ainda não medido/validado**. Não usar benchmark local como SLA.

## Pendências com responsável

| Item | Situação | Responsável / próximo passo |
|---|---|---|
| Revisão/merge/CI/Preview CC09 | Pendente | Revisor/Matheus: revisar PR e checks no SHA final |
| Migration0032 produção | Pendente | Operador/Matheus: audit → hash autorizado → apply isolado → postvalidate |
| Operador acceptance PR201 | Bloqueio confirmado nesta entrega: PR aberta, não mergeada | Revisor/Matheus: concluir revisão e publicação protegida na main |
| Suíte versionada CC09 registrada no operador | Pendente, depende da base PR201 | Codex após merge do operador: implementar/registrar suíte revisada e validar cleanup/restore; não existe suíte executável de produção nesta PR |
| CT30/31/32 autenticados | Não executados | Operador: QA com250 fixtures, perfis autorizado/restrito, allowlist e closure |
| Troca de organização durante upload remoto | Não comprovada em produção | Operador: arquivo QA controlado, interromper cliente, verificar sessão/escopo original e cleanup |
| Integração do link com sessão real entre organizações | Local tipado; sessão remota não exercitada | Operador: associação/revogação e falha de switch sem exposição |
| P95 D1, acessibilidade assistiva e carga | Pendente no ambiente real | Operação: medir consultas/linha lida, taxa409/429/503, teclado/leitor de tela |
| WIP de produção | Não definido | Equipe define capacidade por fila; nenhum valor foi aplicado |
| Rollout permanente | Não autorizado nesta entrega | Matheus/operação após aceite |
| CC08 herdada CT26–29/52, Worker/flags | Continua pendente | Controle CC08; não encerrar por avanço da CC09 |

## Roteiro para futura suíte protegida

Fixar produto/deployment/SHA, verificar D1/ledger0032, perfil QA dedicado e isolamento. Registrar flags anteriores em artefato de restauração antes de qualquer mudança. Ativar apenas organização QA na allowlist. Criar250 chamados com prefixo único e registrar todos os IDs. CT30:4 ordenações, páginas25/50, empates, inserção/edição/revogação entre páginas e expiração. CT31:mesmos filtros/contagens nas3visões, sem data, duas entradas concorrentes na última vaga, exceção explícita e evento, restaurar política com CAS. CT32:deep-link autorizado/negado, Back/Forward, lista/detalhe atrasados, upload ao trocar organização, nenhum conteúdo cruzado.

Cleanup somente de fixtures identificadas, usando as APIs/comandos permitidos; registrar resíduos e nenhum SQL arbitrário. Restaurar flags/allowlist/políticas mesmo após falha; produzir closure independente e evidência sanitizada. Se preparo, autorização, limpeza ou restore falhar, bloquear aprovação.

Canário: uma organização acordada, janela acompanhada, métricas por fila (latência, erros, conflitos, WIP, idade e snapshot429). Parar em vazamento, perda/duplicação, bypass WIP ou degradação acima do orçamento acordado. Desligar flag/retirar allowlist preserva dados; políticas existentes tornam entradas fail-closed. Reverter binário para código antigo só após avaliar WIP, pois binário antigo desconhece a proteção nova. Recuperação de D1 não é automática.
