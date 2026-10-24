# Preparo isolado do navegador de aceite

O operador e o smoke de PR usam `.github/scripts/acceptance-browser/setup.sh`.
O caminho instala `@playwright/test@1.55.0` em `scripts/acceptance/node_modules`
e somente o Chromium headless shell correspondente, em uma pasta temporária
exclusiva do job. O navegador de sistema não substitui o Chromium versionado.

O runner é `ubuntu-24.04`. Suas bibliotecas de navegador já estão instaladas;
o setup não atualiza pacotes do sistema nem executa `install-deps`. Isso evita
que downloads de fontes e atualizações do Ubuntu ocupem a janela de cinco minutos.
Uma biblioteca ausente ou incompatível continua causando falha antes da entrega
de credenciais, em vez de abrir uma janela com um navegador não comprovado.

Antes de publicar `PLAYWRIGHT_BROWSERS_PATH` para os próximos passos, o smoke
inicia o navegador, abre somente `about:blank`, cria um botão em memória,
clica e verifica a resposta. O contexto fica offline, bloqueia service workers
e aborta requisições. Não usa URL da aplicação, conta, cookie ou storage.

O job `browser-setup-smoke` executa esse mesmo preparo em cada PR pertinente,
sem Environment nem secrets. O dispatcher verifica também a sintaxe dos helpers
no SHA de produto validado antes de solicitar o gate humano. A branch de produto
deve conter os helpers antes de usar o dispatcher atualizado em uma janela real.

## Limites e falhas

Os limites permanecem: setup do navegador 5 min; demais setups 6 min;
operador 192 min (orçamento interno 190); resumo e artifacts 3 min.
Total de passos 206 min, com margem de 4 min dentro do job de 210 min.
Cleanup de 10 min, restauração de 60 min e relatório de 5 min não mudam.

Um timeout ou falha do smoke encerra o preparo antes do operador. Não repetir
automaticamente um RUN nem tratar o smoke como aceite produtivo.
Se a imagem do runner mudar suas bibliotecas, corrigir e validar o setup em PR;
não instalar dependências sem limite nem reduzir reservas de fechamento.

Na branch de produto, o mesmo helper atende à validação local do aceite PNG
e à acessibilidade CC16 da Central, que também usam Chromium headless 1.55.0.
Fluxos com Firefox/WebKit ou outro contrato de execução não devem receber
`--only-shell` indiscriminadamente.

Referências: [headless shell do Playwright](https://playwright.dev/docs/browsers#chromium-headless-shell)
e [software da imagem Ubuntu 24.04 do GitHub](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).
