# Sistema - diagnóstico básico

Base independente `e47deac18888195b945a244dadb9e27c5902638f`.
Branch `feat/admin-system-diagnostics`; uma PR draft e PDF, sem merge.

## Diagnóstico e implementação

A subaba continha apenas tecnologia e exemplos de rotas. O contrato existente
`GET /api/health` verifica presença de DB, três configurações Dropbox e SELECT 1.
Não testa autenticação/acesso Dropbox, readiness ou migrations. Não alterar esse
endpoint para induzir reparos/importações/escritas.

1. Componente `AdminSystem` isolado; trocar somente renderSystem e import no Admin.
2. Uma consulta ao entrar na subaba. AbortController cancela ao sair ou perder
   contexto; resposta cancelada não publica. Retry somente contextual em falha.
3. Projetar apenas cinco campos estritamente booleanos. Ausência/tipo inválido é
   indisponível, não false. Ignorar runtime, service e qualquer valor não previsto.
4. Mostrar horário UTC observado pelo navegador ao receber a resposta e descrever
   o alcance exato. Nunca transformar `ok` em certificado de plataforma saudável.
5. Sem polling, listener de foco, cache persistente ou múltiplas cargas globais.
   401/403/404 apagam diagnóstico e não oferecem retry de acesso.

## Verificação, dependências e reversão

Contratos executáveis do modelo e endpoint existente com DB sintético (apenas
SELECT 1), além de preservação histórica, carregamento, lint e três motores.
Cobrir ok:false, dados parciais, campo arbitrário/segredo, 401/403/404, erro/retry,
cancelamento, teclado e mobile. Sem relaxed assertions/timeouts.

Nenhuma migration, schema, flag ou dependência nova. A presença de credenciais não
comprova validade. Falha do endpoint deixa diagnóstico indisponível. Este teste não
certifica D1/Dropbox real, armazenamento, filas ou acceptance em Produção.

Ordem de revisão amanhã: Solicitações, Auditoria, Sistema, Painel. Branches
independentes; integrar os pequenos pontos comuns em Admin/helpers/workflow e
revalidar o conjunto. Reversão por revert da PR, sem limpeza de dados remotos.
Lint global está em outra frente; builds/browser locais aguardam coordenação RAM.

## Evidência local em 27/10/2026

48 contratos aprovados (cinco específicos, mais carregamento, preservação estrita
e fallback), sem falhas/ignorados. ESLint de escopo e diff-check aprovados.
TypeScript/build/browser ainda pendentes de CI. As dependências existentes são
reutilizadas por junção aprovada, sem instalação/lockfile; a normalização local
CRLF/LF do fallback preserva as assertions e o hash histórico esperado.
