# Central de Chamados: ícones dourados e revisão em vermelho

## Escopo visual

A referência visual recebida em 4 de outubro de 2026 mostra os cinco cartões de
métricas do Roadmap com ícones dourados sobre um quadrado escuro. A Central de
Chamados reutiliza esse tratamento, sem substituir os símbolos existentes.

Locais ajustados em `ticket-center-visual.css`:

- Ícones de **Abertos**, **Em andamento**, **Em revisão**, **Vencidos** e
  **Concluídos**, em Lista, Kanban e Calendário: `--maono-accent-bright` e
  `--maono-accent-surface`, os mesmos tokens usados pelo Roadmap.
- Coluna **Em revisão** do Kanban: borda superior em
  `--maono-semantic-danger`, título e contador em vermelho com contraste
  reforçado. O nome e a contagem continuam explícitos; a cor não é a única
  indicação do estado.

Todos os seletores novos estão limitados à Central. Os badges da Lista e do
detalhe, os sinais de prioridade e de vencimento dos cartões, os outros estados
do Kanban e os ícones de ações não foram alterados. Os cinco ícones de resumo
continuam decorativos (`aria-hidden`), e os botões mantêm nome, valor, foco e
estado de filtro (`aria-pressed`).

Não há alteração de backend, permissões, rotas, requests, regras de negócio,
lifecycle, arraste ou transições de status.

## Verificação

- Contrato Node verifica os tokens, a aplicação aos cinco ícones e a restrição
  da cor vermelha à coluna do Kanban.
- Regressão no aplicativo compilado verifica desktop e mobile, os três modos,
  nomes/contagens, foco e ativação de filtro por teclado, conservação
  do badge de revisão na Lista e ausência de requisições de escrita.
- O teste mede o contraste de título e contador com os fundos compostos e
  exige no mínimo 4,5:1. Capturas dos indicadores e do cabeçalho da coluna são
  produzidas por motor de navegador.
- Os testes de navegador usam dados sintéticos e interceptação HTTP, sem
  autenticação real nem aceite de produção.

O teste novo foi executado primeiro contra o bundle anterior: falhou na cor azul
do indicador Em andamento, comprovando que detecta a mudança solicitada.
Os seis cenários novos compilados passaram nos três motores (Chromium, Firefox
e WebKit), com desktop e mobile. As capturas foram inspecionadas. A execução
integrada também aprovou 2.407 testes Node, typecheck, lint focado e o ratchet
estrito de apresentação de erros. O build local foi concluído com heap de
4.608 MiB após liberar o cache temporário do ambiente.

A regressão completa de navegador é coberta pelo gate compilado da Central,
incluindo os fluxos já existentes de paginação, filtros, Kanban, permissões e
seleção de visualização. Os resultados do head publicado ficam no PR e no CI.
