# Revisão do roadmap após merge da CC-01 — preparação da CC-02

Data da revisão: 2026-09-25T14:48:10+00:00. Escopo: leitura dos 18 itens do plano, contratos/jornada/evidências de CC-01 e fonte em `b0f62ba6d00b1627ad9fcec45125da9ea3544232`. Nenhuma alteração de código ou planilha realizada por esta revisão.

## Resultado e decisão prática

**O roadmap permanece alinhado ao objetivo final e CC-02 pode ser executada agora.** A autorização do usuário para CC-02 permite usar os contratos prospectivos como direção de implementação. Não equivale a ratificação inventada de CT-02 humano nem autoriza aplicar SQL. A recomendação é preservar o grafo atual e fazer ajustes cirúrgicos de escopo/notas, distinguindo preparação técnica paralelizável, aceite humano e ativação em ambiente remoto.

Não há ciclo no grafo atual dos 18 IDs; CC-12 depende corretamente de CC-13. Os números identificam escopo, não uma ordem estritamente numérica. Não é necessário renumerar PRs ou substituir o planejamento completo.

## O que a PR194 efetivamente entregou

| Marco | Evidência verificada | Interpretação |
|---|---|---|
| [PR194](https://github.com/matheusapc22/maono_kepler_v1/pull/194) | merged=true; base mano_kepler_v1; merged_at 25/09/2026 14:40:15Z | Merge técnico confirmado |
| HEAD final da PR | `3d4032375866f16bf357c2f0051e09f4875bd70d` | É o commit sobre o qual rodou o check de contratos |
| Merge commit | `b0f62ba6d00b1627ad9fcec45125da9ea3544232`; pais eec3a7a e 3d403237 | Nova base funcional para CC-02 |
| [Check cc01-contracts](https://github.com/matheusapc22/maono_kepler_v1/actions/runs/36146940341/job/108110339695) | success em 14:21:41Z no HEAD da PR | Contratos + regressão local Ticket + Preview safety; não prova D1 ou CT-02 humano |
| [Pages pós-merge](https://github.com/matheusapc22/maono_kepler_v1/runs/108118858467) | success em 14:44:22Z no merge b0f62ba | Artefato/deployment informado pelo check; não acceptance funcional |
| [URL fornecida pelo check](https://c48b9d06.maono-kepler-v1.pages.dev) | Rótulo do provedor: Preview URL | Não inferir runtime/ambiente Production apenas pelo hostname |
| CT-02 humano | acceptance.md mantém quatro perfis/cenários pendentes | Smoke Playwright não ratifica o walkthrough humano |
| D1 / Production | Sem leitura de binding/ledger/schema ou smoke autenticado nesta revisão | Estado remoto não verificado; build/merge não substituem confirmação |

O diff eec3a7a→b0f62ba contém 18 arquivos adicionados: documentação/JSON, protótipo e capturas, logs/manifesto, dois scripts de validação e um workflow. **Nenhum arquivo functions/, src/, migrations/ ou schema.sql foi modificado pela PR194.** Triagem persistida, conversa, ACL privada e SLA continuam nas PRs futuras. As evidências de CC-01 descrevem o estado de sua execução pré-merge; acrescentar registro pós-merge no controle, sem falsificar os registros históricos.

## Revisão dos 18 itens

| PR | Parecer | Ajuste/condição prática |
|---|---|---|
| CC-01 | Merge técnico confirmado; aceite humano/operacional separado | Registrar PR194, HEAD3d403237 e merge b0f62ba. CT-01 documentado; CT-02 humano continua pendente. Manter snapshot histórico e referenciar baseline pós-merge; não reescrever evidência anterior como aceite remoto. |
| CC-02 | Prosseguir agora, autorizado pelo usuário | Persistir natureza separada de category; cinco formulários progressivos; expectedResult/contexto/impacto/urgência e reclassificação justificada. SQL aditivo revisável e testes locais; não aplicar migration. Compatibilidade com writers antigos/CR/importação e schema ainda sem expansão é parte do lote. |
| CC-03 | Manter depois de CC-02 | Executar CAS/idempotência/máquina de estados/espera/ciclos e retirar DML do GET como cutover próprio. Não transferir a CC-02 todo esse escopo; compartilhar helper da escrita de triagem/histórico quando necessário. |
| CC-04 | Manter fundação ACL | Predicados por objeto/audiência primeiro; fixtures para superfícies ainda não criadas, testes reais de conversa/notificação/export somente nas PRs correspondentes. Novas permissões não nascem de naturezas/etiquetas. |
| CC-05 | Manter depois de ACL | Comentários/notas/rascunhos e CT-14 pertencem aqui. Nenhuma natureza nova em CC-02 deve fingir implementar comunicação ou primeira resposta. |
| CC-06 | Manter; implementação segura em paralelo à coordenação após bases | Reserva/capacidade/offset/retomada/compensação. Preservar 80 MiB por arquivo, 150 MiB total e cinco arquivos até mudança explicitamente medida; scanner segue decisão separada. |
| CC-07 | Manter consumidor explícito | Outbox/notificação in-app com autorização no consumo. Não criar outbox inerte em CC-02; serviço atômico da CC-03 será integrado sem duplicação de evento. |
| CC-08 | Manter reconciliação específica e gates históricos | Portar contrato útil das PRs fechadas com base atual; nunca mergear stack antigo por inferência. Autoridade por tipo já definida: mapa no CR técnico; platform/database no registro geral. 0021 antiga não pode impor fechamento automático do atendimento. |
| CC-09 | Manter paralelo após CC-02/03/04 | Fila/lista/Kanban/calendário completos, URLs e WIP. CC-02 pode mostrar natureza em cards/detalhe e filtro simples se necessário ao uso, mas não assumir paginação/coortes/WIP entregues. |
| CC-10 | Manter dependências; permitir preparação técnica paralela | Preservar CC-08 no grafo conservador para aceite integrado. Implementação/testes locais do motor Ticket podem avançar após contratos estáveis CC-03/05/04, sem declarar CC-10 aceita. Prioridade não cria SLA; política/metas/calendário exigem definição própria. |
| CC-11 | Manter após eventos/filas/SLA | Primeiras cinco famílias de métricas, rollups e qualidade; resultado/esforço chega CC-15. Não recalcular natureza legada nem primeira resposta a partir de assignee/updated_at. |
| CC-12 | Manter CC-13 como dependência, apesar do número menor | Relatórios de causas dependem de incidentes/problemas. A ordem operacional precisa mostrar CC-13 antes de fechar CC-12. Motor export pode ser desenvolvido em paralelo, sem declarar relatório causal pronto prematuramente. |
| CC-13 | Manter relação tipada com CR | Incidente/problema têm estados próprios e ACL de cada vínculo; nenhuma resolução em cascata de tickets. Desenvolvimento do domínio pode usar contrato estável antes da ativação CR, mas integração completa deve ser provada no aceite. |
| CC-14 | Manter P2 dentro da entrega total | Conhecimento versionado/revisado com origem privada. Não converter texto ou anexos de triagem em artigo público. |
| CC-15 | Manter P2 dentro da entrega total | Feedback voluntário por ciclo, instrumento/janela versionados, denominadores. CC-11 não pode representar ausência desta fase como seis famílias já concluídas. |
| CC-16 | Manter teste completo; não adiar acessibilidade básica até aqui | Validação transversal com pessoas e tecnologias assistivas; incorporar CT-02 humano pendente e observações do piloto. Cada PR UI, inclusive CC-02, já deve entregar labels/foco/erros acessíveis. |
| CC-17 | Manter gate integrado de segurança/caos/carga | Fixar orçamento e volume antes do ensaio; testes de código podem prosseguir com fixtures. Acceptance remoto exige ambiente/schema/capacidades confirmados; código verde não substitui gate. |
| CC-18 | Manter fechamento total | Manuais/runbooks e SHA efetivamente implantado, schema e aceite humano. Nem merge194 nem total de merges reduz pendências por suposição. |

## Pivôs mínimos para o controle

1. **CC-01:** status de código “Mergeada”; registrar PR194/HEAD/merge e o check Pages. CT-01 técnico documentado. CT-02 humano, ratificações específicas e acceptance Production continuam com seus estados reais; não usar “Aceita total” apenas pelo merge. A continuidade expressamente autorizada para CC-02 deve ficar registrada como autorização de desenvolvimento com hipóteses prospectivas, sem encerrar gates humanos.
2. **Dependência CC-02→CC-01:** considerar disponibilizados baseline/contratos/protótipo. Manter pendências de validação de produto para confirmação e eventual ajuste. A frase histórica “só avança após ratificação” não deve ser tratada como nova proibição que sobreponha a autorização atual do usuário para implementar CC-02.
3. **CC-10:** manter CC-08 no grafo e nas fórmulas. Acrescentar nota de que o desenho e testes locais do motor de SLA Ticket são paralelizáveis quando eventos/ciclos/mensagens estiverem estáveis; isso não antecipa o aceite integrado de CC-10. Não derivar política, meta ou pausa de SLA da prioridade informada no formulário CC-02.
4. **CC-12:** conservar CC-13 como dependência; mostrar ordem de execução/topologia explicitamente (CC-13 antes do aceite de CC-12). Não remover a dependência apenas para manter numeração crescente.
5. **Riscos e decisões:** RISK-CC-01 mitigado para base de integração por inventário e merge; configuração Production continua desconhecida. RISK-CC-02 permanece aberto para ambiente/ativação; não deve impedir escrever/testar schema local. RISK-CC-09 exige evidência por PR de publicação consolidada, não um bloqueio eterno de todas as linhas futuras. Manter fórmulas de prontidão; mudar a classificação/fase do gate com motivo e trilha, sem apagar o gate.
6. **CC-02:** abrir registro da migration real assim que o filename for definido, banco/ambiente e efeito. Código pode estar pronto com “migration pendente de confirmação”; ativação da funcionalidade exige schema confirmado. Não marcar migration como aplicada pelo CI.
7. **Requisitos/testes:** REQ-CC-03/04 e CT-03/04/05 são a entrega primária de CC-02. O backfill de natureza CT-05 é diferente da remoção do importador GET, que permanece CC-03/REQ-CC-10. Preservar a rastreabilidade cruzada sem declarar toda REQ-CC-10 pronta em CC-02.

## Escopo implementável da CC-02

- Códigos prospectivos já documentados em CC-01: question_request, incident, defect, improvement_change, recurring_problem. Gravar em coluna/campo próprio; category conserva map/database/permission/export/support/other. Estados e prioridades atuais permanecem.
- Dúvida/solicitação usa entrada breve. Incidente registra impacto/início/contexto; defeito registra passos/esperado/observado e contexto pertinente; melhoria registra justificativa/resultado; recorrência referencia relatos sem criar o domínio completo de problema CC-13.
- Campos comuns: objetivo/expectedResult, contexto minimizado, impacto/urgência, priorityReason e versão/origem da triagem. Nomes finais devem ser coerentes em SQL/serializador/API/types/UI; não renomear category para domain de forma incompatível.
- Ao reclassificar domínio/natureza/prioridade, preservar ator, motivo, instante e antes/depois; uma alteração de natureza/domínio não modifica prioridade ou SLA silenciosamente. O evento atual ticket.priority.changed guarda apenas from/to e não captura mudança de category com motivo: esse delta precisa entrar em CC-02 para cumprir CT-04.
- Legado sem natureza permanece “não classificado/aguarda triagem”, com provenance e contagem reconciliável. Não inferir natureza por category, palavras do assunto ou data; não preencher expectedResult com texto inventado.
- Tratar os writers que não passam pelo formulário novo: criação de Ticket pelo domínio CR, importação migrateLegacyTickets, clientes antigos e scripts. Campos novos precisam default/nullable ou adaptação controlada; não impor NOT NULL sem backfill verdadeiro. Classificação explícita de uma nova ação de sistema, se adotada, deve identificar origem; não reclassificar retrospectivamente tudo como mudança.
- SQL deve expandir sem quebrar leitor/escritor existente. A funcionalidade nova necessita gate/readiness próprio ou tolerância ao schema antigo, mantendo a Central básica utilizável até confirmação. Schema parcial falha de modo seguro; não publicar campos de triagem aceitos porém descartados silenciosamente.
- CT-03 cobre cinco naturezas × dois domínios com persistência real no banco de teste; CT-04 cobre motivo/ator/antes/depois e ausência de alteração implícita; CT-05 cobre legado ambíguo e reexecução idempotente. Complementar só riscos concretos: schema antigo/parcial, isolamento tenant, writer CR/legado, criação com anexo parcial e preservação de rascunho.
- Garantir gravação de triagem e sua evidência coerentes. Se necessário, criar uma unidade atômica restrita à mudança de triagem para não afirmar histórico que se perde; o refactor completo de comandos/CAS/idempotência permanece CC-03.
- Atualizar documentação/contrato da CC-02 e o CI para testar novos módulos/testes/migration. Não adulterar baseline/evidência histórica de CC-01. O workflow atual roda somente validate-cc01, ticket-center e preview-safety; ele não certificará a nova triagem sem inclusão dos testes novos.
- Permanecem fora do lote: conversas/notas, SLA, métricas, privacidade por grupo, novas permissões globais, alteração Review/Apply e aplicação remota de SQL.

## Inventário de migrations e alcance correto dos gates

Inventário do SHA pós-merge b0f62ba; **19 arquivos presentes na fonte, nenhum estado remoto inferido**. Prefixos 0007 e 0008 já se repetem em arquivos distintos: usar filename completo e checksum ao inventariar. Uma migration de outro domínio não se torna pré-requisito de CC-02 só por estar no diretório.

| Arquivo presente | Relevância para CC-02 / confirmação |
|---|---|
| `0002_organizations_files.sql` | Base organizacional compartilhada; verificar schema/compatibilidade no alvo, sem reaplicar por inferência. |
| `0006_create_organization_exports.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0007_create_organization_limit_requests.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0007_project_save_role_permissions.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0008_harden_organization_files.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0008_session_active_organization.sql` | Autorização/sessão compartilhada: preservar comportamento; aplicação remota não verificada. |
| `0009_organization_storage_invariant.sql` | Readiness de anexos; contrato existente a preservar; não reaplicar schema conhecido sem reconciliação. |
| `0010_ticket_center.sql` | Base direta de organization_tickets/attachments/events. Confirmar schema real do alvo antes de ativar triagem. |
| `0011_roadmap_gantt.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0012_access_delegation_policy.sql` | Autorização/sessão compartilhada: preservar comportamento; aplicação remota não verificada. |
| `0013_user_permission_denials.sql` | Autorização/sessão compartilhada: preservar comportamento; aplicação remota não verificada. |
| `0014_project_metadata_ownership.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0015_project_preview_lifecycle.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0016_map_panel_navigation_and_quota.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0017_map_isochrone_rate_limit.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0018_project_lifecycle.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0019_save_deploy_contract.sql` | Outro contrato da plataforma; preservar e inventariar somente quando aplicável. Estado remoto não verificado. |
| `0020_project_change_requests.sql` | Compatibilidade do writer CR; CR é integração opcional da Central básica; não aplicar automaticamente para triagem. |
| `0024_document_folders_trash.sql` | Número já ocupado e domínio documentos; não é autorização nem requisito automático de aplicar para CC-02. |

**0021_change_request_lifecycle.sql, 0022_change_request_apply_artifacts.sql e 0023_change_request_resubmissions.sql não constam da árvore funcional. Permanecem migration pendente de confirmação e sem autorização de aplicação.** Não atribuir sua ausência na árvore à ausência no D1. Não criar branch operacional, acionar operador histórico ou habilitar mutações Preview para obter um verde de CC-02.

O identificador MIG-CC-02 ainda é lógico. O próximo número candidato após 0024 precisa ser revalidado contra o HEAD de implementação e trabalho concorrente antes de criar arquivo. Criar/revisar/testar a migration no repositório está no escopo da implementação; **aplicá-la remotamente não está autorizado**. Avisar filename, efeito, D1 maono_maps/binding e momento de pré-requisito, mantendo confirmação separada por ambiente.

## Limite desta revisão

Esta revisão não altera planilha, código, SQL remoto, branch ou HEAD. O checkout local lido preservava HEAD de PR194 e ref remota funcional já atualizada; o diff e inventário foram fixados no objeto de merge b0f62ba. Não foi executado health autenticado, D1, CT-02 humano ou rollout. O usuário autorizou a implementação CC-02, portanto os pontos acima orientam a execução e os gates futuros, sem bloquear trabalho técnico já autorizado.
