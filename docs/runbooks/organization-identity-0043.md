# Preparação operacional de 0043

Este procedimento prepara `0043_organization_creation_identity.sql` para o operador protegido. A preparação original (#271, SHA `4386083dec4522f380559d3871e3140451e7e8d7`) não ativou a funcionalidade da PR #270, não alterou rotas/UI e manteve `schema.sql` na referência 0042. Integrar código não aplica a migration.

Na reconciliação funcional da #270, o bootstrap passa a incluir 0043 e o runtime reutiliza a função pura `organization-name.js`. O perfil pós-0043 continua sendo construído offline aplicando o SQL fixado sobre cada perfil histórico certificado de 0042; o coletor antigo não passa a aceitar objetos novos. Os contratos preservam o runtime e testes originais da preparação no SHA fixado, além de provar que o runtime funcional recusa 0042 e usa identidades canônicas em 0043. A publicação funcional continua dependendo da sequência protegida abaixo.

A fonte SQL é idêntica à PR #270 no SHA `93f18b06ac2b2703e499df8ced450a8938c52f20`: SHA-256 `ce53acea032786a27a79b9e917cc774c2309d05ff7f30b0f2c4769738ff1d531`. Ela acrescenta `canonical_name` nullable, dois índices únicos, `organization_creation_identities` e três triggers. Nenhum nome, slug ou caminho histórico é reescrito. Os históricos conservam a chave canônica nula. Os índices podem rejeitar dados conflitantes e passam a restringir escritas antigas: isso exige planejamento de publicação.

## Evidência e autorização exatas

O perfil explícito `pre` exige 0042 no ledger, todas as migrations que formam o perfil reconhecido e ausência de 0043. `post` exige 0043 e a estrutura completa correspondente. As referências vêm somente de fontes locais fixadas por SHA-256, nunca do schema remoto. O coletor 0042 e o modo `organization-qa-inventory` continuam exclusivos de 0042 e recusam os objetos novos. Um ledger genérico que liste 0043 não certifica a estrutura.

Uma única consulta SELECT fixa reúne, no mesmo snapshot SQLite, a contagem e os campos brutos `id,name,slug,dropbox_root_path` de **todas** as organizações, ordenadas por ID, o ledger e os metadados estruturais. Não há filtro de status, LIMIT, paginação parcial nem reutilização do inventário QA minimizado. Respostas sem sucesso explícito, truncadas, malformadas, IDs duplicados, campos ausentes/nulos/vazios e contagem divergente bloqueiam o audit. Um array vazio só é completo quando a contagem do mesmo snapshot é zero.

O preflight compara nomes por NFKC, trim, redução de espaços Unicode, lowercase e NFKC final. Acentos são preservados; formas de compatibilidade e acentos compostos/decompostos são comparados corretamente. Também verifica sufixos numéricos com zeros iniciais e pastas sem distinção de caixa. Qualquer conflito bloqueia a operação; não há reparação automática.

O hash de aprovação inclui os campos usuais (migration, hash fonte, Git SHA, pendências, banco) **e** os digests determinísticos do inventário bruto completo, ledger estrito, schema observado e arquivo de execução. Uma renomeação com a mesma contagem muda a autorização. A data de geração e o bookmark novo não entram no digest determinístico. Os relatórios contêm contagem, hashes, perfil, ledger e verificações, sem nomes, slugs, pastas ou SQL remoto bruto.

O arquivo realmente autorizado para aplicação tem o mesmo nome `0043_organization_creation_identity.sql`, mas contém verificações SELECT de igualdade seguidas dos bytes intactos da fonte fixada. Portanto existem hashes distintos e explícitos:

- `migration.sha256` / `execution.sourceSha256`: SQL fonte versionado;
- `execution.sha256`: bytes do arquivo isolado **executável**, incluindo todos os guards;
- `execution.requestSha256`: SQL acima com o INSERT de ledger acrescentado pelo Wrangler 4.140.0;
- `evidenceDigest` e `approval.hash`: vínculo de toda a evidência, bytes executáveis e estado auditado.

O texto de autorização emitido pelo audit identifica explicitamente o arquivo guardado e seu hash. Aprovar apenas o hash da fonte não autoriza o derivado. Não há autorização de produção nesta preparação. O arquivo derivado contém dados privados codificados em hexadecimal: fica somente no diretório temporário restrito do runner, não em artifacts/logs. Hexadecimal evita injeção e preserva bytes; não é anonimização.

Os subprocessos de leitura e aplicação forçam `WRANGLER_WRITE_LOGS=false`, sobrescrevendo qualquer configuração herdada. Isso é necessário porque o [logger do Wrangler](https://github.com/cloudflare/workers-sdk/blob/wrangler@4.140.0/packages/wrangler/src/logger.ts) normalmente persiste respostas completas em um [arquivo global](https://github.com/cloudflare/workers-sdk/blob/wrangler@4.140.0/packages/wrangler/src/utils/log-file.ts), fora do cleanup do diretório temporário. O contrato com CLI real consulta o snapshot privado e aplica o payload contra loopback, com logs herdados habilitados, e exige ausência de arquivos de log tanto em sucesso quanto em falha. stdout/stderr permanecem capturados em memória e somente os relatórios sanitizados são publicados.

O `apply` reobtém o snapshot, compara digests com o audit, verifica autorização, integridade e bookmark, e repete a coleta antes da escrita. Regera os mesmos bytes, confere seu hash e lê novamente o arquivo preparado para igualdade byte a byte. Qualquer diferença exige **novo audit, novo relatório e nova autorização**, inclusive quando o dispatcher substitui o relatório anterior pelo `fresh-audit`. Não existe fallback para aplicação sem guards ou para outra migration.

## Concorrência e prova do executor

Leituras repetidas sozinhas não bloqueiam a janela entre leitura e escrita. Os guards do arquivo isolado verificam contagem e cada linha bruta do inventário, ledger e metadados dentro da mesma migration. Divergência aciona erro SQL real (`integer overflow`), antes do DDL. Não é apenas um SELECT que retorna false. Nenhuma tabela auxiliar, UPDATE de organização, flag, bloqueio permanente ou migration adicional é introduzida.

O código oficial fixado do Wrangler 4.140.0 sustenta o caminho:

- [`buildMigrationQuery`](https://github.com/cloudflare/workers-sdk/blob/wrangler@4.140.0/packages/wrangler/src/d1/migrations/helpers.ts) lê o arquivo inteiro e acrescenta o INSERT de ledger.
- [`apply.ts`](https://github.com/cloudflare/workers-sdk/blob/wrangler@4.140.0/packages/wrangler/src/d1/migrations/apply.ts) chama `executeSql` uma vez por migration com `command`, sem arquivo de importação.
- [`execute.ts`](https://github.com/cloudflare/workers-sdk/blob/wrangler@4.140.0/packages/wrangler/src/d1/execute.ts) envia esse comando completo ao endpoint `query`; não divide os guards em commits separados.
- A [documentação oficial de migrations apply](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply) estabelece rollback da migration que falha. O [contrato de batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) descreve a transação e rollback dos statements.

O teste `production-migration-identity-wrangler.contract.mjs` executa o pacote real 4.140.0 contra uma API de loopback sintética, verifica o payload completo e modela rollback em SQLite inclusive quando o erro ocorre no INSERT de ledger, após o DDL. Os testes da CLI do operador também exercitam audit/apply/postvalidate, alteração após a última leitura, perda de resposta e falha estrutural pós-apply. São provas offline do transporte e da lógica; não são aceite do serviço D1 remoto. A garantia remota depende do contrato oficial acima. Mudança de versão exige nova revisão e validação.

Limites: a consulta evita funções SQL com mais de 32 argumentos. Recusa snapshot acima do orçamento conservador de 1,8 MB, statement de guard acima de 90 KB ou arquivo guardado acima de 8 MB. Não trunca nem divide a transação para contornar limites. O [D1 documenta](https://developers.cloudflare.com/d1/platform/limits/) 2 MB por valor/linha, 100 KB por statement, 32 argumentos por função e 30 segundos para a query/batch. Timeout, limite ou resposta incerta exigem interrupção e verificação somente leitura; sem retry automático da escrita. Inventários que excedam o orçamento exigem outro desenho revisado.

## Sequência de publicação

1. **PREPARE / LOCAL VALIDATE:** revisar esta PR operacional, os hashes e testes. Sua integração em `mano_kepler_v1` precisa de autorização de merge separada. Não integrar #270 antes do schema.
2. Antes do merge, verificar a configuração real de publicação automática da branch produto no Cloudflare Pages. A configuração não foi consultada nem alterada nesta tarefa. O repositório não comprova o estado atual dessa opção; os previews automáticos de PR são evidência distinta. Não presumir que merge é inofensivo.
3. Após integrar a preparação, autorizar e executar **AUDIT READ-ONLY** pelo workflow `production-d1-migration-operator.yml`, disparado em `main`, modo `audit`, filename exato de 0043. O workflow fixa o SHA atual de `mano_kepler_v1`. Não passar token para ambiente de agente. Não foi executado audit remoto nesta tarefa.
4. Conferir 0042 e prerequisites no ledger. Migrations anteriores pendentes não são aplicadas em conjunto: investigar dependências e, quando necessário, auditar/autorizar cada uma separadamente. Qualquer mudança do SHA, pendências, dados ou schema invalida a aprovação anterior.
5. **REPORT AND STOP:** apresentar filename, Git SHA, hash fonte, hash executável, hash do request, versão do gerador (`0043-equality-guards-and-exact-source-v1`), inventário/digests, D1 `maono_maps` / `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`, risco, pendências anteriores, integridade, bookmark e relatório. Aguardar autorização humana específica do hash emitido e do arquivo guardado. CI/merge/preview não autorizam migration.
6. Somente depois dessa autorização, executar `apply` protegido com filename e approval hash exatos. Ele reaudita, rejeita drift e prepara diretório contendo **um único arquivo autorizado**. A transação inclui guards + fonte 0043 + registro no ledger. Nenhuma outra migration entra na fila isolada.
7. **POST-VALIDATE:** o apply já exige prova estrutural específica 0043 e preflight Unicode atualizado. O modo separado `postvalidate` repete a prova, ledger, pendências, integridade e bookmark. Conservar também o bookmark anterior à aplicação como ponto de recuperação. Não confundir o bookmark posterior com rollback anterior.
8. Atualizar/revalidar a PR #270 sobre a preparação. Reutilizar `functions/_lib/organization-name.js` como fonte única da regra Unicode (import/reexport no módulo funcional), reconciliar `schema.sql` e o pin da referência canônica. Reexecutar testes locais/CI da PR funcional no SHA final.
9. Fazer **nova pós-validação completa imediatamente antes do rollout funcional** e coordenar frontend/API. O código de #270 exige 0043 inclusive nas rotas de listagem; não publicar frontend novo contra API antiga. Merge, deploy, aceite e flags continuam decisões distintas.

Não é necessária sincronização do dispatcher em `main`: os modos genéricos já invocam os scripts e `npm run test:production-migration-gate` do SHA produto fixado. A comparação com `origin/main` mostrou apenas uma diferença no job de contratos de PR, sem necessidade para estes hooks. Esta preparação não modifica o workflow protegido, seus guards, inputs, ambiente, autoria, pinning, segredo ou concorrência. O workflow normal de contratos ganha cobertura offline; não executa D1 remoto.

## Janela do runtime antigo e recuperação

O runtime anterior pode continuar lendo e escrevendo após 0043, omitindo `canonical_name`. Essa compatibilidade **não garante unicidade Unicode nessa janela**: uma criação/renomeação antiga pode deixar nomes equivalentes com chaves nulas depois da transação. Os guards protegem o instante da migration, não todos os escritores futuros. A pós-validação detecta conflitos, mas não substitui bloqueio transacional para o rollout inteiro.

Se for necessária garantia sem essa janela, preparar uma pausa comprovável de **todos** os caminhos de criação/renomeação (UI/API legada/admin/importações/lifecycle e trabalhos já em andamento), com escopo, observabilidade, início/fim e recuperação, e obter autorização operacional separada. Esta PR não implementa nem executa pausa, mudança de flag ou configuração de produção. Sem pausa verificada, documentar a janela residual; qualquer conflito observado bloqueia a publicação funcional até decisão explícita de remediação. Não corrigir nomes, slugs ou pastas automaticamente.

Erro de guard reverte a migration e requer novo audit; não reaproveitar a autorização. Se apply iniciou e a resposta se perdeu, o estado é **incerto**: preservar relatório de falha e bookmark anterior, consultar ledger/schema/integridade somente leitura antes de considerar nova ação. Falha de pós-validação não significa que a migration não foi aplicada. Não repetir automaticamente, não remover índices/triggers e não desfazer dados por conta própria. Time Travel restaura o banco e pode perder escritas posteriores; recuperação precisa de análise e autorização separadas, nunca é acionada por este operador automaticamente.
