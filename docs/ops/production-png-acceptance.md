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

1. Contas QA distintas com papéis `editor` e `super_admin`, permissões declaradas
   e organização exata `9 / maono-preview-qa` confirmadas antes das flags.
2. Um projeto novo `QA Durable <runId> small`, com três pontos sintéticos
   versionados em `scripts/acceptance/fixtures/preview-points.kepler.json`.
   Não há dataset externo nem arquivo do usuário. `project_slug` deve ficar vazio.
3. Criação JSON durável com inline desativado. A recuperação depende do Worker
   JSON já autorizado/configurado separadamente. A suite não o liga.
4. Chromium abre o editor publicado, carrega o projeto e clica em Salvar.
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
11. Fecha o navegador, confirma o escopo e executa cleanup; o operador restaura
    todas as flags gerenciadas e republica o mesmo SHA antes de declarar PASS.

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

Reutiliza a fronteira revisada da suite JSON: callback registrado antes da reserva,
inventário por organização, nome/runId, slug, criador, projeto e arquivo vinculado
conferidos antes de DELETE. Somente o projeto criado por este run é removido;
seu arquivo de organização é desativado e desvinculado, com leitura de confirmação.
Um ACK de reserva perdido, identidade divergente, projeto renomeado, recurso
ambíguo ou cleanup anterior pendente bloqueia sucesso. Nunca apagar um projeto
real para “limpar o teste”. Objetos imutáveis privados, recibos e tombstones ficam
retidos; não há purge, GC de storage ou mudança de permissões.

O navegador recebe 25 minutos dentro da suite de até 45 minutos. Pedidos seguem
o orçamento comum de fase; o fechamento do processo tem 10 segundos e é idempotente. O fechamento revoga
novas chamadas auxiliares e espera até 30 segundos pelas já iniciadas, dentro
de um limite externo de 45 segundos.
Se não puder confirmar que o navegador fechou, não executa DELETE da fixture e
marca cleanup como não comprovado; restauração de flags ainda é tentada.

Callbacks de observação e roteamento do navegador nunca propagam exceções fora
da Promise supervisionada da suite. JSON/URI/corpo não verificável, falha de
fallback ou abort geram somente um código e mensagem fixos; texto bruto de
parser, URL ou payload não entra no relatório. Falhas conhecidas durante o
fechamento são tratadas sem rejeição não supervisionada. Os testes de processo
Node isolado verificam que catch/finally continuam executando, e o teste do
operador verifica cleanup e restauração das cinco flags após a falha.

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
3. Autorizar explicitamente a janela e suas flags temporárias. Executar `run` com
   `RUN_PRODUCTION_ACCEPTANCE` e aprovar `production-acceptance` no GitHub.
4. Conferir todos os casos PASS, `cleanupComplete=true` e
   `configurationRestored=true`. Qualquer ausência mantém o aceite aberto.

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
