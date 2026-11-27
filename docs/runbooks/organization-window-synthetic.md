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

O ensaio protegido transporta dois casos sintéticos e exercita o mesmo CLI.
A autoria no Admin, o HTTP real, os efeitos de negócio e o histórico pertencem à janela B2.

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

O campo `clock` do cenário fixa a abertura. O campo opcional `ingestAt`
fixa a ingestão e conserva a compatibilidade com cenários antigos. No caminho
POSIX, um quinto argumento após o subcomando permite informar o instante
simulado do processo, em milissegundos Unix. O operador recusa ingestão
expirada e registra o instante aceito. Na retomada, a limpeza de evidência já
aceita pode terminar após o vencimento. O teste de regressão executa cada fase
em um processo separado.

### Transporte de evidências pelo GitHub

O contrato v2 distingue o SHA do workflow, conferido no run e no artefato
do GitHub, do SHA do produto, fixado independentemente antes da publicação
e confrontado com o JSON. O verificador de produção exige a referência
`main` do workflow, produto em `mano_kepler_v1`, primeira tentativa concluída
com sucesso e o nome `organization-evidence-<run>-1-<caso>`. O argumento
`--workflow-sha` fixa a revisão auditada do workflow e `--sha` a revisão do
produto. O produtor de casos administrativos de produção continua fora do
escopo do ensaio. O recibo declara apenas a procedência do transporte.

O perfil de teste exige a branch `au-ac01-b1-capacidade`, a execução manual,
a primeira tentativa, o job protegido `b1-evidence-producer` concluído com
sucesso e o nome próprio `b1-test-case-<run>-1-<caso>`. O consumidor pode
verificar esse job durante a mesma execução. O resultado global exige também
que o consumidor termine com sucesso.

Em **Actions → Production Acceptance Operator → Run workflow**, selecione
`au-ac01-b1-capacidade`, modo `preflight`, suíte `organization-b1-evidence-test`
e organização `sandbox`. Informe na confirmação `B1-evidence-` seguido do HEAD
completo revisado da PR. Deixe os campos opcionais vazios. A revisão humana
do Environment `maono-b1-ensaios` libera apenas o produtor de arquivos
sintéticos. Esses jobs não recebem token Cloudflare nem credenciais do Admin.
O produtor compila o checkout do produto fixado, executa edição e pausa pelo navegador
em loopback, com sessão sintética, handlers do produto e SQLite descartável. Cada ZIP
v3 contém um sucesso e um conflito medidos, com respostas HTTP, amostras da tela,
estado relido e evento da operação. O consumidor exige `--sandbox --observed` e verifica
o ZIP original, versão, observações e troca de caso. O recibo traz o digest dos cenários;
o diário preserva esse vínculo nas fases de ingestão e encerramento. O formato v2 do
#133 continua verificável com `--sandbox`. A execução protegida atual exige v3.
O resultado comprova exclusivamente as observações no ambiente de teste.

Para reproduzir em um checkout local, a partir da raiz, com Node 22 ou 24 e npm:

```sh
set -eu
npm install --legacy-peer-deps --no-audit --no-fund
VITE_ADMIN_AUDIT_OPERATIONS_V1=true VITE_ORGANIZATION_MANAGEMENT_V1=true \
  VITE_MAONO_MAP_SHELL_V1=true VITE_MAONO_LAYER_MANAGER_V1=true VITE_MAONO_MAP_OVERLAY_V1=true npm run build
node scripts/install-ci-browsers.mjs chromium
npx --no-install playwright test --config=playwright.organization-observed.config.ts --reporter=list
```


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

A matriz offline usa as duas observações permitidas e metadados de teste,
confere o SHA do produto e do workflow e chama o CLI da janela. O CI da PR
também conserva seu artefato histórico `synthetic-organization-transport-<run>-<attempt>`.
A prova publicada do canal protegido deve identificar o run e seus dois
artefatos, além do recibo e do estado final de cada caso.

### Requisitos mínimos do ensaio Cloudflare

O adaptador de teste aceita um transporte injetado. Os testes de contrato o exercitam em memória.
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

### Executor da conta Maõno — Ensaios

A PR 306 acrescenta a suíte manual `organization-b1-cloudflare-test` ao
workflow já registrado `production-acceptance-operator.yml`. A suíte usa o
GitHub Environment `maono-b1-ensaios`, restrito à branch
`au-ac01-b1-capacidade`, e exige revisão humana. O passo Cloudflare recebe
somente o secret de ambiente `MAONO_B1_CF_TOKEN`. Configure o token com
Pages Write e Workers Scripts Write apenas na conta
`1988481e4c75c760516161104b7e1e50` e Zone Read para as zonas dessa conta.
Se houver uma zona, o inventário de rotas também precisa de Workers Routes
Read nessa zona. O operador recusa rotas associadas aos Workers do ensaio,
domínios personalizados, cron, bindings e tráfego dividido.

Em Actions, abra **Production Acceptance Operator**, selecione **Run workflow**
e escolha **au-ac01-b1-capacidade**. Use a suíte acima e `sandbox` em
`organization_id`. Para cada dispatch, copie o HEAD completo da PR e forme
a confirmação com `B1-`, o modo e outro hífen antes do SHA. O job confronta
o SHA com a PR aberta depois da aprovação do Environment.

1. Escolha `preflight`, deixe `b1_baseline` vazio e revise o artefato
   `b1-cloudflare-RUN-TENTATIVA`. Leia os seis IDs e os três fingerprints.
   O digest reúne esses valores, a conta e o SHA. Confira que as URLs
   públicas servem A e que todos os estados iniciais foram verificados.
2. Para `run`, informe em `b1_baseline` o digest do preflight aprovado.
   Antes de aprovar, o responsável reserva a janela de escrita exclusiva
   nos três alvos (incluindo painel, outros tokens e automações). O grupo de
   concorrência serializa as execuções desse workflow. A API de reversão de
   Pages não fornece uma troca condicional atômica. Sem a reserva externa,
   encerre no preflight. O executor muda apenas os três IDs fixados, observa
   as três respostas B e restaura A. Confira a fase `final` e os três estados.
3. Se um ensaio desta revisão falhar ou for cancelado após iniciar a etapa
   Cloudflare, verifique que as operações pendentes terminaram e reserve de
   novo os três alvos. Na **execução original** do GitHub, escolha **Re-run
   jobs → Re-run all jobs**. O GitHub mantém o SHA e a referência daquela
   execução. A revisão humana do Environment continua obrigatória.
   A repetição verifica a primeira tentativa, as tentativas intermediárias,
   o job, a execução e o SHA. Ela usa somente o modo de recuperação com o
   digest original, inclusive se a PR tiver avançado ou sido encerrada.
   Uma tentativa anterior bem-sucedida bloqueia esse caminho. As três leituras
   finais da API e dos endpoints públicos são obrigatórias. Um novo dispatch
   de `closure` continua disponível sobre o mesmo HEAD aberto e aprovado.
   Para execuções de código anterior, inclusive #131, vale o procedimento
   da revisão original. O GitHub limita reexecuções a 30 dias. Fora desse
   prazo, registrar o estado e preparar uma recuperação específica revisada.

A prova externa só vale com o run protegido e seu relatório. Um teste offline
ou o CI de contratos prova o caminho simulado. Autoria de uma sessão Admin,
efeito de negócio e B2/T16/G16 seguem seus gates próprios.
