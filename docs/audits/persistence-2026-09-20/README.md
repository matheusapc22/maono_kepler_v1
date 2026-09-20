# OB-02 e OB-03 — recuperação e integração de persistência

## Base, escopo e plano executado

Base reconferida: `mano_kepler_v1` em `c3a8af8f179d773effa331e78ddeca382e335a78`. A PR #184 foi mergeada em 20/09/2026, às 16:38:36 UTC, conforme GitHub. O merge não comprova a versão servida em Production. Trabalho isolado na branch `test/recycle-recovery-save-integration-20260920`.

| Etapa | Trabalho e critério | Resultado |
| --- | --- | --- |
| OB-02.1 | Delimitar RECYCLE, HEAD canônico, identidade do objeto e prova de quiescência | Runbook com decisões para objeto presente, ausente, publicado e exclusão incerta |
| OB-02.2 | Preparar reparo manual condicionado para exclusão concluída sem confirmação D1 | SQL com organização, HEAD, checksum, tentativa, token, referência, root, arquivo e lifecycle; nunca altera HEAD |
| OB-02.3 | Interromper exclusão antes/depois, ensaiar retorno e invalidar callbacks antigos | 5 testes locais com SQL real e retorno pelo save de produção |
| OB-03.1 | Executar criação pequena/grande e save pequeno/streaming/promoção legacy | Serializadores frontend, serviços, repositories, lifecycle e SQL reais; somente HTTP Dropbox simulado |
| OB-03.2 | Cobrir cancelamento, retry, resposta perdida, hash, concorrência e reabertura | 27 testes comportamentais; mapa golden com dataset, camada, estilo e coordenadas; payload grande acima de 8 MiB |
| OB-03.3 | Reproduzir antes de corrigir e limitar mudanças funcionais | AH-06 e AH-07 abaixo; 3 módulos de produção; sem refatoração ou atualização de dependências |
| Validação | Preservar gates e testar a força das novas asserções | Foundation, contratos existentes, reliability, ratchet, build e 8 mutantes seletivos; resultados em evidence.json |
| Entrega | Publicar proposta revisável e atualizar controle | PR própria; revisão/merge/implantação e aceite remoto continuam etapas distintas |

Não foram aplicadas migrations, criadas sessões de QA remoto, alterados bindings, habilitadas mutações de Preview, ativados operadores ou reativados Change Requests. As flags presentes na fixture valem somente para seu objeto `env` em memória. O SQL de recuperação é um **modelo manual**, sem ligação com inicialização, aplicação, jobs ou operador.

## Achados confirmados

### AH-06 — Callback de criação desativa o arquivo da tentativa vencedora (P1)

- **Evidência:** cinco asserções falharam antes da correção em `regression-before.log`; teste completo `concurrent large creation cannot invalidate an already activated winner`, callbacks pequeno/grande e corrida entre leitura e atualização do arquivo.
- **Hipótese causal confirmada:** o CAS de lifecycle evitava retroceder o projeto, mas o UPDATE seguinte em `organization_files` usava somente o ID. Um callback antigo podia escrever `ERROR/active=0` após outra tentativa ativar o projeto ou retomar uma reserva.
- **Impacto observado:** projeto ACTIVE/HEAD íntegro com arquivo vinculado inativo; ou projeto PREPARING_STORAGE com arquivo ERROR. Há inconsistência de disponibilidade/metadados. Não foi observada exclusão de bytes nem incidente remoto.
- **Reprodução:** pausar o primeiro `upload_session/finish`; repetir a criação com a mesma chave até ativar; liberar o primeiro. Separadamente, retomar a reserva entre a leitura do callback e seu UPDATE. Antes: arquivo desativado/ERROR. Depois: ACTIVE ou PROCESSING preservado.
- **Correção pequena:** UPDATE do arquivo confere organização e, atomicamente, ausência de projeto ACTIVE ou com versão de lifecycle diferente da observada. A mesma regra cobre os helpers de criação pequena e grande.

### AH-07 — Liberação atrasada de quota atinge criação retomada (P1)

