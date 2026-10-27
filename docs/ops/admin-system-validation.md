# Evidência local final — Admin system

SHA de código validado: `ef0ebf642bb449087ca03291c5bb986c4d1e1903`. A publicação seguinte contém somente PDF e esta documentação.
Base de produto: `e47deac18888195b945a244dadb9e27c5902638f`.
Conclusão UTC: `2026-10-27T20:47:17.0446799Z`; supervisor: exit code 0.

| Verificação | Resultado |
| --- | --- |
| Contratos Node (subaba, admin-progressive-loading, initial-loading-presentation, projects-fallback-scope) | 48 aprovados |
| TypeScript app/node | aprovado |
| Build Vite com as três flags locais de mapa | aprovado |
| ESLint dos arquivos do escopo e git diff --check | aprovados |
| Browser da subaba, admin-workspace, admin-progressive-loading, projects-theme-regression | 261 aprovados; 0 falhas, flaky ou ignorados |

Os browsers executaram Chromium, Firefox e WebKit, com um worker e os timeouts/assertions originais.
Ambiente: Windows, Node 24.15, Playwright 1.55.0; dependências existentes reutilizadas por junção autorizada, sem instalação.
O build utilizou a configuração Vite original empacotada por esbuild para arquivo temporário,
preservando aliases/plugins e isolando caches da worktree. A configuração local de Playwright
importou a configuração progressive-loading versionada, alterando apenas caminhos e o comando
de preview para esse arquivo temporário. O fallback histórico foi normalizado de CRLF para LF
somente no checkout, sem mudar código, hash esperado ou assertions.

Comandos do gate: `node --experimental-strip-types --test` nos quatro arquivos citados;
`eslint` nos arquivos do escopo; `tsc -p tsconfig.app.json` e `tsc -p tsconfig.node.json`
com tsBuildInfoFile próprio; build Vite via API; Playwright nos quatro arquivos browser citados.
Logs e relatório JSON completos ficam em `test-results/admin-system-validation/` na worktree
do executor. Os testes e os gates de CI estão versionados nesta PR.

## Limites

Fixtures locais não provam D1/Dropbox remotos nem acceptance em Produção.
O lint global pertence a outra frente e não está declarado aprovado por esta entrega.
O CI remoto deve ser conferido no SHA final da PR; a aprovação local não substitui seus checks.
Não houve merge, migration remota, alteração de flag, conta ou credencial.
O PDF `output/pdf/admin-system.pdf` foi gerado com o SHA acima; seu HEAD de publicação é
verificável na PR. A inspeção visual final é registrada no plano após renderização.
