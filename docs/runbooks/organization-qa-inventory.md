# Inventario QA de Organizacoes — somente leitura

Preparacao local autorizada em 30/10/2026. Este instrumento nao cria organizacoes,
usuarios, sessoes ou arquivos, nao altera flags e nao executa acceptance. Nao
substitui a suite funcional futura nem certifica que os dados sao sinteticos.
A declaracao humana de que as organizacoes sao de testes continua sendo uma
premissa externa, nunca uma conclusao derivada do banco.

## Caminho protegido e publicacao futura

Reutiliza `production-d1-migration-operator.yml`, acrescentando uma acao separada
`organization-qa-inventory`. O alvo e fixo: `maono_maps`, UUID
`5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`, branch `mano_kepler_v1`, migration
`0042_organization_management.sql`; `approval_hash` deve estar vazio. Nao recebe
SQL, ID, URL, segredo ou flag arbitrarios. Audit/apply/postvalidate permanecem
separados; a nova acao nunca chama apply.

Plano, sujeito a revisao/autorizacao posterior:

1. Publicar PR draft de produto com scripts, contratos, documento e copia do
   workflow; aguardar CI e revisao do SHA final. Nenhuma publicacao nesta preparacao.
2. Integrar o produto somente com autorizacao de merge. Conferir SHA, arvore e
   deploy. Isso ainda nao disponibiliza uma nova opcao no dispatcher em `main`.
3. Revisar e integrar separadamente em `main` apenas o delta do dispatcher,
   reconciliando seu HEAD real. Nao fazer merge de todo o produto em `main`, nem
   substituir protecoes exclusivas do control-plane pela copia do produto.
4. Com autorizacao especifica para leitura protegida, usar uma unica execucao do
   workflow oficial em `main`, modo `organization-qa-inventory`, migration fixa e
   hash vazio. O workflow valida owner/ref/inputs, fixa o SHA de produto, roda os
   contratos sem credenciais e espera aprovacao humana do Environment
   `production-d1-migrations`. Nao aprovar o Environment em nome do usuario.
5. O job protegido confere novamente o HEAD da branch antes da rede. Token
   existente somente nos dois passos ja protegidos do runner, nunca no agente.
   O CLI tambem verifica contexto, SHA limpo e hashes locais antes da rede.
6. Ler o artifact dessa mesma execucao. Conferir SHA, alvo, horario e resultado;
   nao repetir dispatch diante de resultado incerto. Nenhum candidato ou drift
   exige relato, nao fallback, criacao de dados ou uso do endpoint 403.
7. A candidata pode delimitar o preflight oficial
   `organization-management-readiness` apos conferir frescor e janela humana.
   Esse preflight so observa o control-plane Pages: nao autentica QA, nao prova
   storage/runtime/UI e nao executa acceptance. Uma suite funcional registrada,
   credenciais QA apropriadas, plano de limpeza/restauracao, literal
   `RUN_PRODUCTION_ACCEPTANCE` e Environment continuam necessarios antes de
   qualquer janela funcional. Ativacao permanente continua separada.

## Consultas e selecao

O coletor reutiliza a comparacao exata de schema 0042 (perfis historico e canonico),
hashes das fontes, ledger bruto estrito e integridade. Exige zero migrations
pendentes e nenhuma violacao de FK. Nao relaxa o FAIL historico do run41003828754;
o PASS remoto posterior do run41091552532 permanece evidencia separada.

Duas consultas de inventario fixas sao executadas duas vezes, com ledger estrito
novamente ao final. No maximo 100 organizacoes: total maior ou truncamento
bloqueiam, sem selecionar de um subconjunto. Datas invalidas contam como atividade.
Campos extras, ausentes, tipos invalidos, IDs duplicados, contagens inconsistentes
e qualquer divergencia entre as leituras bloqueiam. Nao ha retry automatico.

Por organizacao, le somente ID, active, storage_status normalizado para enum,
presenca booleana de erro de storage, versao gerencial, presenca/eligibilidade do
responsavel, contagens de membros/owners ativos e membros compartilhados,
sessoes ainda validas ou com data invalida, delegacoes habilitadas, recursos e
trabalho pendente; uma flag indica alteracao recente (24h) ou data invalida.
O SQL usa dados de usuario somente em JOIN/EXISTS/COUNT e nunca os projeta.
Nenhum nome/slug/caminho de organizacao e exportado; ID basta para identidade.

