# Manual do atendimento — CC18 v1

Público: atendentes, responsáveis e coordenadores autorizados. Papel amplo, vínculo a CR e etiqueta comum não concedem leitura de chamado privado. Confirme organização, capacidade efetiva e audiência antes de agir.

## Triagem e gestão diária

1. Selecione organização, fila e filtros. Confirme quantidade total versus itens carregados; percorra paginação quando necessário. Lista, kanban e calendário devem respeitar o mesmo recorte.
2. Leia natureza, domínio, impacto, urgência e resultado esperado. Corrija classificação com motivo; não deduza natureza de dados legados incompletos.
3. Defina responsável e próxima ação. Respeite WIP da fila; exceção precisa de justificativa registrada. Prazo visual não é automaticamente uma meta SLA.
4. Abra o detalhe antes de decidir. Uma URL restaura contexto, mas o servidor reavalia permissão. Troca de organização invalida respostas antigas.

## Ciclo e comunicação

Estados: Novo → Aberto → Em atendimento → Em verificação → Concluído. Retorno da verificação para atendimento exige motivo; reabrir concluído cria outro ciclo. As precondições são as do [contrato de comandos](../cc-03/api-contract.md); não use edição genérica para mudar estado.

Espera é um intervalo: registre motivo, responsável por acompanhar e próxima ação; data esperada é opcional. Só uma espera pode estar ativa. Encerrar espera exige próxima ação e não implica pausa de SLA: a política determina quais intervalos contam.

Antes de concluir, registre resultado (`resolved`, `answered`, `fulfilled`, `rejected`, `duplicate`, `withdrawn` ou `no_action`), resumo, evidência e comunicação. Recusa/duplicidade não exigem execução fictícia. Se houver mudança pendente, registre ciência explicitamente; fechar chamado não aprova ou aplica CR. Um registro de comunicação não comprova envio de e-mail.

Resposta pública à audiência do chamado, nota interna e evento de sistema são registros distintos. Revise audiência e anexos antes do envio. Corrija conteúdo pelos comandos de revisão; eventos e auditoria não devem ser editados/apagados diretamente. Rascunho com token antigo permanece para comparação após conflito; não sobrescrever silenciosamente.

## SLA, métricas e relatórios

- Sem política/meta aprovada, mostrar sem SLA; nunca inventar meta para preencher indicador. Políticas/calendários são versionados e usam fuso IANA. Atribuição e confirmação automática não equivalem à primeira resposta humana.
- Verifique período, instante de referência, coorte, denominador, qualidade e watermark antes de interpretar métricas. Legado sem evento é desconhecido; chamados abertos não desaparecem da população.
- A leitura síncrona de métricas limita a população a200 chamados e2000 registros por fonte; excesso gera erro, não total parcial. Isso não é capacidade garantida de produção.
- Exportação é assíncrona. Confira filtro, estado e manifesto; resultado vencido ou revogado não deve ser baixado. Falha `SOURCE_CHANGED` pede nova geração após estabilização, nunca reutilização do arquivo inválido.
- CSV `text-v1` protege textos contra execução como fórmula. Preserve esse perfil ao importar; aceite manual em planilha é uma evidência separada. Não desative a proteção para obter aparência mais conveniente.

## Incidentes, problemas e conhecimento

Incidente coordenado registra impacto, coordenação, mitigação e próxima atualização. Problema registra recorrência/causa; causa desconhecida continua explícita. Relações só aparecem quando autorizadas. Restaurar serviço não fecha todos os chamados vinculados.

Conhecimento começa como rascunho versionado, com audiência e origem. Remova dados sensíveis e obtenha revisão independente antes de publicar. Origem privada não se torna pública pelo vínculo. Selecionar artigo prepara um rascunho; revise o texto antes de enviar. A mensagem conserva a versão usada mesmo após retirada do artigo, que impede novos reusos.

Mudança MapConfig usa Review/Apply próprios do projeto; vínculo não concede esses poderes. Alterações externas têm registro revisável e evidência de execução, sem SQL/Apply genérico. Para recuperação, encaminhe caso/SHA/resultado ao [runbook operacional](runbook-operacao.md).
