# Decisões e limites CC15

| ID | Contrato implementado | Pendência antes do canário |
| --- | --- | --- |
| D01 | Instrumento imutável, CAS, rótulos e direção ordinal; prazo obrigatório 1–8760h | Produto definir valores reais e consentimento. Fixtures não são defaults. |
| D02 | Solicitante original ativo e autorizado; identidade org/ticket/cycle_number/recipient; sem baseline desconhecido ou ciclos pré-publicação | Aprovar população, exceções e rotina/dono da reconciliação. |
| D03 | Consentimento obrigatório; comentário restrito ao respondente na gravação e não retornado em listas; agregados só gestão com ACL | Aprovar texto, retenção e eventual necessidade de leitura/correção individual; sem promessa de anonimato. |
| D04 | Convite do ciclo anterior continua válido até seu prazo, mesmo após reabrir. Nova resposta só no novo ciclo. Retirada separada, preservando registro original | Aprovar regra. Correção do conteúdo não disponível; usar conversa CC05 sem enviar comentário automaticamente. |
| D05 | Taxa madura `R_m/E_m`; janela `[issued_at,eligible_until)`; E inclui entrega falha/suprimida e recusas/retiradas; denominador zero = null | Validar orçamento e interpretação por negócio. |
| D06 | Escalas/versões separadas; distribuição sem média arbitrária. CC12 não recebe novas colunas ou comentários | Aprovar política de grupos pequenos e extensão futura de exports, se desejada. |
| D07 | 25 convites/página; 2.000 convites no universo de métricas (excesso falha fechado); corpo16KB e comentário2.000. Sem purge automático | Retenção, carga, quotas, desempenho e cleanup reais não aprovados. |
| D08 | Flags OFF; allowlist vazia; operador protegido para SQL; emissão manual por POST | Donos, canário, janela, monitoramento e regularização do operador PR201. |

As escolhas técnicas tornam a implementação verificável; não constituem aprovação dos parâmetros de produção. Publicar um instrumento inicia elegibilidade para encerramentos posteriores à publicação. Não emite convites sozinho. Uma nova versão é escolhida pelo instante canônico do encerramento, não pelo instante tardio da reconciliação. O prazo começa na emissão; atraso não encurta silenciosamente a janela.

Retirada de consentimento tem efeito imediato nas novas consultas e reconstruções, inclusive de janelas históricas: o resultado/esforço retirado não é projetado. Portanto, `consentState=current` é explícito; métricas históricas não são snapshots irrevogáveis de consentimento. Respostas e checkpoints antigos permanecem armazenados até política de retenção aprovada. Isto não promete eliminação física. A recusa é distinta da retirada. Um convite expirado sem resposta é não resposta, nunca exclusão automática do denominador.

A coorte é de **convites efetivamente emitidos** para ciclos elegíveis, não de todos os chamados fechados. Ciclos ainda não reconciliados não entram na taxa. A gestão deve acompanhar emissão e entrega; a contagem não pretende medir cobertura total da organização. Acesso é filtrado antes de leitura, paginação, emissão e agregação. Exclusões de destinatário na emissão aparecem apenas no resumo da página de chamados acessíveis; não há backfill ou reclassificação automática de legado.
