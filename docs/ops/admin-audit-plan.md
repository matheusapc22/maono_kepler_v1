# Auditoria - plano, operação e limites

## Entrega local concluída

Código validado: `e2708003f55c0b6409dfcae005a058253625a839`.
50 contratos, TypeScript app/node, build Vite, lint de escopo e diff-check aprovados.
258/258 casos nos três motores passaram, sem falhas, flaky ou ignorados.
As três páginas do PDF final foram renderizadas e inspecionadas; a captura mobile
confirma tabela legível e layout sem corte horizontal em 320 px.
Evidência consolidada: `docs/ops/admin-audit-validation.md`.
CI remoto será conferido no HEAD final da PR; não é declarado aprovado aqui.
As seções abaixo preservam o planejamento e os registros históricos anteriores.

Base independente: `e47deac18888195b945a244dadb9e27c5902638f`.
Branch `feat/admin-audit-reader`; PR draft, sem merge.

## Problema e decisão

`renderAudit` apresentava três textos estáticos como eventos. `audit_logs` já
possui ID, ação, horário, ator, projeto e detalhes JSON heterogêneos. A associação
histórica de organização não é uniforme. Um leitor seguro mínimo é viável pela
projeção explícita: ID, horário validado e categoria de ação permitida. Nunca
consultar `details`, fazer join com usuários/projetos ou inferir organização atual.

## Etapas

1. GET `/api/admin/audit`, `requireSession` e papel exclusivamente `super_admin`.
2. Paginação por ID descendente: 25 resultados e um registro para indicar próxima
   página, cursor positivo seguro vinculado por parâmetro. Sem total, exportação,
   filtro arbitrário, writes ou novos índices/migrations.
3. Lista limitada de categorias. Ações desconhecidas viram "Ação não catalogada";
   horário inválido vira indisponível. Não afirmar sucesso porque `result` não foi lido.
4. Componente isolado, carregamento contextual, cancelamento no unmount/contexto,
   limpeza de dados em toda nova leitura e em 401/403/404. Query `audit_before` em
   URL preserva Back/Forward. Retry apenas contextual; sem cache persistente/polling.
5. Testes executáveis de fronteira, projeção, SQL limitado, erros e navegação.

## Contrato e limites

O retorno é global de plataforma e visível somente ao Super Admin. A leitura não
comprova cobertura de todos os eventos, sucesso das operações ou integridade
histórica. Não identifica ator, projeto, organização, conteúdo, IP, user agent,
credencial ou caminho. Ausência da tabela/binding é 503, nunca lista vazia.
Empty state só após leitura válida. Resposta privada `no-store`, sem persistência
local. O endpoint é somente leitura, não cria/audita/repara schema.

## Dependências, verificação e reversão

Schema existente `audit_logs`; nenhuma migration/flag/dependência nova. Mesmos
gates de Admin e três motores, mais contratos de API e browser específicos.
Fixtures não comprovam D1/Dropbox/Produção. Build/browser locais aguardam
coordenação de RAM; CI da PR valida a aplicação compilada. Lint global em outra frente.

Ordem de revisão amanhã: Solicitações, Auditoria, Sistema, Painel. Nenhuma
dependência de commits das outras subabas. Resolver apenas integrações pontuais
de Admin/helpers/workflow e revalidar o conjunto. Reversão por revert da PR;
nenhum dado remoto é modificado. Não executar merge, migration, flag ou acceptance.

## Evidência local

49 testes aprovados em 27/10/2026 (seis contratos de Auditoria mais os três gates
de carregamento/preservação/fallback), sem falhas/ignorados. ESLint de escopo e
diff-check aprovados. Dependências compartilhadas apenas por junção; artefatos
temporários próprios, sem instalação ou alteração de lockfiles. Fallback histórico
normalizado de CRLF para LF localmente, preservando assertions e SHA esperado.
TypeScript/build/browser pendentes de CI e coordenação local.

## Ambiente dos testes de navegador

A suíte nova integra exclusivamente o gate compilado progressive-loading, nos
três motores, como as suítes administrativas existentes. O config de desenvolvimento
a exclui porque StrictMode remonta efeitos: a execução duplicada mostrou oito
leituras onde o contrato compilado exige quatro. Assertions, timeouts e cobertura
do gate compilado permanecem intactos. Não há relaxamento da contagem de requests.

## Gate completo dividido por motor

O run 40557843588 de Solicitações executou 558 dos 591 casos antes da janela
de 35 minutos encerrar o job. A suíte completa agora roda em uma matriz de
Chromium/Firefox/WebKit, cada um com o mesmo timeout de 35 minutos e um worker.
Nenhum teste, assertion, etapa de contrato/lint/build ou motor foi removido.
O check final mantém o nome progressive-loading e só aprova quando todos os
jobs de motores têm sucesso; fail-fast é false e artefatos têm sufixo do motor.

## Revisão adicional de segurança e schema

50 contratos locais passaram. O teste SQLite executa o schema.sql versionado em
memória, sem migration adicional. O leitor real consulta com PRAGMA query_only=ON;
novos eventos inseridos pela fixture entre páginas não repetem nem deslocam os
40 registros iniciais. Schema version e total de linhas são conferidos após a
leitura. Categorias desconhecidas continuam neutras e nenhum detalhe/organização
inferida sai na resposta. 401/403 retornam no-store e não consultam audit_logs.

## Anúncios de carregamento

aria-busy foi limitado à região de dados. Mensagens role=status e controles
ficam fora da região ocupada, para não suprimir os anúncios de carregamento.
O cenário de leitura cancelada verifica busy nos dados, ausência de status
dentro de busy e o texto de status fora dele. Nenhum timeout ou assertion
existente de dados/cancelamento foi removido.