- **Evidência:** `quota-before.log`: esperado PROCESSING, recebido RELEASED. `large failure quota release cannot overtake a retry after the file CAS` passou após a correção.
- **Hipótese causal confirmada:** proteger apenas a atualização do arquivo não protege a atualização posterior da quota. Uma nova reserva pode começar entre as duas gravações; `releaseProjectQuota` não recebia a identidade do lifecycle que falhou.
- **Impacto observado:** reserva PROCESSING da nova tentativa passa a RELEASED. Pode comprometer capacidade reservada e finalização; ultrapassagem real de quota ou perda de mapa não foi demonstrada.
- **Reprodução:** falhar uma criação; durante um callback posterior, retomar a reserva imediatamente antes do UPDATE de liberação de quota. Conferir projeto PREPARING_STORAGE, arquivo PROCESSING e quota. Antes: quota RELEASED. Depois: PROCESSING.
- **Correção pequena:** reutilizar `releaseProjectQuota` com snapshot opcional do projeto; a atualização confere projeto, organização, versão e estado não ACTIVE. Os dois callers de criação passam o snapshot. Chamadas sem snapshot preservam o contrato anterior, inclusive sem exigir colunas de lifecycle na consulta.

P0 é a prioridade dos trabalhos OB-02/03. Os dois novos defeitos são classificados como P1 pelo impacto efetivamente reproduzido; o ensaio não permite afirmar perda remota de dados.

## Matriz de cobertura

| Caminho real | Falhas/sequências verificadas | Prova e limite |
| --- | --- | --- |
| Criação pequena | Upload falha; projeto inativo; retry mesma chave; resposta perdida | Um projeto/owner/quota; ativação só com revisão íntegra |
| Save pequeno versionado | Dois conteúdos concorrentes; retry com revisão antiga e conteúdo vencedor | Um vencedor, conflito tipado, reabertura e duas revisões no ledger |
| Save pequeno legacy | Sobrescrita e reabertura | Preserva semântica existente; não introduz versionamento/CAS para legacy pequeno |
| Criação grande | Reserva → stream → publicação → owner/ativação/quota; abort; falha após publicação; concorrência | READY pode ser retomado sem outra revisão; owner e arquivo ativo; nenhum request.json/text no stream |
| Save streaming versionado | Cancelamento no body, truncamento, append/finish com confirmação perdida, hash divergente, falha de publicação | HEAD anterior preservado; reconciliação de offset/metadata; retry publica uma vez |
| Promoção legacy streaming | Mesmas falhas, promoção e resposta perdida; disputa de READY antes do CAS | Conteúdo antigo preservado até promoção íntegra; replay idempotente pelo caminho versionado |
| READY substituído | Leitura antiga → candidato envelhecido → recycle/save real substituto → publicação substituta interrompida → CAS antigo | Ambos os serviços recusam metadata antiga; retry do novo conteúdo publica corretamente |
| Cleanup de criação | Callback atrasado, nova reserva antes do UPDATE do arquivo e antes do UPDATE de quota | AH-06/AH-07; asserções em tabelas reais, sem mock da regra de negócio |
| RECYCLE | Delete interrompido antes/depois; produtor pausado; timestamp antigo; recuperação e replay | 5 testes: ausência verificada e quiescência local permitem reparo; incerteza mantém bloqueio |
| Escopo/identidade do reparo | Organização, revisão, checksum, tentativa, token, storage_ref, root, arquivo e lifecycle alterados | Cada snapshot divergente retorna zero linhas; HEAD publicado impede reparo |
| Fidelidade | Bytes multibyte, fronteira de 4 MiB, payload >8 MiB, dataset/camada/estilo/mapState golden | Deep equality após leitura verificada; não é comparação de pixels/GPU/tiles |
| Isolamento e segurança existentes | Gates de organização, permissões e Preview preservados | Cenários locais anteriores continuam; matriz autenticada D1/Dropbox permanece em OB-04 |

