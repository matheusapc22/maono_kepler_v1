# Acceptance real de JSON + PNG: preparação operacional

## O que esta PR entrega

Suite registrada `durable-project-preview` para o operador protegido existente.
Esta PR só prepara código, contratos e CI sintético. Não executa janela real,
merge, deploy, migration, configuração de secrets ou ativação permanente.

A PR está empilhada sobre `refactor/durable-save-operations` (#225), inicialmente
no SHA `fff7e4c1efdf4f3665e829a79be8a22a69c622e9`. Mesclar esta PR na #225 antes
de mesclar #225 em `mano_kepler_v1`, após revisão e autorização separadas.
O bootstrap da janela limitada em `main` é #227 e não recebe código de produto.
O operador de implantação do Worker é uma PR independente; Pages não o cria.

## Evidência que a suite exige

1. Somente o QA `creator`, papel `editor` com permissão global `project.create`,
   autentica no runner. Humano `super_admin` distinto fornece export read-only do
   inventário anterior; sua sessão/credencial não entra no CI. Organização exata
   `9 / maono-preview-qa`, origem, SHA, suite e UUID confirmados antes das flags.
2. Um projeto novo `QA Durable <runId> small`, com três pontos sintéticos
   versionados em `scripts/acceptance/fixtures/preview-points.kepler.json`.
   Não há dataset externo nem arquivo do usuário. `project_slug` deve ficar vazio.
   A fixture usa o basemap oficial `dark-matter` (CARTO/MapLibre), já presente
   no catálogo do produto. A captura real cobre esse basemap, não os estilos
   Mapbox nem todos os provedores. Permanecem inalteradas as coordenadas, a camada
   e as asserções de geometria, pixels, bytes e checksums.
3. Criação JSON durável com inline desativado. A recuperação depende do Worker
   JSON já autorizado/configurado separadamente. A suite não o liga.
4. GET `/api/projects/{slug}/map-navigation` confirma o projeto próprio,
   organização 9, `allowed:true`, modo `editor`, `viewMap:true` e `saveMap:true`.
   Isso não exige permissões globais artificiais de mapa. Chromium abre o editor
   publicado, carrega o projeto e clica em Salvar.
   Não injeta store/reducer/canvas, não substitui respostas do aplicativo e não
   fabrica PNG. O guard apenas bloqueia mutações fora do projeto sintético ou prazo.
5. Confere os bytes JSON observados no navegador contra manifesto e recibo
   PUBLISHED, incluindo projeto, organização, revisão, tamanho e content hash.
6. Confere manifesto/recibo READY da prévia contra o recibo JSON, sessão e geração
   do editor, versão de renderizador, checksum e tamanho dos bytes PNG enviados.
   Exige método fiel `canvas-composite` ou `html2canvas`; uma imagem técnica
   degradada nunca conta como captura fiel, mesmo se tiver pixels coloridos.
7. Faz GET autenticado da imagem por artefato imutável, com limite de 4 MiB;
   exige SHA-256 idêntico, decode real 960 × 540, pixels não vazios e a cor da
   camada sintética. Confere artifactId, revisão, ETag e cache privado.
8. Reabre o editor por navegação completa, lê o PNG persistido e salva novamente;
   exige revisão 3 e uma sessão de editor nova. Não depende de cache de memória.
9. Recusa registro de revisão antiga; replay histórico retorna o mesmo recibo e
   imagem sem substituir o ponteiro atual. Duas substituições da mesma revisão
   são registradas em ordem; o upload atrasado da anterior deve ser SUPERSEDED
   e somente a mais nova pode publicar.
10. Um upload de bytes sintéticos inválidos deve terminar FAILED_FINAL, sem
    recibo PNG. O JSON confirmado e o PNG READY anterior devem permanecer válidos.
11. Fecha o navegador e as requisições pendentes, publica o journal dos IDs e
    mantém `DS-CLEANUP=PENDING_MANUAL`; o operador restaura todas as flags e
    republica o mesmo SHA. A limpeza administrativa será humana e separada.

Casos: `PNG-CAPTURE`, `PNG-REFRESH`, `PNG-ORDER`, `PNG-FAILURE`, `DS-CLEANUP`.
Relatório guarda somente métricas/identificadores/checksums sintéticos e resultados.
Sem screenshots, trace, vídeo, cookies, URLs de storage, payload JSON ou pixels
nos artifacts reais. Não cria link público ou compartilha PNG com outro serviço.

## Pré-requisitos e flags

Aplicar e pós-validar 0039 e 0040 pelos processos de autorização específicos.
Auditar bindings Pages/Worker, identidade do D1 e storage, implantação e
recuperação JSON. Isso não acontece nesta suite nem na CI comum.

A suite requer, sem alterá-los, valores `plain_text` exatamente `true` nas
configurações Pages e no deployment canônico para:

- `VITE_MAONO_MAP_SHELL_V1`
- `VITE_MAONO_LAYER_MANAGER_V1`
- `VITE_MAONO_MAP_OVERLAY_V1`
- `VITE_ASYNC_PROJECT_THUMBNAIL`

Flags gerenciadas, todas explicitamente exibidas no manifesto:

| Flag | Antes | Janela | Fechamento |
| --- | --- | --- | --- |
| PROJECT_DURABLE_SAVE_V1 | false | true | false |
| PROJECT_DURABLE_SAVE_INLINE_ENABLED | true | false | true |
| PROJECT_PREVIEW_OPERATIONS_V1 | false | true | false |
| PROJECT_PREVIEW_PROCESSOR_ENABLED | false | true | false |
| VITE_PROJECT_PREVIEW_OPERATIONS_V1 | false | true | false |

**As flags Pages são globais ao deployment, não limitadas à organização QA.**
O código da suite só escreve na sua fixture, mas usuários reais presentes durante
a janela podem enxergar a funcionalidade temporariamente habilitada. A decisão
humana da janela deve reconhecer esse impacto e coordenar o tráfego; esta suite
não cria isolamento de rollout por organização nem afirma bloquear outros usuários.

Nenhuma flag de Worker é modificada. A suite recusa quota ativa ou configuração
não verificável, pois a limpeza de reservas de quota não tem API pública segura.
A aprovação da janela deve incluir captura temporária e a política de spool local
já documentada em `project-preview-pipeline.md`; ela não autoriza retenção/rollout
permanente. Flags já ativas fora do baseline exigem decisão separada, nunca um
reset silencioso pela suite.

## Cleanup, falhas e tempo

Reutiliza a fronteira revisada da suite JSON: callback e journal antes da reserva,
com UUID vindo do export `before`, nome/slug, criador e IDs conhecidos. Nenhuma
credencial administrativa ou API de cleanup entra no runner. A evidência anterior
é exigida no secret QA existente, com estrutura exata
`{creator:{email,password},manualInventory:<before export>}` e idade máxima de
15 minutos antes da ativação, conferida novamente imediatamente antes da primeira
alteração de flag, após a fila ficar quiescente. A revalidação pós-ativação tem
teto de 75 minutos desde a captura, acomodando a ativação limitada a 60 minutos.
O export inclui `workflowRunId` como string e `workflowRunAttempt:1`; o operador
exige os mesmos `GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT=1` e os registra no relatório.

Mesmo com quatro casos PNG PASS e flags restauradas, o run termina exit 1,
`operationalTestsPassed:true`, `cleanupComplete:false`, `complete:false` e
`MANUAL_CLEANUP_REQUIRED`. Não repetir a ativação para ficar verde. Após revisar
os IDs exatos com `MaonoAcceptanceEvidence.inspect(report)`, obter aprovação
específica para a exclusão irreversível do projeto e PATCH reversível do arquivo.
A UI Admin atual não dispõe desses controles; a ação humana usa somente as APIs
existentes e sua sessão administrativa. O helper é estritamente read-only e
same-origin, sem acesso a cookies/storage.

A inspeção e o certificado só admitem todos os casos funcionais PASS,
`operationalTestsPassed:true`, `acceptanceStatus:PENDING_MANUAL_CLEANUP`, somente
`MANUAL_CLEANUP_REQUIRED` e nenhuma falha de budget/restauração. Run falho,
cancelado ou interrompido conserva IDs/journals para reconciliação humana
separada, somente leitura; não recebe certificado por este helper. ACK recebido,
navegador fechado, flags restauradas ou inventário vazio não comprovam que o
Worker terminou operações aceitas. Não excluir recursos antes de comprovar
terminalidade remota e aprovar separadamente os IDs exatos. Não editar o relatório
para torná-lo elegível; este procedimento não adiciona reparo D1 ou novo operador.

Um ACK de reserva perdido, identidade divergente, projeto renomeado, recurso
ambíguo ou cleanup anterior pendente bloqueia fechamento. Nunca apagar um projeto
real para “limpar o teste”. Objetos privados imutáveis, recibos e tombstones ficam
retidos; não há purge, GC, Dropbox delete, varredura em lote ou mudança de ACL.
O export `after` e a CLI offline geram certificado separado do relatório original;
hashes não autenticam a origem humana da evidência. Ver
[o procedimento completo](../runbooks/production-acceptance-operator.md#inventário-e-cleanup-humanos-para-jsonpng).

O navegador recebe 25 minutos dentro da suite de até 45 minutos. Pedidos seguem
o orçamento comum de fase; o fechamento do processo tem 10 segundos e é idempotente. O fechamento revoga
novas chamadas auxiliares e espera até 30 segundos pelas já iniciadas, dentro
de um limite externo de 45 segundos.
Se não puder confirmar que o navegador fechou, bloqueia a entrega para limpeza
manual e marca fechamento como não comprovado; restauração de flags ainda é tentada.

Callbacks de observação e roteamento do navegador nunca propagam exceções fora
da Promise supervisionada da suite. JSON/URI/corpo não verificável, falha de
fallback ou abort geram somente um código e mensagem fixos; texto bruto de
parser, URL ou payload não entra no relatório. Falhas conhecidas durante o
fechamento são tratadas sem rejeição não supervisionada. Os testes de processo
Node isolado verificam que catch/finally continuam executando, e o teste do
operador verifica journal/limpeza pendente e restauração das cinco flags após a
falha, sem DELETE ou chamadas administrativas.

Negativas do guard incluem somente método em allowlist e categorias fixas do
destino/motivo, distinguindo telemetria Mapbox, sessão, projeto e prazo sem
registrar URL, query, token, corpo ou cabeçalhos. Nenhuma categoria libera uma
requisição antes bloqueada. O SDK Mapbox gera POST de inicialização com fontes
de tiles; a fixture `dark` anterior exercitava essa dependência não declarada.
O teste local de startup carrega os SDKs reais, confirma o seletor oficial do
Kepler e mantém esse POST bloqueado, com toda a rede interceptada localmente.
O relatório histórico sem essas categorias não permite atribuir com certeza
a requisição que causou a falha de uma execução anterior.

A evidência de cache exige tokens exatos `private`, `no-cache`, `Cookie` e
`Authorization`, e rejeita `public` conflitante ou nomes que apenas contêm esses
textos. Um cabeçalho parecido não constitui prova de cache privado.

O operador completo mantém 190 minutos internos, passo 192 e job 210. Cleanup,
restauração e relatório têm reservas próprias. O bootstrap #227 valida esse
contrato antes dos secrets. Cancelamento forçado/perda do runner pode impedir
`finally`: usar checkpoint/runId e `closure` com confirmação própria. Restaurar
flags não comprova remoção da fixture; reconciliar o inventário antes de nova janela.

## Passos humanos mínimos, quando os pré-requisitos estiverem prontos

1. Revisar/autorizar merges e a implantação do SHA final pelo processo normal.
   Configurar os secrets somente no Environment protegido, nunca em chat.
2. Executar `preflight` da suite exata, organização `9`, slug vazio e confirmação
   `PREPARE_PRODUCTION_ACCEPTANCE`. Conferir o relatório e o SHA publicado.
3. Autorizar a janela/flags e fazer dispatch de `run` com
   `RUN_PRODUCTION_ACCEPTANCE`. Aguardar validação concluída e o job protegido
   esperando aprovação do Environment; não aprovar ainda.
4. Copiar o `workflowRunId` da URL desse run Actions. Capturar
   `before({suite,expectedCommit,workflowRunId})` e salvar o bundle fresco no secret
   QA do Environment `production-acceptance`, sem fallback do repositório.
   Só depois aprovar. Não há build do app no job protegido; setup tem teto total
   de 11 minutos e a evidência deve continuar dentro dos 15 minutos iniciais.
5. Conferir todos os casos funcionais PASS, `operationalTestsPassed=true`, journal,
   `configurationRestored=true`, `PENDING_MANUAL_CLEANUP` e ausência de outras
   falhas. Só nesse estado inspecionar IDs, aprovar e efetuar a limpeza humana;
   coletar `after` e validar o certificado offline com o relatório imutável.
   Falha/cancelamento/interrupção exige a reconciliação read-only separada acima.

Vínculo ausente/expirado ou tentativa falha exige novo dispatch e novo
export/UUID após preservar/verificar o estado anterior e comprovar ausência de
mutações/recursos pendentes ou concluir reconciliação separada, mesmo se falhou no
preflight interno. Não usar Re-run jobs, reutilizar bundle/UUID ou atualizar um
secret para corrigir job já aprovado/em execução. O vínculo de run/primeira
tentativa e a regra humana não equivalem a registro server-side de uso único.
Ver [a sequência e as fontes GitHub](../runbooks/production-acceptance-operator.md#antes-da-janela).

O teste JSON `durable-project-save` continua separado e cobre payload grande,
idempotência, perda modelada de ACK e Worker/outbox; o PNG não o substitui.

## Limites de cobertura: não confundir CI com produção

A workflow `Acceptance PNG local validation` só roda em PR. Ela compila o frontend
com flags locais e exercita as mesmas asserções com React/Kepler, Chromium e
bytes PNG reais, mas contas/serviço/storage HTTP sintéticos. Não usa secrets,
Environment de produção, dispatch ou writes remotos. Os testes SQLite existentes
verificam as transações e rejeições do backend. Isso prova o código do acceptance,
não a disponibilidade do D1/Dropbox/contas reais. A spec de acceptance só entra
no gate compilado `playwright.production-acceptance.config.ts`, porta 4187; ela é
excluída explicitamente do gate Vite dev padrão, cujos testes existentes permanecem.

A futura execução protegida cobre o Chromium headless em ANGLE/SwiftShader.
Ela não comprova hardware físico, Safari/Firefox reais, SLO de latência, queda
real de rede/provider, alteração de ACL real ou recuperação independente de PNG
pelo cron. Não transformar essas ausências em PASS.

Checklist complementar quando autorizado: renderizar a fixture em hardware e
navegadores alvo; conferir fidelidade da camada e cards; medir latência com
baseline documentado; testar reconexão/ACL/cron na conta QA em uma janela própria
com escopo, cleanup e configuração de Worker previamente revisados. Nenhum
projeto ou conta de usuário real é necessário.
