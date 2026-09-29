# Aceite e pendências CC-13

## Estado de entrega

Implementados domínio/schema/ACL, relações e deduplicação humana, comandos atômicos, UI, comunicação CC05/07, vínculos CC08, post-mortem e extensão CC12-C. Testes locais não equivalem a aceite autenticado em produção.

| Planejamento | Situação |
|---|---|
| B01, B03–B09, B11–B12 | Implementados e cobertos por testes locais |
| B02 | Contratos técnicos registrados; responsáveis nominais, retenção e budgets pendentes |
| B10 | UI implementada e Chromium local aprovado; QA manual de teclado/leitor de tela pendente |
| B13/B15 | Código, testes e documentação preparados; CI/review do SHA publicado, merge e SHA final devem ser registrados na PR/controle |
| B14 | Bloqueado: operador protegido da PR201 não integrado ao produto; publicar dispatcher e registrar suítes após revisão |
| B16 | 0036 preparada e validada localmente; audit/apply/pós-validação remotos pendentes |
| B17/B18 | Deploy comprovado, aceite autenticado, volume, cleanup, canário e handoff pendentes |

PR201 consultada em 29/09/2026: aberta, `mergeable:false`, head `46186289723f6dfcdba323aa09cf15fb09ec1807`; registry contém apenas CC04. Seu framework ainda não existe no baseline produto. Não foi incorporado nem executado por esta entrega. A suíte CC04 propõe desligar ACL como safe state, incompatível com assumir que OFF protege dados privados já existentes: revisar a restauração com base no estado atual antes de reutilizar o operador. Não tratar `closure` de configuração como evidência automática de limpeza de fixtures.

## Próximas ações concretas

1. Revisar/mergear o PR CC13; registrar SHA final do produto e confirmar checks nesse SHA. Aprovar decisões operacionais D05/D07, responsáveis e limite de revisões antes do rollout.
2. Auditar e aplicar somente 0036 pelo [runbook](migration-runbook.md), com autorização específica posterior ao audit. A 0035 já foi aplicada: não reaplicar.
3. Comprovar deploy do mesmo SHA; schema0036, ACL, flags/allowlist, conversa/notificações, export Worker/Dropbox e parâmetros aprovados. Manter flags de CC13 OFF até janela autorizada.
4. Regularizar PR201, revisar proteção/restauração/cleanup, publicar dispatcher em `main` e registrar suítes CC13 e CC12-C. Credenciais apenas no Environment protegido. Não criar contas nem ampliar acessos para contornar os perfis existentes.
5. Executar a matriz abaixo em janela aprovada, usando somente fixtures sintéticas delimitadas e atores já elegíveis. Reconciliar relatório, guardar evidência sanitizada e provar limpeza/isolamento das fixtures. A ausência de API de exclusão do histórico CC13 deve ser tratada no contrato de retenção/cleanup antes da janela; não executar SQL remoto improvisado para limpar.
6. Fazer canário com allowlist aprovada, monitorar e fechar gates. Desligar somente CC13 como contenção; preservar ACL e rotinas de limpeza/expiração CC12. Encerramento exige evidências reais, não apenas merge/migration.

## Matriz para suíte protegida

| Caso | Exercício real | Evidência mínima |
|---|---|---|
| CT43 | Vários tickets sintéticos, incidente coordenado, mitigação/restauração antes da causa | Estados independentes, causa unknown, versões e mensagens revisadas, sem fechar tickets |
| CT44/T03 | Problema privado e tickets/CR de audiências distintas; URL, busca e cursor | Perfil permitido/negado, nenhum ID/título/contador de alvos privados, negação cross-org |
| T04 | Revogar audiência/ACL/membership entre leitura e escrita/entrega/download | Negação na próxima requisição; nenhuma mutação/entrega adicional |
| T05/T06 | CAS simultâneo, replay igual/divergente, falha e resposta ambígua | Um recibo/evento por comando, rollback e nenhuma duplicação de outbox |
| T07/T08 | Propor/rejeitar/confirmar duplicidade; revisar hipótese e post-mortem | Revisão humana, ambas entidades preservadas, histórico autorizado |
| T09 | Mensagem CC05/07 e vínculo CC08 com perda de acesso | Reautorização e ausência de aprovação/publicação de CR por efeito lateral |
| T10 / CT41/42 | Incidentes compartilhados e múltiplas causas; captura, mudança concorrente e revogação após ready | Uma linha/ticket, registros distintos, unknown separado, geração, manifesto v2, download negado após revogação |
| T11 | Celular, teclado/leitor, conflito, troca de org/sessão e resposta tardia | UI/foco/rascunho adequados e dados anteriores removidos |
| T12 | Volume realista aprovado, fila Worker, latência D1, canário e recuperação | Budgets aprovados, SHA servido, rollback/restauração e cleanup comprovados |

## Pendências CC12 preservadas

Deploy/SHA servido e Worker; operador protegido; CT41/42 autenticados; quotas/TTL/retenção e capacidade; importação/reabertura CSV em Excel/LibreOffice/Sheets; políticas SLA/h e atores; integração CC13 aceita em produção; canário e handoff. CC12-C passa de dependência não implementada para integração implementada/testada localmente, ainda sem aceite operacional.
