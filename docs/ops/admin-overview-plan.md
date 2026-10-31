# Painel - escopo, origem e disponibilidade

## Entrega local concluída

Código validado: `aad481847a957e704826c05c4c896d3f9e9fcd1a`.
50 contratos, TypeScript app/node, build Vite, lint de escopo e diff-check aprovados.
261/261 casos nos três motores passaram, sem falhas, flaky ou ignorados.
As três páginas do PDF final foram renderizadas e inspecionadas; capturas desktop
e mobile confirmam métricas, fontes acessíveis por teclado e atalhos legíveis.
Evidência consolidada: `docs/ops/admin-overview-validation.md`.
CI remoto será conferido no HEAD final da PR; não é declarado aprovado aqui.
As seções abaixo preservam o planejamento e os registros históricos anteriores.

Base independente `e47deac18888195b945a244dadb9e27c5902638f`.
Branch `feat/admin-overview-provenance`; PR draft e PDF próprios, sem merge.

## Diagnóstico confirmado

Painel já usa contagens reais de organizações, projetos e usuários ativos, mais a
soma de fileCount de todas as organizações. A API conta organization_files ativos,
inclusive pertencentes a organizações inativas. Não é inventário físico Dropbox.
Faltavam origem/escopo e sinalização de dados anteriores após erro transitório.
Collections ausentes eram convertidas em [] por fallback, produzindo falso zero.

## Implementação incremental

1. Preservar endpoints, quatro leituras concorrentes, cancelamento/epoch, sessão,
   filtros, callbacks e estágios de apresentação. Não disparar leituras adicionais.
2. Validar arrays administrativos antes de declarar região carregada. Manter a
   precedência do users endpoint, inclusive [] autoritativo e fallback legado de
   access.users quando users é omitido. Ausência de ambas as listas é erro.
3. Invalidar a região também em 404. 401 segue invalidando todo o lote; 403 mantém
   limpeza regional. Sem retry de autorização. Erro transitório preserva snapshot
   válido com sinalização explícita no cartão.
4. Contagem só aparece com estado carregado, número inteiro seguro não negativo e
   metadados completos: active booleano ou fileCount numérico válido. Missing não
   vira zero. Manter fórmulas históricas; disponibilidade controla apresentação.
5. Disclosure acessível explica origem, escopo global e limitações dos quatro
   indicadores. Preservar os três atalhos existentes com descrições compatíveis,
   sem contadores de solicitações/auditoria/saúde inventados.

## Dependências e revisão futura

Nenhuma dependência de commits das outras subabas, migration, schema, flag ou pacote.
Ordem de revisão recomendada: Solicitações, Auditoria, Sistema, Painel. Comparar a
copy final com os destinos e resolver integrações pontuais em Admin/helpers/workflow.
Cada helper continua sendo inverso exato, mantendo o hash histórico e os canários.

## Verificação e limites

Contratos do modelo e da integração real de renderOverview, payloads ausentes,
coleções inválidas, 404, stale, zero válido e metadados parciais. Browsers preservam
origem/acessibilidade, atalhos/Back, nenhum fetch extra, erro transitório e mobile.
Executar gates históricos, lint de escopo, TypeScript/build e três motores.
Build/browser locais aguardam coordenação por RAM; CI normal da PR executa os gates.
Lint global preexistente é tratado separadamente. Fixtures não comprovam D1/Dropbox.

Reversão por revert da PR, sem cleanup remoto. Nenhum merge, migration, conta,
credencial, flag ou acceptance em Produção autorizado por esta entrega.

## Ambiente dos testes de navegador

A suíte nova integra exclusivamente o gate compilado progressive-loading, nos
três motores, como as suítes administrativas existentes. O config de desenvolvimento
a exclui porque StrictMode remonta efeitos: a execução duplicada mostrou oito
leituras onde o contrato compilado exige quatro. Assertions, timeouts e cobertura
do gate compilado permanecem intactos. Não há relaxamento da contagem de requests.

## Checkpoint local

49 testes passaram (contratos específicos e gates administrativos históricos),
zero falhas/ignorados. ESLint de escopo e git diff --check passaram. TypeScript,
build e navegadores compilados serão acompanhados no SHA publicado do CI.

## Gate completo dividido por motor

O run 40557843588 de Solicitações executou 558 dos 591 casos antes da janela
de 35 minutos encerrar o job. A suíte completa agora roda em uma matriz de
Chromium/Firefox/WebKit, cada um com o mesmo timeout de 35 minutos e um worker.
Nenhum teste, assertion, etapa de contrato/lint/build ou motor foi removido.
O check final mantém o nome progressive-loading e só aprova quando todos os
jobs de motores têm sucesso; fail-fast é false e artefatos têm sufixo do motor.

## Validação da precedência de usuários

Reproduzido um payload users:null que caía na lista legada mesmo sendo inválido.
O fallback agora ocorre somente quando users é undefined (campo omitido); null,
false, zero, string e objeto explícitos são rejeitados, mantendo [] autoritativo.
50 contratos locais passaram após a correção, inclusive os gates históricos e
o inverso exato do hash. Lint de escopo passou. Build/browser seguem pendentes.