Recursos contam projetos, arquivos (inclusive inativos/lixeira), pastas, tickets,
roadmaps e exports legados sem ler seus nomes/conteudos. Trabalho pendente cobre
reservas, solicitacoes de limite, operacoes de save/preview nao terminais e suas
outboxes ainda pendentes mesmo depois de publicacao, uploads de anexos, outbox
de tickets ainda nao entregue, exports de tickets em fila e seu GC, e change
requests nao terminais. Exports legados bloqueiam conservadoramente em qualquer
status: a fonte versionada cria queued/requested, sem contrato de conclusao.
Inclui tambem reservas de anexos sem sessao, backfill de tickets nao ready ou com
pending/skipped_count, uploads/purge de arquivos (inclusive purge vencido ou de
data invalida), preview PENDING legado, revisoes de configuracao em escrita ou
READY acima do ponteiro publicado e links de change que ainda exigem reconciliacao.
As contagens podem sobrepor etapas da mesma operacao; sao sinais de bloqueio,
nao uma contagem de tarefas unicas. A ausencia de marcador de backfill nao
certifica readiness de tickets. Nao se le o conteudo de nenhuma dessas filas.
Reservas expiradas ainda nao encerradas e delegacoes habilitadas mesmo expiradas
sao bloqueios conservadores. Itens gerenciais nao bem-sucedidos ou operacoes sem
itens bloqueiam globalmente: nao se interpreta payload JSON para atribuir org.

Candidata exige ativa, status READY sem erro residual, ao menos um owner ativo,
responsavel gerencial elegivel quando definido, nenhum membro compartilhado,
delegacao habilitada, sessao viva, trabalho pendente, alteracao recente ou item
gerencial global nao resolvido. Entre elegiveis: menos recursos, depois menos
membros, depois menor ID. Recursos existentes nao autorizam sua alteracao.
Nao encontrar candidata e resultado valido, sem inventar ou reutilizar um ID.

## Minimizacao e limites

O artifact contem a candidata (ou null), contagens totais/de exclusao,
digests e perfil do schema/ledger, integridade resumida, procedencia e limites.
A versao 2 acrescenta `excludedOrganizations`: somente `{ id, reasons }` para
cada organizacao excluida. Reutiliza os IDs validados e os mesmos codigos fixos
que ja compoem os totais; nao faz consulta adicional nem recalcula elegibilidade.
A lista segue ID crescente, sem duplicatas, com no maximo 100 entradas e seis
codigos por entrada. Organizacoes elegiveis nao selecionadas continuam omitidas.
Inventario vazio ou inteiramente elegivel produz lista vazia; sem candidata,
a lista permite associar cada exclusao ao ID sem alterar nenhum recurso.
As categorias se sobrepoem: uma organizacao pode ter varios codigos. Esses
codigos agrupam sinais; por exemplo, OBSERVED_ACTIVITY nao distingue uma sessao
de trabalho pendente e SHARED_ACCESS nao distingue membro de delegacao.
Exceto o diagnostico fixo do ID4 descrito abaixo, nao exporta linhas agregadas
completas das excluidas. Nao exporta ledger completo, DDL, erros livres,
linhas de FK, nomes/emails/IDs de usuarios, tokens, conteudo de negocio ou logs.
Apenas o JSON fixo e publicado pelo workflow, retencao de tres dias. Esse
relatorio contem ID/contagens operacionais e deve ser tratado como evidencia
minimizada; nao adicionar identificadores pessoais para facilitar a escolha.

Relatorios da versao 1, inclusive o run 41109323371, nao contem diagnostico por
ID. Preservar esses artifacts originais: a ausencia do campo nao significa que
nao houve exclusoes. A extensao v2 nao requer novo input, segredo, permissao ou
delta no dispatcher de main. Publicar e integrar a alteracao de produto continua
dependendo de revisao/CI e autorizacao; uma nova leitura depende de autorizacao
especifica e do mesmo Environment humano. Diagnostico nao autoriza saneamento,
criacao de organizacoes, mudanca de owners, flags ou acceptance.

## Diagnostico direcionado v3 - organizacao 4

A versao 3 preserva os campos anteriores e acrescenta `targetedDiagnostics`,
exclusivamente para o ID4 fixo no codigo. Se nao existir, o campo e `null`; nao
fabricar contagens zero. A candidata em `selection.organization` continua com
exatamente os 16 campos anteriores, mesmo quando outra organizacao for escolhida.
Nenhum input permite escolher outro ID, SQL, URL ou segredo.

O total original e sua consulta SQL permanecem intactos dentro da mesma chamada.
Novas agregacoes condicionais detalham o ID4; isto amplia a projecao, mas nao
acrescenta chamadas remotas, tabelas, escritas ou dados pessoais. As duas leituras
e a comparacao integral de drift incluem os detalhes. `snapshotDigest` preserva
o contrato v2 dos agregados anteriores; `targetedDiagnosticsDigest` fixa o novo
bloco separado. Ausencia de detalhe em v1/v2 nao significa ausencia de bloqueio.

O bloco fornece:

