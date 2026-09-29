# CC-13 — Incidentes, problemas e recorrência

Implementação de 29/09/2026. Base produto `2eef55614d82b2c205a784c694c663563d3e524a`, branch `feat/cc-13-central`, destino `mano_kepler_v1`. REQ-CC-30/31; CT-43/44; integração CC12-C. Entrega de código e validação local; merge, migration remota, aceite autenticado e rollout permanecem etapas distintas.

## Entrega

Registros próprios de incidente e problema, privados por padrão, coordenador, impacto, mitigação, restauração, próxima atualização, investigação, causa desconhecida/hipótese/confirmada, evidência e post-mortem com revisões preservadas. As relações podem apontar para chamado, outro registro ou CR do mesmo tenant. Confirmar duplicidade requer decisão humana com motivo; preserva ambos os registros. Restaurar/encerrar um incidente não altera o estado dos chamados nem aprova/publica CR.

O painel integrado à Central oferece criação, busca, filtro, paginação por cursor, detalhe, revisão, transições, audiência, relações, revisão de duplicidade e mensagem revisada ao chamado. Os IDs operacionais são os identificadores autorizados usados na ligação explícita; não há busca global de alvos nem sugestão automática de causa/duplicidade. O histórico exibe campos compreensíveis, sem JSON técnico.

## API

Base `/api/organizations/:id/ticket-cases`; somente JSON e respostas privadas `no-store`.

| Método / caminho | Contrato |
|---|---|
| GET raiz | `kind?`, `q?` e `after?`; 20 registros autorizados por página; `nextCursor` pertence a registro acessível |
| GET `/:caseId` | Registro, relações e revisões filtradas por autorização atual; `canManage` |
| POST raiz | `action:create`, `kind`, `title`, `idempotencyKey`; audiência privada por padrão; dados/coordenador opcionais |
| POST `/:caseId` | `action`, `version` opaca e `idempotencyKey`; update, transition, audience, link, unlink, review_duplicate |
| POST `/:caseId/communicate` | `ticketId`, `version`, `kind:response|internal`, `body`; header `Idempotency-Key`; chamado deve continuar vinculado/autorizado |

`audience` substitui a lista de membros adicionais, sem alterar ACL de alvos. `transition` exige motivo e estado seguinte válido. `link` recebe `target:{type:ticket|case|change,id}` e relação. `review_duplicate` só confirma/rejeita candidato existente de mesmo tipo, com motivo. Não existe comando coletivo: cada operação possui seu próprio resultado e recibo. Falha/conflito não é tratado como sucesso parcial.

## Ativação

`MAONO_TICKET_CASES_ENABLED=false` por padrão e `MAONO_TICKET_CASE_ORGANIZATION_IDS` vazio. Quando ativado exige runtime `local|production`, ACL seletiva ativa, migration 0036 completa e dependências. Preview não aceita estas operações. Comunicar exige também CC05; a entrega de notificações continua sob o operador/Worker CC07. Relatórios exigem a configuração e o Worker CC12, além das capacidades de exportação já existentes.

## Documentos

- [Decisões, estados, segurança e limites](decisions.md)
- [Evidências e reprodução](evidence.md)
- [Aceite, pendências e encerramento](acceptance.md)
- [Migration e recuperação](migration-runbook.md)
- [Planejamento e controle](https://docs.google.com/spreadsheets/d/1-hZ-zGeavdUN6nJNctMGSVZhWiwrafsu3jYvmHvplEQ/edit)
- [Pasta do planejamento](https://drive.google.com/drive/folders/1zrnVqbENwUvMD9NaGw_eEe1vBmBln2hA)
