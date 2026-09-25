# CC-01 — baseline, contratos e jornada

Pacote técnico para revisão da primeira entrega da Central de Chamados Maõno. Data: 25/09/2026. Requisitos: **REQ-CC-01 e REQ-CC-02**. A implementação desta etapa consiste em inventário verificável, contratos, decisões propostas, protótipo offline e validação automatizada de consistência. Os recursos de atendimento previstos em CC-02 a CC-18 continuam em suas próprias entregas.

## Como revisar

1. Leia [baseline.md](baseline.md): fonte, divergência das branches, Preview, schema e lacunas de operação.
2. Compare [contracts.md](contracts.md) e [contracts.json](contracts.json): comportamento atual e contratos futuros estão identificados separadamente.
3. Abra [prototype.html](prototype.html) no navegador. Execute as tarefas de [journey.md](journey.md) como solicitante e atendente.
4. Registre revisão e aceite em [acceptance.md](acceptance.md) e no [controle de PRs](https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit).

O protótipo usa dados fictícios, opera localmente e não chama as APIs de produção. Para servi-lo em localhost, a partir da raiz do repositório:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs/central-chamados/cc-01
```

Abra `http://127.0.0.1:8765/prototype.html`. Nenhum segredo ou login é necessário.

## Plano técnico executado

| Etapa | Entrega concreta | Critério de verificação |
|---|---|---|
| Fixar a fonte | SHA funcional, default e ancestral comum; mapa dos commits exclusivos | CT-01; observações remotas distinguem check de build, sessão autenticada, schema e produção |
| Definir a integração | PR para `mano_kepler_v1`, sem incorporar a stack de `main` | Revisão da reconciliação e ratificação ADR-CC-01 antes do gate |
| Inventariar contratos | Métodos, caminhos, handlers, capacidade, payloads, retornos e erros atuais | Validador compara os endpoints, enums e referências com os arquivos existentes |
| Propor o domínio | Natureza separada de domínio; espera, fechamento, reabertura, prioridade, visibilidade e CR | Cada proposta registra a PR de implementação; vínculo nunca concede autorização |
| Exercitar a jornada | Protótipo por perfil e cenários de dúvida/incidente; mensagens e responsáveis | CT-02 exige walkthrough humano e registro das dificuldades |
| Sustentar a entrega | Workflow de consistência e regressões existentes, relatório de execução | Logs verificáveis; aceite humano, merge e deploy têm campos próprios |

## Decisões e parâmetros

| ID | Proposta da CC-01 | Condição para ratificação |
|---|---|---|
| ADR-CC-01 | Usar `mano_kepler_v1` no SHA registrado como base desta PR. Analisar os 22 commits exclusivos de `main` por intenção e equivalência de conteúdo | Mantenedor confirma base de integração e trilha de release; `main` não é automaticamente a fonte implantada |
| ADR-CC-02 | Preservar `new`, `open`, `in_progress`, `in_review`, `closed`; espera como atributo; fechamento com resultado/comunicação; reabertura inicia novo ciclo | Responsável de atendimento revisa o protótipo e o contrato de transições; implementação em CC-02/03 |
| ADR-CC-10 | Políticas versionadas para reabertura, feedback e orçamento de desempenho; sem valores contratuais presumidos | Operação define os parâmetros abaixo antes da ativação e do teste de carga correspondente |

| Parâmetro | Unidade e conteúdo obrigatório | Estado neste pacote | Dono da decisão |
|---|---|---|---|
| Janela de reabertura (`h`) | Horas, marco inicial, exceções de contestação e tratamento de novo escopo | Não configurada; protótipo ilustra reabertura sem prometer janela | Operação/produto — a designar |
| Janela de feedback (`f`) | Horas, elegibilidade, voluntariedade e expiração do convite | Não configurada; nenhuma coleta ativada | Operação/produto — a designar |
| Primeira resposta e resolução | Alvos, calendário, fuso IANA, pausas elegíveis, vigência e versão | Sem política configurada; não apresentar countdown ou promessa | Gestor de atendimento — a designar |
| Desempenho | Dataset/volume, concorrência, ambiente, p95 por operação, taxa de erro, duração do ensaio e orçamento aceito | Baseline de desempenho remoto não medido | Engenharia e operação — a designar |

