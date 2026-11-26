# AU-AC01-B1 — ensaio local da janela de Organizações

Execute a matriz do operador a partir da raiz do repositório:

```sh
node --test tests/production-acceptance-operator*.test.mjs
```

O teste de integração cria os dois arquivos JSON temporários e invoca o mesmo
ponto de entrada do operador. O cenário contém relógio, manifesto, leitura do
inventário após limpeza e estado simulado dos executores antes da restauração.
A evidência é um arquivo separado, com campos permitidos e limite de 32 KiB.
O operador lê o original e emite seu SHA-256 em relatório separado. Os arquivos
são entradas locais. Uma origem ou autoria declarada aqui é parte da fixture.

A correlação exige execução, tentativa, SHA, origem sintética, binding,
organização, ator e caso. A matriz observa os estados de espera, verificação,
interrupção, limpeza e restauração. Os seis campos de UI exercitam o contrato;
o teste de CLI não abre um navegador. O adaptador em memória restaura Pages,
Worker de exclusão e Worker de recuperação, e o protocolo compara o readback
de cada um ao baseline. A falha parcial impede o fechamento e permite repetir
a restauração na mesma instância. O relatório conserva o caráter sintético.

O ensaio ainda usa um caso e adaptadores em memória. O diário abaixo retoma
as etapas sintéticas. Ainda falta estabelecer a procedência do canal
autenticado e vincular deploy, binding, autoria, HTTP,
UI e histórico a observações independentes. O adaptador remoto precisa usar
baseline por executor, configuração efetiva e confirmação pós-restauração.
O recorte operacional e tokens permanecem no ambiente protegido existente.
A suíte de readiness conserva seu contrato read-only.

### Retomada em outro processo

Em um sistema de arquivos POSIX local que suporte hard links e sincronização
de diretórios, use uma pasta privada nova, sem componentes substituíveis por
terceiros. As duas entradas devem ser idênticas byte a byte nas duas etapas:

```sh
journal=$(mktemp -d)
node scripts/acceptance/operator.mjs organization-window-synthetic scenario.json evidence.json "$journal" accept
node scripts/acceptance/operator.mjs organization-window-synthetic scenario.json evidence.json "$journal" finish
```

`accept` valida a evidência e grava um registro imutável antes de devolver
o estado `cleanup`. `finish` exige esse registro, simula a limpeza e a
restauração e só grava o fechamento após o readback de todos os executores.
Repetir uma etapa concluída devolve o registro, sem executar a etapa de novo.
Uma entrada diferente para a mesma execução, tentativa e caso é recusada.
Uma falha antes da publicação do registro não impede nova tentativa; arquivos
temporários abandonados não são válidos como registros. A publicação é
exclusiva, inclusive entre processos; processos concorrentes ainda podem
calcular a mesma transição em memória antes da publicação.

O diário não autentica autoria e não substitui um armazenamento protegido.
Contém hashes dos arquivos e o relatório sintético, não as entradas originais.
Conserve os dois arquivos e a pasta até verificar o resultado. Nunca use
credenciais, dados de produção ou adaptadores reais neste comando.

### Transporte de evidências pelo GitHub

A prova de transporte é separada do diário sintético. A partir de um plano
revisado, fixe o identificador da execução, o SHA, o caso e o identificador
do artefato esperado. O formato proposto para o produtor é
`organization-evidence-<run>-1-<caso>`, com um único
`organization-evidence.json` contendo `run`, `attempt`, `sha` e `caseId`.
A rotina abaixo recebe o ZIP original do GitHub, não uma cópia recompactada.
O produtor protegido **ainda não publica esse formato**; não dispare uma
janela em produção para testar o verificador.

```sh
python3 scripts/acceptance/verify-organization-artifact.py \
  --run "$RUN_ID" --artifact "$ARTIFACT_ID" --sha "$PRODUCT_SHA" \
  --case "$CASE_ID" --archive "$ORIGINAL_ZIP"
python3 -m unittest discover -s tests -p test_organization_artifact_provenance.py
```

