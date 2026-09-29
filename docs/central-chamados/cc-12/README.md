# CC-12 — Relatórios e exportações autorizadas

Execução de 29/09/2026; base `0cb04ade080c097b1d5940baac501767619c51ba`, branch `feat/cc-12-central`, destino `mano_kepler_v1`. REQ-CC-28/29, CT-41/42. Entrega de implementação CC12-A/B; CC12-C e encerramento operacional continuam abertos.

## Entrega

Jobs privados ao autor, captura consistente em páginas próprias, Worker recuperável, CSV UTF-8 seguro, manifesto, download reautorizado, cancelamento, retry e expiração. UI integrada na Central, independente da paginação CC-09. Relatórios disponíveis: conjunto completo, backlog em `asOf`, ciclos encerrados em `[from,to)` e métricas/SLA. Incidentes/causas retornam dependência explícita de CC-13, nunca dados inventados.

`all` e `sla` incluem os chamados ativos autorizados criados até `asOf`. O intervalo governa as coortes das métricas, não exclui indiscriminadamente chamados antigos que compõem o backlog. Domínio, natureza, responsável e título são atributos atuais capturados; `asOf` projeta o histórico capturado, não restaura o banco inteiro em uma data passada. `sla` conserva as mesmas linhas e fatos, com políticas e horas úteis no manifesto; não representa um novo motor de avaliação de metas. Não inventa SLA ou horizonte de reabertura h.

## API

Base: `/api/organizations/:id/tickets/exports`.

| Operação | Método e sufixo | Contrato |
|---|---|---|
| Solicitar | POST raiz | `idempotencyKey`, `from`, `to`, `asOf`, `report`, `domain?`, `nature?`, `definitionVersion?`; chave repetida devolve o mesmo job, payload divergente conflita |
| Histórico | GET raiz | Privado ao autor; páginas de cinco; `before` usa `nextCursor` |
| Status/manifesto | GET `/:exportId` | Manifesto somente pronto e ainda autorizado |
| Download | GET `/:exportId/download` | Stream privado; sessão, membership, capabilities e ACL atuais |
| Cancelar | POST `/:exportId/cancel` | Terminal, impede publicação por Worker obsoleto |
| Gerar novamente | POST `/:exportId/retry` | Nova chave; cria snapshot novo, não ressuscita o anterior |

POST requer JSON, corpo até 4 KiB e origem correspondente quando presente. Todas as respostas usam `private, no-store`; caminhos e URLs do Dropbox não são expostos. Uma revogação de linha impede acesso ao arquivo inteiro e ao manifesto/histórico correspondente. Cada partição baixada é verificada e reautorizada antes e após a leitura externa. Bytes já recebidos pelo cliente não podem ser recolhidos.

Capabilities: `ticket.view` e `export.view` para histórico; criação exige também `export.create` e `export.download`; download exige a capacidade correspondente. Mantido o resolver canônico: atualmente o papel `owner` não possui `export.*`, mesmo com grants. QA deve utilizar ator com permissões efetivamente resolvidas (por exemplo editor com grants explícitos) ou superadmin com membership. Qualquer mudança na matriz de papéis exige revisão própria; esta entrega não amplia acesso.

## Formato e métricas

CSV `text-v1`: todas as strings, inclusive cabeçalhos, recebem prefixo literal `text:` e escape RFC de aspas; números tipados continuam números. Para recuperar o texto original, remover exatamente um prefixo; nunca avaliar o texto decodificado como fórmula. Delimitador vírgula, UTF-8 sem BOM, CRLF. O manifesto declara colunas, filtros UTC, semântica das dimensões, definições/políticas, fontes, integridade e qualidade. Compatibilidade manual com importação e reabertura Excel/LibreOffice/Sheets permanece pendente.

Fatos reutilizam a projeção CC-11: resposta pública elegível, resolução por ciclo, idade, espera, WIP, reabertura e qualidade. Percentis nearest-rank calculados sobre todos os fatos materializados, nunca medianas de páginas. `distributions.*.unknown` conta amostras sem valor numérico (inclui censura); `totals.responseCensored` distingue censurados na coorte de resposta. Valores desconhecidos não viram zero. CSV inclui ciclos/esperas e proveniência; não inclui corpos de mensagens, notas internas ou anexos.

## Referências

- [Decisões e limites](decisions.md)
- [Evidências locais](evidence.md)
- [Aceite e pendências](acceptance.md)
- [Migration e operação](migration-runbook.md)
- [Pasta CC-12](https://drive.google.com/drive/folders/1JLmoaf4Jd21byxImSh8Q64B3giUbwJ1g)
- [Controle CC-12](https://docs.google.com/spreadsheets/d/1Lj8aklS15RWTf-OiO5sYrej2B7RiLW2XkGWHI5kU_6A/edit)

## Atualização CC13 — 29/09/2026

A implementação CC13 adiciona os relatórios `incidents`/`causes` sob suas próprias flags, allowlist e migration0036. Ver [contrato CC12-C](../cc-13/decisions.md) e [aceite pendente](../cc-13/acceptance.md). Esta atualização não transforma os testes locais em aceite de produção nem altera o registro histórico da entrega CC12-A/B acima. A migration0035 já está aplicada; 0036 possui autorização própria.
