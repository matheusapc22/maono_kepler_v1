# CC17 — execução do gate integrado

REQ-CC-37/38 · CT55–58 · 29/09/2026 · `feat/cc-17-central` → `mano_kepler_v1`.

Implementação técnica preparada; aceite operacional ainda aberto. Base: `a9fb981d4122ed2d2ddb9eab906770fdf10e3047` (CC16). O histórico da PR201, head `46186289723f6dfcdba323aa09cf15fb09ec1807`, foi integrado à branch CC17, com resolução de `package.json` e correções adicionais. Isso não significa merge remoto da PR201.

Planejamento: [pasta CC17](https://drive.google.com/drive/folders/1j6VT2OGxrWNjwzD5EUagyZadr-W04hRU) e [controle](https://docs.google.com/spreadsheets/d/1H5CUSUDV9VdwiWn1S3sQimUF1qKTa7QNcKY4uB5sJNA/edit). Os PDFs de planejamento continuam referência histórica; este registro documenta execução e limitações.

## Entrega e achados

1. Fixture integrada instala as migrations literais 0027–0038 sobre o schema base de comandos. Testa cinco perfis, duas organizações, audiência privada, ACL/deny, notas, contagens, anexos, notificações, métricas e exportação com revogação.
2. **Falha corrigida:** o fallback de organização da sessão permitia `ticket.*` depois da remoção do vínculo. Agora permissões de chamados verificam associação atual antes de considerar grants, preservando o contrato explícito existente de super_admin e a ACL do objeto privado. Regressões cobrem autor, editor com grant explícito, owner e admin; nenhum incidente produtivo foi inferido.
3. Falhas locais: rollback D1, ACK perdido, replay concorrente, CAS, retomada do consumidor, exportação com falha de armazenamento e flags de comandos/consumidores desligadas. Não desliga a proteção de chamados privados para simular rollback.
4. Operador da PR201 endurecido: deny explícito nas capacidades QA; revalidação do SHA antes da configuração; cleanup HTTP verificado; reserva de anexo registrada para cleanup antes do append; resultado dos casos protegido; falha ao salvar relatório não retorna sucesso. `closure` diferencia flags restauradas de recursos efetivamente limpos.
5. Benchmark local executa métricas, exportação e upload resumível em paralelo, com 100 chamados sintéticos, cinco amostras por fluxo e Dropbox simulado. Detecta `SOURCE_CHANGED` quando upload altera a fonte, comprova indisponibilidade do resultado inválido e testa uma nova exportação após estabilização. Registra rejeições iniciais e latência até recuperação.
6. Gate offline verifica completude de evidências, SHA servido, CT55–58, budgets aprovados, observações, review, schema, cleanup e restauração. Nunca autoriza rollout nem comprova sozinho a autenticidade dos links.

## Validação realizada

| Verificação | Resultado local |
|---|---|
| `npm run test:cc17` | 45 testes aprovados: 18 integrados, 5 do gate, 22 do operador |
| `npm run test:expanded` | 1.939 testes aprovados; nenhuma falha |
| `npx playwright test --project=chromium` | 59 testes aprovados, incluindo CC16 e jornadas anteriores |
| `npm run build` | TypeScript + Vite aprovados; avisos preexistentes de dependências/chunks |
| `npm run test:preview-safety` | 23 testes e política de Preview aprovados |
| `smoke-local.mjs` + `smoke-cases-local.mjs` | Binding D1 nativo local, replay, isolamento, transações e integridade aprovados |
| `npm run benchmark:cc17` | Fluxos concluídos com invariantes; relatório `.tmp/cc17/benchmark.json` |

Resultados de CI e SHA final devem ser consultados na PR/controle. As contagens não são percentuais de aceite dos requisitos. Fixtures HTTP/SQLite/Dropbox não substituem produção, leitor de tela real ou compreensão de usuários.

O job `cc17-integrated-gate` publica o benchmark como artifact associado ao head da PR. Cinco amostras fazem o p95 coincidir com o máximo observado: não é estimativa de capacidade nem orçamento aprovado. `errorRate` do benchmark descreve falha final após recuperação; `initialAttemptErrorRate` e `sourceChangeRejections` preservam as rejeições da primeira tentativa. Concorrência assíncrona no adaptador SQLite não representa workers distribuídos. O limite atual da população de métricas é 200 chamados; limites de eventos relacionados não devem ser interpretados como 2.000 chamados.

## Executar e registrar

```sh
npm run test:cc17
npm run benchmark:cc17
# Copiar e preencher acceptance-template.json com evidências reais.
# SHA deve ser o commit exato auditado e servido. Saída deve ser arquivo novo.
npm run gate:cc17 -- evidencia-real.json SHA_DE_40_CARACTERES .tmp/cc17/aceite.json
```

O template começa pendente, sem parâmetros ou aprovações inventados. Exit 1 = pendências; exit 2 = entrada/arquivo inválido; exit 0 = evidência estruturalmente pronta para revisão final. Mesmo nesse caso, `releaseAuthorized=false`. Revisão humana deve confirmar conteúdo, ambiente, responsáveis e resultados de cada link.

## Schema e publicação

**Sem migration CC17.** Nenhum SQL nem `schema.sql` é alterado. Não criar 0039 ou reaplicar 0038 por causa desta entrega. O ensaio com schema expandido é local; ledger e estado do alvo ainda exigem conferência no preflight autorizado.

A default `main`, SHA `3bc289d9292f4cfd26595553f2db28c197a7b305`, ainda não contém o workflow de aceite. A PR de produto consolida PR201; uma PR técnica de bootstrap para `main` disponibiliza workflow, framework e testes sem copiar a aplicação para a default. Ordem: revisar/mergear produto, revisar/mergear bootstrap, configurar/verificar Environment e secrets dedicados no GitHub e somente então executar preflight. Merge não dispara aceite.

O registro remoto atual contém apenas `cc04-selective-access`. **Não existe executor remoto CT55–58 nesta entrega.** Carga e caos dependem de budgets, fixtures, contenção e contrato aprovado; não seria correto cadastrar um runner genérico com comandos/SQL arbitrários ou declarar PASS usando a suite CC04. A instrumentação específica e ensaio autenticado permanecem pendentes explícitos.

## Pendências de encerramento

| ID | Ação / evidência | Papel responsável (nomes a designar) |
|---|---|---|
| C17-P01 | Revisão independente, checks do SHA final, merge produto e registro de SHA servido | Revisor / maintainer |
| C17-P02 | Bootstrap na `main`, Environment `production-acceptance`, secrets dedicados e preflight; regularizar PR201 após integração | Operação / engenharia |
| C17-P03 | Atores reais e duas organizações QA; matriz de capacidades e revogações sem concessões artificiais | Segurança / QA |
| C17-P04 | Aprovar D01–D10: volume, mix, duração, amostras, concorrência, p95, erro, custo, interrupção, janela e responsáveis | Produto / operação |
| C17-P05 | Versionar/revisar suites remotas específicas conforme contrato aprovado e executar CT55–58, incluindo falhas e rollback compatível | Engenharia / QA / operação |
| C17-P06 | Verificar schema/ledger no alvo, conter/drenar jobs, comprovar cleanup e restauração; guardar links por caso/SHA | Operação |
| C17-P07 | Tratar heranças CC12–16, CT53/54 humanos, 15 jornadas e decisões; não fechar por resultado de mocks | Produto / UX / QA |
| C17-P08 | Avaliar achados reais, retestar bloqueadores, obter aceite final e handoff CC18 | Produto / revisor |

O `AGENTS.md` exige confirmação específica `RUN_PRODUCTION_ACCEPTANCE` e aprovação do Environment para a janela. O pedido de executar CC17 autoriza desenvolvimento/PRs; não fornece budgets nem substitui essa decisão operacional. Não houve alterações remotas de dados, flags ou execução de carga/caos nesta implementação. A dispensa anterior de homologação isolada permanece respeitada.

Após as PRs desta execução, **CC18 é a única nova etapa de produto prevista no roteiro**. Ainda será necessário mergear CC17 e o bootstrap técnico; correções/suites dependentes do aceite podem gerar PRs adicionais. Não há número fixo garantido para encerrar todos os gates.