Nenhum desses parâmetros é convertido em prazo ou SLO implícito. O contrato deve permitir a ausência explícita de política; a ativação posterior exige decisão versionada. O painel global e a concessão por super admin pertencem ao programa PG e não são ativados pela CC-01.

## Verificação reproduzível

Requer Node.js 22 ou superior. O conjunto abaixo usa dependências nativas do Node e os arquivos do repositório, sem instalar o aplicativo:

```bash
node scripts/central-chamados/validate-cc01.mjs
node --test tests/ticket-center.test.mjs
npm run test:preview-safety
```

O workflow [Central de Chamados contracts](../../../.github/workflows/central-chamados-contracts.yml) executa os mesmos comandos. O validador garante consistência do inventário com a fonte; não prova autorização em runtime, transações, performance ou comportamento do D1 remoto. Alterações futuras em endpoints/enums devem atualizar o contrato junto da implementação, preservando a distinção entre baseline histórico e estado atual. Não é necessário reconstruir a aplicação para validar documentação e protótipo isolados; o build do Pages, quando emitido, é evidência adicional e não aceite funcional.

O ensaio automatizado opcional do protótipo usa o Playwright já declarado em `devDependencies`. Com as dependências e Chromium instalados, execute `node scripts/central-chamados/smoke-prototype.mjs`. Ele percorre dúvida/incidente, verifica fechamento e reabertura, separação de revisão, foco, viewport móvel e ausência de requests externos. O resultado em [evidence/prototype-smoke.json](evidence/prototype-smoke.json) é verificação técnica; CT-02 humano continua pendente.

## Implantação, migrations e rollback

**CC-01 não cria, altera nem exige nova migration.** Não há execução de D1 local, Preview ou produção. As migrations históricas 0021, 0022 e 0023 continuam sem autorização de aplicação neste pacote; sua presença histórica não comprova aplicação remota. A migration 0024 já existe e seu número não pode ser reutilizado.

O código de produto, as rotas públicas e o schema permanecem fora do diff desta etapa. O protótipo em `docs/` não é adicionado à navegação do aplicativo. A publicação da branch pode disparar o build de Preview configurado pelo repositório; registre o resultado sem executar smoke autenticado ou acionar workflows de migração por inferência.

- Antes do merge: revisar diff, workflow, contratos, CT-01, resultados automatizados e decisões pendentes; executar CT-02 com os perfis reais.
- Antes de usar o baseline para CC-02: confirmar HEAD de integração, revisar drift dos contratos e obter leitura autorizada de schema/history do ambiente alvo se necessário.
- Merge e release: feitos pelo processo do mantenedor, com SHA e artefato registrados no controle. A PR aberta não equivale a entrega implantada.
- Rollback deste pacote: reverter o commit após revisão. Não há rollback de dados ou SQL; nenhuma migration remota foi executada.

## Rastreabilidade

- [Pasta 09 — material de referência](https://drive.google.com/drive/folders/1dTQnrcuwqHx2FS4OJkjh-C_QBwuULX_z): `Contexto_09_Central_de_Chamados.pdf` (6 páginas) e `Pesquisa_09_Central_de_Chamados_Maono.pdf` (21 páginas), lidos no planejamento.
- [Planejamento completo](https://drive.google.com/file/d/1-T3COVy_eLMyP_595DVLtKBMJ5qpXBq5/view): camada de entrada, coordenação/comunicação, confiabilidade e métricas por eventos.
- [Controle CC-01](https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit): abas PRs, Aceite, Requisitos, Testes, Migrations e Governanca. A conclusão depende de evidências, sem alteração manual das fórmulas do gate.