- `state` e `members`: estado registrado, versao, membros totais/ativos/compartilhados
  e delegacoes habilitadas. Nao identifica pessoas ou vinculos individuais.
- `ownership`: owners totais/ativos/inativos; presenca e elegibilidade do
  responsavel; existencia/atividade do usuario e existencia/papel owner do
  vinculo, apenas como 0/1. `noActiveOwner` e `ineligibleAssignedManager` sao
  independentes. Responsavel nao atribuido, sozinho, nao e bloqueio.
- `resources.bySource`: seis contagens de projetos, arquivos, pastas, tickets,
  roadmaps e exports legados, incluindo recursos inativos/lixeira como antes.
- `sessions.byExpiryAndAssociation`: seis contagens disjuntas, cruzando prazo
  futuro valido ou data invalida/nula com associacao pela organizacao ativa,
  pelo vinculo de membro ou por ambos. Sessao expirada nao entra no total.
- `changes`: metadata invalida, futura ou passada recente; eventos invalidos,
  futuros ou passados recentes. Metadata e 0/1; eventos sao contagens. Recente
  significa entre agora menos 24 horas e agora. Futuro e separado; nao dizer
  que todo sinal representa uma alteracao ocorrida nas ultimas 24 horas.
- `pendingWork.bySource`: as 18 fontes de pendencias ja cobertas pelo coletor.
  `overlappingCauses` separa, dentro de backfills, status/pending/skipped; dentro
  de arquivos, estado/purge com data invalida/purge vencido; dentro de revisoes,
  estado nao terminal/acima do ponteiro READY/acima do ponteiro com publicacao;
  dentro de links, status ausente/versao divergente. Sao CONTAGENS DE LINHAS,
  nao somas dos campos pending_count ou skipped_count nem tarefas unicas.

As causas internas podem se sobrepor; sua soma NAO substitui o total da uniao.
Um mesmo fluxo tambem pode ocupar fontes diferentes. O validador exige chaves
exatas, inteiros seguros nao negativos, coerencia com os totais e detalhes nulos
para qualquer outro ID. Elegibilidade, motivos, ordenacao e limite nao mudam.

Uso do resultado: separar ausencia de owner de responsavel inelegivel; distinguir
datas invalidas de prazo/atividade recente; identificar a fonte operacional da
pendencia. Isso permite decidir entre aguardar quietude e investigar uma categoria
especifica. Nao diagnostica por si so fila travada, defeito do provider ou dados
de negocio incorretos. Contagens nao identificam usuario/recurso para mutacao
exata, nao autorizam limpeza e nao comprovam menor impacto ou exclusividade.
Uma correcao posterior pode registrar novo evento e reiniciar a janela de 24h.
Credenciais QA, flags, storage real e runtime/UI continuam sem comprovacao.

Preparacao v3 somente local nesta etapa. Publicacao, integracao, nova execucao
protegida e eventual adequacao continuam etapas distintas; nao usar o resultado
para alterar owners, sessoes, delegacoes, filas ou lifecycle por inferencia.

Estabilidade de contagens nao e snapshot transacional nem prova de exclusividade:
trocas de membros/recursos com mesmas contagens, escritas entre leituras,
processos externos ou novos trabalhos apos a coleta podem nao ser detectados.
Nao consulta provider de storage, nao valida caminho/canonicalidade de storage,
nao observa flags e nao comprova ACL/identidade QA de login. READY e apenas estado
registrado. Uma janela funcional exige confirmacao atual de ausencia de outros
testes e os gates acima. Nao ampliar acesso para preencher essas lacunas.

## Validacao local

`npm run test:production-migration-gate` inclui SQLite sintetico nos dois perfis,
query_only, snapshots integrais, selecao/negativos, drift de ledger/agregados,
rejeicao de payload inesperado e contratos do dispatcher. Nunca executar o CLI
produtivo localmente para testar; ele recusa contexto fora do runner protegido.
Os testes injetam somente o transporte e executam as consultas reais em SQLite.

Locais equivalentes tratados: o novo coletor reutiliza a leitura estrita do
ledger exportada pelo postvalidate, evitando a normalizacao permissiva do helper
legado; o guard de modo/0042/hash vazio existe tanto antes do Environment como
no ramo de execucao. A CI comum e o validador do operador incluem os novos
contratos. Os instrumentos de acceptance, recovery, evidencias manuais fixadas
na org9 e suas autorizacoes permanecem inalterados.

A revisao independente encontrou falsa elegibilidade na primeira versao para
exports e outboxes. Foram corrigidos no mesmo predicado os caminhos equivalentes
acima, com regressao executada antes/depois em ambos os perfis. Nenhum worker,
API, migration, schema ou regra funcional foi alterado; somente o inventario.
