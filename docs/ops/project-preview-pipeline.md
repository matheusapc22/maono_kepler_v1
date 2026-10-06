# Prévia de projetos: operação, recuperação e ativação

## Escopo e vínculo com o salvamento

Este código substitui a fila antiga de thumbnail, o PUT antecipado em `waitUntil`, o arquivo sobrescrito `rN.png`, a conversão DataURL/base64 e o reconciliador de leitura que alterava registros. Não há dois geradores de projetos gerenciados. PNG continua privado no Dropbox, 960 × 540, até 4 MiB. Exportações nativas fora das rotas de projetos continuam disponíveis.

A operação de salvamento JSON e seu recibo são independentes da prévia. O frame começa a ser congelado no clique em Salvar, antes da serialização/hash/rede assíncrona. Sua captura exige o viewport exato, a identidade do editor, a geração salva e confirmação do renderizador que consumiu os mesmos dados. Alterações posteriores não alteram os pixels já congelados. Uma captura degradada nunca é publicada como READY.

O PNG é codificado uma vez e pode ser preservado em IndexedDB antes da confirmação JSON. Depois da confirmação, a promoção atômica associa os bytes ao recibo, sem parse/copiar novamente todo o GeoJSON. A confirmação JSON nunca aguarda encoding, persistência ou upload do PNG. Importação, aplicação de alterações e recuperação sem frame elegível permanecem em WAITING_CAPTURE, sem animar uma geração inexistente.

## Contrato de rede

- `POST /api/projects/:slug/thumbnail`: registra manifesto imutável; `201` não é aceitação durável dos pixels.
- `PUT /api/projects/:slug/thumbnail?operationId=...`: recebe o PNG limitado durante leitura. `200 READY` requer bytes verificados e publicação; `202` requer bytes imutáveis verificados mais journal e outbox confirmados em transação.
- `GET /api/projects/:slug/thumbnail/status?operationId=...`: recibo histórico exato e estado, sem mutação.
- `GET /api/projects/:slug/thumbnail/status`: apresentação compartilhada dos cards, incluindo `artifactId` e `jobState`.
- `GET /api/projects/:slug/thumbnail?v=N&artifactId=...`: imagem autorizada, validada e somente leitura.
- `PATCH /api/projects/:slug/thumbnail`: falha apenas da operação identificada ainda em WAITING_CAPTURE, pertencente ao ator. Uma falha tardia nunca rebaixa READY de outra execução.

Manifesto: organização, projeto, operação de salvamento, revisão publicada, checksum do JSON, sessão/geração do editor, versão de renderizador, operação de captura, SHA-256 e tamanho do PNG. O servidor consulta seu recibo PUBLISHED e o vínculo imutável da revisão de configuração; não aceita `latest` como substituto. Um editor atualmente autorizado pode recapturar um snapshot publicado por outro editor, sem se apropriar da operação daquele autor.

Estados: WAITING_CAPTURE, RECEIVING, PAYLOAD_STORED, PROCESSING, RETRY_WAIT, READY, FAILED_FINAL, SUPERSEDED. Captura e LOCAL_READY são estados locais. RECEIVING informa o vencimento da lease; um navegador pode retomar o mesmo PUT após o vencimento, sem depender de cron para recuperar upload incompleto.

## Durabilidade, concorrência e recuperação

Cada operação tem caminho privado próprio `.maono-preview-<organização>-<projeto>-<UUID>.png`. O adaptador usa create, nunca overwrite. Um conflito/resposta perdida consulta e verifica o mesmo objeto. Queda depois de Dropbox e antes do journal é recuperada por esse caminho conhecido.

PAYLOAD_STORED e outbox são atômicos em D1. Publicação usa revisão/checksum, identidade e geração da operação, epoch e dono da lease, estado/ponteiro anterior, lifecycle, configuração e pasta, além da geração de autorização e expiração de grants. O recibo, ponteiro e finalização da outbox são confirmados juntos. Operações/recibos terminais são imutáveis. Nenhum cleanup de upload apaga PNG de fallback ou de outra tentativa.

O agendador de salvamento pode recuperar ambos os domínios com flags independentes e `Promise.allSettled`; rejeições são registradas por domínio. Um domínio não bloqueia o outro. O worker de prévias também pode ser usado como entry point isolado, mas isso não é necessário para o caminho combinado. Ambos os processadores mantêm lotes limitados.

Rede, timeout, 408, 429 e 5xx consultam a mesma operação antes de qualquer reenvio. 401 pausa; 403 encerra; SUPERSEDED encerra como obsoleto. Retry-After é respeitado, com backoff e jitter. Há deadlines de 15 s para status/registro e 90 s para PUT, abrangendo também a leitura do corpo da resposta. Cancelamento sempre resolve a espera. O orçamento local é de 12 falhas e 24 h; o servidor tem oito tentativas por fase e 24 h. Esgotamento é inspecionável, sem criar automaticamente outra identidade.

## Política local proposta, ainda sujeita à ativação

- Apenas PNG e metadados mínimos, nunca GeoJSON, cookies ou credenciais.
- Máximo de 32 MiB somando staging e operações confirmadas, até 4 MiB por imagem.
- Retenção de até 24 h, expiração na próxima execução do aplicativo. Um navegador fechado não executa limpeza na hora exata.
- Promoção substitui a cópia staged na mesma transação, sem duplicar quota.
- Expiração401, troca de organização e cancelamento pausam sem apagar PNG já durável. Logout explícito ou troca de conta cancela trabalhos e limpa apenas as imagens do ator anterior.
- A limpeza incrementa uma geração de descarte no IndexedDB e apaga staging/operações na mesma transação. Escritas antigas de outras abas não podem reinserir os bytes. Nova sessão espera a limpeza terminar; falha de limpeza bloqueia novas gravações/recuperação nessa execução. A atualização local do banco para a versão2 preserva registros anteriores na geração zero. O marcador mínimo ator/geração não contém pixels e permanece após a expiração das imagens para bloquear escritores antigos; sua retenção integra a decisão humana de ativação.
- Sem quota/IndexedDB, o envio em memória é best effort e a UI informa que fechar a página perde essa proteção.
- A perda de um frame antes de capturar/preservar bytes requer renderizar novamente o snapshot correto. Um worker sem navegador/GPU não reconstrói os pixels desaparecidos.

