# Aceite e pendências CC14

## Situação

Código e validação local não equivalem a aceite em produção. Homologação fisicamente isolada continua dispensada pela decisão operacional anterior; a estratégia permanece acceptance controlado em produção, com escopo, atores e fixtures autorizados.

| Entregas          | Estado                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| B01, B03-B10, B12 | Implementadas; schema, ACL, ciclo editorial, busca e reuso integrados                                        |
| B02               | Decisões técnicas registradas; responsáveis nominais, budgets e políticas operacionais pendentes             |
| B11/B13           | UI e testes automatizados locais; QA manual leitor de tela/teclado completo e volume real pendentes          |
| B14               | Bloqueado pelo operador protegido PR201 ainda não integrado no baseline; suíte CC14 precisa registro/revisão |
| B15               | PR/CI e review do SHA publicado devem ser conferidos no controle                                             |
| B16               | 0037 preparada/testada; audit, autorização, apply e pós-validação remotos pendentes                          |
| B17/B18           | Deploy/SHA servido, aceite real, canário, rollback/handoff pendentes                                         |

## Pendências preservadas da CC13

Merge PR213 e migration0036 concluídos. Continuam C13-P01 a P10 do controle: SHA servido/configuração; operador; CT43/44 reais; CC12-C/CT41/42 e Worker/Dropbox/CC05/07/08; QA manual; budgets e limite de 200 revisões CC13; retenção/cleanup; decisões/donos; canário; heranças CC12. A CC14 não fecha esses itens por consequência.

## Matriz protegida preparada para registro no operador

| Caso    | Exercício e evidência mínima                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CT45    | Fonte privada real autorizada; captura restrita; bloqueio de publicação sem revisão; autor/revisor distintos; leitor de artigo sem acesso à fonte não recebe origem |
| CT46    | Selecionar v2, editar texto, declarar revisão, enviar, retirar; referência v2 permanece na mensagem e novas sugestões desaparecem                                   |
| T03/T04 | Perfil permitido/negado, cross-org, grants e membership revogados durante busca/leitura/envio; nenhum dado/efeito indevido                                          |
| T05/T06 | CAS paralelo, retries iguais/divergentes, falha antes/depois de mensagem/outbox; uma mensagem com proveniência coerente                                             |
| T07/T08 | Retirada/substituição entre seleção e envio; privado não é sugerido; nota interna/response respeitam audiência e destinatários                                      |
| T09/T10 | Fonte incidente/problema CC13 privada, correções e histórico; publicação não amplia ACL nem reescreve mensagens                                                     |
| T11/T12 | HTML hostil como texto; mobile, leitor de tela/teclado, sessão/org, respostas atrasadas e conflitos; limpeza de dados anteriores                                    |
| T13/T14 | Budgets aprovados, carga/busca/histórico, deploy com flags OFF, allowlist, canário, rollback e cleanup                                                              |

Antes da janela: revisar dispatcher/restauração do operador, registrar suíte e contratos de fixtures, confirmar SHA servido/schema/flags/dependências, selecionar atores já elegíveis, aprovar retenção/cleanup. Não criar usuários nem ampliar acessos para contornar falta de perfis. Histórico imutável não pode ser removido por SQL remoto improvisado; configuração restaurada não prova cleanup.

## Próximos passos

1. Review/CI final e merge da PR CC14; registrar SHA de produto.
2. Auditar somente0037; parar, obter autorização específica pelo hash e aplicar pelo operador protegido. Não reaplicar0036.
3. Regularizar operador e dependências, aprovar decisões operacionais e confirmar deploy.
4. Executar matriz autenticada, medir budgets e comprovar cleanup.
5. Aprovar canário, ensaiar contenção e fechar G01-G08 com evidência e responsáveis.
