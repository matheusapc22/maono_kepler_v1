# Evidência local da interface CC-03

Execução reprodutível: `node scripts/central-chamados/smoke-command-ui.mjs`.

O script monta os componentes reais `TicketDetailDrawer`, `TicketLifecyclePanel` e `NewTicketPopover`, com o cliente HTTP real. Usa Chromium 140.0.7339.16 e intercepta HTTP local com dados fictícios; não acessa contas, Preview, D1 ou produção.

| Cenário | Resultado |
| --- | --- |
| Iniciar e encerrar espera | Status canônico preservado, próxima ação e If-Match enviados. |
| Concluir com mudança pendente | Bloqueado até confirmação explícita da independência da mudança. |
| Reabrir | Novo ciclo exibido; conclusão do ciclo anterior continua disponível. |
| Resposta 412 | Rascunho preservado. Consultar versão atual e adotar a versão não reenviam o comando. Uma nova confirmação usa o novo If-Match. |
| Perfil somente leitura | Acompanhamento disponível; formulários de comando ausentes. |
| Mobile de 390 px | Sem overflow horizontal; controles dentro da largura disponível. |
| Criação com resposta perdida | Fechar e reabrir preservam intenção. Repetição envia chave e payload idênticos; apenas uma criação no servidor simulado. |

Não ocorreram erros JavaScript não tratados nem requisições externas. As três imagens foram inspecionadas visualmente. Relatório de execução: `command-ui-smoke.json`.

Imagens: `command-conflict-desktop.png`, `command-mobile.png`, `command-create-uncertain.png`.

Esta evidência complementa os testes do servidor/SQLite. **QA autenticado, aplicação remota da 0026, reconciliação do D1 remoto e ativação do flag não foram executados.**