Esses valores são defaults de código, não aprovação de retenção/ativação. Devem ser confirmados antes de habilitar o frontend.

## Cards, cache e legado

Todos, Recentes e Favoritos usam o mesmo componente e status compartilhado. A URL contém o artefato imutável; a troca visual só termina após decode. WAITING_CAPTURE é neutro e mantém descoberta de status de baixa frequência; não fica animando. Polling é compartilhado, limitado a quatro requisições simultâneas e suspenso em aba oculta, com parada em 401/403 e backoff em falhas transitórias. A troca de contexto limpa a memória de decode e as assinaturas.

As imagens usam `Cache-Control: private, no-cache`, ETag e autenticação revalidada antes de 200/304. Mesmo leituras históricas com artifactId revalidam identidade, pasta e arquivo após a leitura lenta. Revogação impede novas leituras; pixels já exibidos no dispositivo não podem ser retrospectivamente apagados do conhecimento de quem os viu. Não são criados links públicos Dropbox.

Leitores de schema anterior à 0040 continuam funcionando. PNG canônico legado é revisão zero, independente da revisão JSON. GET nunca converte UNKNOWN/MISSING/READY nem altera revisão. PNG legado também passa por validação estrutural, CRC, inflação e scanlines decodificadas com limites.

## Inventário e reparo dos três projetos

Os três projetos reportados na organização autorizada continuam sem causa individual comprovada nesta implementação local. Seus IDs devem ser confirmados em contexto privado antes da inspeção. Nenhum registro real foi consultado por endpoint que escreve e nenhum foi reparado.

`POST /api/admin/project-previews/reconcile` agora é inventário somente leitura, Super Admin, organização explícita e lote limitado. Ele verifica estado e storage e produz proposta; não realiza UPDATE, upload nem delete. Não usar uma URL de Preview para inspeção real sem verificar seus bindings, pois ela pode compartilhar produção.

Para cada ID autorizado: coletar revisão/config/estado/artefato/último erro; conferir existência, tamanho, identidade e conteúdo PNG; classificar ponteiro incorreto, ausência, corrupção ou acesso indisponível. Preparar uma proposta condicional por registro, preservando revisão zero, e pedir autorização específica de reparo antes de qualquer mutação. Não executar UPDATE amplo de MISSING para UNKNOWN.

## Ativação e rollback

1. Revisar os testes sintéticos e a PR combinada; merge não é executado por esta entrega.
2. Confirmar política local, volume/custo e retenção dos objetos. Artefatos/recibos de servidor ficam conservadoramente retidos; não existe GC automático habilitado. Definir coleta por referência e período de segurança em revisão própria antes de remover objetos.
3. Auditar a migration `0040_project_preview_operations.sql` pelo operador protegido, após a 0039. Obter SHA-256, Git SHA, identidade D1, digest das pendentes, integridade e bookmark. A aprovação da PR não autoriza aplicar a migration.
4. Após autorização exata do audit hash, aplicar somente a migration autorizada e pós-validar, conforme AGENTS.md.
5. Aprovar separadamente a janela de aceitação sintética, configuração de worker/agendamento e ativação permanente.
6. Flags de código default OFF: `VITE_PROJECT_PREVIEW_OPERATIONS_V1`, `PROJECT_PREVIEW_OPERATIONS_V1` (admissão) e `PROJECT_PREVIEW_PROCESSOR_ENABLED` (processamento). O controle já existente `VITE_ASYNC_PROJECT_THUMBNAIL` também pode impedir novas capturas. Não habilitar nada implicitamente pelo merge.
7. Para pausar novas capturas/admissão, manter o processador dos trabalhos já duravelmente aceitos quando apropriado. Rollback preserva schema, leitores, recibos e objetos. Não restaurar o uploader antigo por flag.

Não foi provisionado Worker/Queue, alterado cron/binding, aplicado migration ou executada aceitação/reparo em produção por esta mudança.

## Medição e cobertura

O cliente agrega até 32 métricas de duração/tamanho/tentativa e envia para o endpoint autenticado `/api/observability/project-preview`; o servidor mantém somente a allowlist numérica e registra logs estruturados. Não há pixels, câmera, nomes, URL do projeto ou dataset. Configuração de retenção/exportação dos logs permanece decisão operacional.

Medir separadamente readiness, composição, overlay, encoding, persistência local, upload, retry, decode, armazenamento, publicação e recuperação por cron. Fixtures sintéticas locais verificam pixels decodificados, uma única codificação, corrida de geração e armazenamento real IndexedDB. Emulação de mobile em servidor não representa celular físico. Não declarar p95 abaixo de 500 ms/1,5 s ou PNG em 5 s como SLO atingido sem hardware, baseline visualmente equivalente e condições documentadas.

Gates: `npm run test:project-preview`, `npm run test:project-cards`, `npm run test:project-preview-browser`, preservação Project Pages, testes completos, TypeScript e build. O workflow project-preview-validation executa regressões sintéticas nos três motores e emulações, sem serviços/dados reais.