Arquivos: `tests/project-persistence-integration.test.mjs`, `tests/project-recycle-recovery.test.mjs` e `tests/helpers/project-persistence-fixture.mjs`. O banco é SQLite em memória com o `schema.sql` real. O D1 adapter delega cada statement ao SQLite. O DropboxClient real usa seu ponto de injeção HTTP existente: bytes, offsets, hashes e conflitos são simulados na fronteira externa, sem rede. Isso não prova equivalência completa com D1 remoto nem com Dropbox real.

## Hipóteses descartadas no ensaio e pendências

- **Não reproduzido:** bytes duplicados após perda de confirmação de append; publicação após hash divergente; HEAD antigo avançar com READY substituído; nova revisão após resposta perdida de save já publicado. Os testes específicos passaram; não são garantias para toda sequência possível.
- **Não reproduzido:** callback atrasado liberar quota já COMMITTED. O guard de status existente a protegeu. AH-07 envolve quota PROCESSING de uma nova tentativa.
- **Defeitos da própria fixture, corrigidos:** o teste inicial esperava propagar OFFLINE_INTERRUPTION na criação pequena, mas o contrato real encapsula PROJECT_CREATION_FAILED; a criação grande deve usar prepareProjectCreateTransport, pois serializeSaveRequest com operação create não seleciona o body streaming. Não classificados como bugs do produto.
- **Compatibilidade preservada:** o gate existente de quota usa um schema mínimo sem lifecycle. A cláusula nova só é incluída quando há snapshot, mantendo o contrato anterior. Nenhum teste foi removido, relaxado ou desabilitado.
- **Pendente operacional:** comprovar quiescência, ausência/identidade do objeto e recuperação em ambiente autorizado com D1/Dropbox reais; sessão legítima e responsável definidos. Objeto presente, HEAD inconsistente ou operação em voo exigem investigação; este runbook manda preservar, não faz reparo genérico.
- **Pendentes fora deste recorte:** OB-01 revisão/entrega da nova correção e comprovação da versão implantada; OB-04 aceite remoto; OB-05 triagem das nove falhas ampliadas já registradas; OB-06 fidelidade visual; OB-07 SLO. Não foram encerrados por inferência.

## Reprodução e aceite

```sh
npm run test:persistence-integration
npm run test:foundation-gate
node scripts/audit-persistence-mutations.mjs
npm run test:reliability
node scripts/audit-user-error-sinks.mjs --baseline scripts/user-error-sink-baseline.json --strict-baseline
npm run build
```

O script de mutação reutiliza a abordagem isolada do auditor anterior: cópia temporária, baseline positivo por caso, mudança de um guard, exigência de falha por asserção e limpeza da cópia. Timeout, erro de importação ou falha de infraestrutura não contam como mutante eliminado. Cobre token/geração da recuperação, ACTIVE/versão nos callbacks, CAS de quota, hash de streaming e ledger do CAS legacy.

A planilha deve registrar código/procedimento e testes locais concluídos em OB-02/03, com OB-02 ainda pendente de aceite operacional. Concluído em código não significa merge, deploy ou autorização para executar o SQL em ambiente real. O runbook completo está em [project-revision-recycle-recovery.md](../../runbooks/project-revision-recycle-recovery.md).

## Resultado local consolidado

| Verificação | Resultado |
| --- | --- |
| Foundation, incluindo os novos casos | 844/844 |
| Novos testes (subconjunto do Foundation) | 32/32: 27 integração + 5 recuperação |
| Reliability existente | 184/184 |
| Contratos adicionais CREATE/SAVE | 69/69 |
| Mutantes seletivos | 8/8 detectados por asserção, baseline positivo em cada caso |
| Ratchet estrito | Inventário high-signal idêntico ao baseline |
| Build | TypeScript + Vite aprovados; avisos existentes preservados |

Esses totais têm sobreposição entre gates e não devem ser somados como testes distintos. Evidências e hashes: [evidence.json](evidence.json). Logs do antes/depois e resumo: [evidence](evidence/). Execução local em Node 24.19; CI existente usa Node 22. Revisão humana, CI da PR e aceite operacional são registros próprios, não inferidos desses resultados.