Configure `MAONO_EVIDENCE_GITHUB_TOKEN` como segredo de ambiente, só com
Actions: read no repositório. Não passe o token na linha de comando. O
verificador consulta apenas metadados do GitHub por GET, sem seguir
redirecionamentos. Exige a primeira tentativa bem-sucedida do workflow
esperado, no repositório e na branch de produto esperados. Compara o hash do
ZIP com o digest do provedor, o nome do artefato com o caso esperado e a
identidade do JSON com o run/SHA/caso. Não extrai arquivos no disco e não
imprime o JSON original. Um resultado aprovado prova o transporte e o
vínculo, não comprova interação do usuário, autoria da sessão, efeito no D1
ou aceite funcional. Os testes usam metadados e ZIPs de teste.

### Verificação em duas leituras

Na restauração sintética, a primeira leitura precisa obter deployment e
configuração dos três executores, separadamente. Se qualquer leitura estiver
ausente ou inválida, nenhuma escrita é simulada. Depois de restaurar, cada
executor é lido de novo. Uma leitura ausente fica marcada como não verificada
e impede o encerramento, mesmo quando os dois outros coincidem com o baseline.
Uma nova tentativa relê os três e não repete a restauração de um executor que
já voltou ao baseline. Isso não valida operações Cloudflare; ainda é preciso
vincular os três alvos, configurações e acessos de um ambiente de teste
autorizado.

### Ensaio de ponta a ponta do transporte

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_organization_artifact_provenance.py
```

O teste invoca o produtor por CLI, empacota a saída original e passa o ZIP
pelo verificador com metadados de GitHub simulados. O produtor só emite
identidade da execução e caso sintético fixo. Não recebe payload de sessão,
HTTP, DOM ou D1. A validação exige que o digest do arquivo observado seja o
mesmo do produtor e conserva o aceite funcional como falso.

O job de contratos da PR publica o JSON como
`synthetic-organization-transport-<run>-<attempt>` na primeira tentativa.
Esse artefato usa o SHA do checkout sintético e fica separado da convenção
protegida de produção. O verificador de produção continua exigindo o mesmo
workflow, a branch de produto e o nome protegido. O E2E offline não demonstra
a publicação do ZIP protegido. A publicação pelo job sintético, o vínculo
do ZIP verificado, a autoria da sessão e o efeito real de negócio são
evidências distintas.

### Requisitos mínimos do ensaio Cloudflare

O adaptador de teste atual usa um transporte injetado, exercitado em memória.
Antes de conectar Cloudflare, registrar uma conta de teste separada e
autorizar o trio exato de alvos: um projeto Pages e dois Workers descartáveis
(exclusão e recuperação), com nomes no padrão `maono-ac01-test-*`.
Para cada alvo, registrar os identificadores de dois deploys/versões terminais
com configuração equivalente, o fingerprint da configuração efetiva e as
permissões do operador. Confirmar isolamento dos domínios públicos, do D1
`maono_maps` e de bindings, recursos e rotas de produção. As credenciais
devem permanecer num ambiente GitHub protegido de teste, com escopo suficiente
para leitura e reversão dos três alvos. Executar com exclusividade comprovada,
ou usar uma operação do provedor que recuse mudanças concorrentes de estado.

O primeiro ensaio exercita apenas reversão de deployment com configuração
equivalente. Para Pages, confirmar a elegibilidade do deployment anterior
para rollback do projeto de teste. Para Workers, comprovar a distribuição
efetiva de tráfego e a versão alvo de cada Worker, além da compatibilidade
de recursos e bindings. Ler cada estado antes e depois. Divergência, leitura
ausente ou deploy não terminal bloqueiam a conclusão. O ensaio exige
autorização específica para alternar os deployments nos três alvos e não
inclui alteração de configuração. Restauração de configuração divergente
continua como capacidade separada.
