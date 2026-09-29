# Decisões de implementação CC-13

Estas decisões concretizam o pedido de execução. Aprovação de budgets, responsáveis nominais, retenção e janela operacional permanece pendente; não se presume aprovação de rollout.

## D01 — Estados independentes

| Entidade | Transições |
|---|---|
| Incidente | aberto → mitigação/restaurado; mitigação → restaurado; restaurado → encerrado/aberto; encerrado → aberto |
| Problema | aberto → investigação; investigação → ação definida/resolvido; ação definida → resolvido/investigação; resolvido → investigação |

Transição exige motivo. Restaurar/encerrar exige descrição da restauração verificada; resolver problema exige conclusão. Causa desconhecida é `unknown`, com causa/evidência vazias; `hypothesis` exige descrição; `confirmed` exige descrição e evidência. A evidência é informação revisada pelo operador, não uma validação automatizada de causalidade. Mitigação e restauração não exigem causa conhecida. Reabertura preserva eventos. Datas são normalizadas em UTC.

## D02 — Audiência e autorização

Ator precisa estar ativo, pertencer à organização ativa e possuir `ticket.view`; escrita também exige `ticket.manage`. Registro privado é visível ao criador, coordenador ou membros explícitos, sempre em conjunto com essas permissões. Coordenação não concede capacidades de ticket, CR ou exportação. Registro organizacional é acessível aos membros elegíveis. Não há bypass do predicado privado por papel administrativo.

Cada vínculo reautoriza seu alvo: CC04 para ticket; audiência própria para incidente/problema; CC08 e projeto/CR para mudança. Alvo negado não aparece no detalhe ou em eventos de vínculo, incluindo ID e relação. Busca/lista filtram antes de paginar; não retornam total irrestrito. Versões públicas são hashes opacos, não contadores de eventos ocultos. Leitura/escrita usam geração da fonte e revalidação; conflito exige atualizar. Compartilhar audiência compartilha o texto e histórico do próprio registro: autores devem revisar o conteúdo livre antes de compartilhar. O sistema não copia textos privados dos alvos.

## D03/D04 — Relações, concorrência e trilha

`related` ou `implements`; deduplicação somente entre registros do mesmo tipo: `duplicate_candidate` → `duplicate_confirmed|duplicate_rejected`, com motivo humano. Não funde nem apaga entidades. FKs compostas e triggers proíbem relações cross-tenant. IDs de CR com prefixo `cr:` são suportados.

Comando idempotente por organização/ator/chave e hash do payload; replay divergente conflita. A versão numérica interna usa CAS; recibo, estado, membros/relações e evento são um único `D1.batch`, com geração verificada antes da primeira escrita. Rollback cobre todos esses efeitos. Eventos têm proteção SQL contra UPDATE e DELETE; correções são novas revisões. Não existe endpoint de exclusão de registros/eventos.

## D05 — Comunicação e post-mortem

Comunicação é uma ação explícita: texto revisto pelo humano, chamado já vinculado e autorizado, resposta ou nota interna. Não copia título, causa ou post-mortem automaticamente. CC05 mantém mensagem/evento/outbox na mesma transação, cercada pela geração CC13; CC07 mantém a reautorização de destinatários. Próxima atualização, substituição de coordenador e ações são registradas, mas não há agendamento automático ou SLA de comunicação inferido. Retenção/redação de dados históricos e responsáveis substitutos são decisões operacionais pendentes; não foi criada rotina de purga.

## D06 — Contrato CC12-C

`report:causes` seleciona tickets autorizados com ao menos um incidente/problema autorizado diretamente vinculado. `report:incidents` exige ao menos um incidente autorizado; em ambos, a coluna `cases_json` contém os incidentes **e problemas** autorizados daquele ticket. Uma linha por ticket; cada registro aparece uma vez por linha; manifestos contabilizam registros distintos e relações ticket–registro separadamente. Não há expansão transitiva nem dados de CR/alvos privados.

Manifesto versão 2, extensão `causes.version=1`: `records`, `relations`, `unknownCauses` (registros distintos desconhecidos). Nenhuma hipótese vira causa confirmada. `revision` opaca e `updatedAt` fixam a versão capturada. As causas representam o estado corrente capturado consistentemente; `asOf` segue governando a projeção histórica das métricas de ticket, não reconstrói causas retroativas. Relatórios anteriores mantêm manifesto v1 e formato original.

Mudanças de registros, membros, links e eventos incrementam a geração CC12. Mutação durante captura invalida o snapshot, inclusive entre autorização e publicação da partição. Status, manifesto e download reautorizam todos os registros e relações capturados; revogar um deles bloqueia o arquivo inteiro. CSV mantém `text-v1`, incluindo o JSON de causas; não inclui notas internas ou corpos de conversa. Bytes já baixados não podem ser recolhidos.

## D07 — Limites técnicos da versão inicial

Lista com 20 itens, até 100 relações por registro, até 100 registros autorizados por ticket exportado, 30 membros adicionais e 200 revisões por registro; corpo HTTP de 24.000 bytes, título de 200 caracteres, post-mortem de 6.000 e demais textos de 2.000. Os limites de relações/revisões são totais internos: ao atingir o limite, novas mutações falham, sem apagar/truncar história ou publicar dados parciais. A revisão 200 é legível; a revisão 201 é recusada. Essa limitação exige avaliar o volume esperado e ampliar/paginar o histórico antes de liberar organizações que possam excedê-la. Não são budgets de negócio aprovados.

Geração global conservadora pode causar conflitos por alterações paralelas não relacionadas. Operador deve medir latência, consultas D1, taxa de conflitos e carga de exportação antes de rollout. Quotas, TTL, CSV, SLA/h e perfis CC12 existentes continuam pendentes de validação operacional. Não se ampliaram permissões de papéis nem se criaram usuários.
