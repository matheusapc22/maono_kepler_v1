# PR 2 — Apply em blocos (stacked sobre #147)

## Atual e desejado
O Apply legado baixa a revisão-base e faz JSON.parse/clones no Worker; uma base de aproximadamente 90 MiB excede o orçamento de memória. O Review já entrega uma revisão-base direta ao navegador. O novo cliente monta a proposta nesse navegador usando o MESMO módulo puro de operações do Apply legado, serializa e calcula content hash por blocos. O endpoint de Apply recebe o stream e delega persistência ao `saveLargeProjectConfigStream`, preservando upload sessions, reconciliação Dropbox, reserva/READY/publicação e CAS de revisão.

## Contratos e arquitetura
- Mesma autorização de Editor e permissão de salvar/Apply. Viewer não pode publicar.
- Modelo de confiança do save normal: o Editor autorizado envia o MapConfig. O servidor valida transporte, tamanho, checksum, contexto e revisão; NÃO refaz a interpretação semântica integral do JSON grande. O cliente oficial usa o motor determinístico de operações, não o estado mutável do canvas. Hash de bytes comprova integridade, não que um cliente modificado executou o motor oficial. Essa fronteira deve ser avaliada explicitamente no release gate.
- A migration 0022 fixa por request o hash, tamanho e base da primeira tentativa; retry com outro conteúdo falha 409. Não se trata de outro pipeline de persistência de mapas, mas de vínculo do lifecycle ao artefato enviado.
- Checksum é recalculado pelo pipeline antes de reserva/publicação, e verificado no storage; hash declarado não é aceito como prova dos bytes recebidos.
- Cabeçalho de versão do lifecycle rejeita UI obsoleta antes da tentativa. CAS canônico mantém decisões concorrentes e status final.
- Cliente legado sem body continua para bases de até 12 MiB. Acima disso retorna 413 antes de baixar/parsear o arquivo, solicitando atualização do frontend.
- Transporte explícito tem limite de 100 MiB; teste de referência 90 MiB. Limites efetivos HTTP do provedor continuam gate remoto.

## Implementação e componentes
Serviço Review, pipeline existente large save (hash esperado opcional e suporte a payload pequeno apenas quando explicitamente solicitado pelo Apply), cliente review-api, helper de artefato no navegador, tabela imutável em 0022, testes de streaming e claims, workflows para branches stacked.

## Testes e riscos
Teste executa loop real do pipeline com I/O externo substituído: gera 90 MiB incrementalmente, proíbe json/text/arrayBuffer no request, verifica blocos <=4 MiB e publicação. SQLite testa claims idempotentes/imutáveis. Checksum divergente não reserva/publica. Suítes existentes cobrem Dropbox retries, revisão concorrente, lifecycle e operações. Build/typecheck e Foundation Gate obrigatórios.

Memória do navegador ainda depende do projeto e dos clones do motor existente; esta PR elimina a materialização grande no Worker, não promete memória constante no navegador. Falha após publicação e antes da transição final é reconciliada pelo checksum/revisão do pipeline existente. Não usar projeto real para testes.

## Conclusão e rollout
Desenvolvimento concluído apenas com CI/local verdes e diff revisto. Acceptance autenticado, 0021 e 0022 remotas, consumo real de CPU/memória no Worker, deploy integrado e health/QA permanecem PENDENTES. Nenhum merge, habilitação de mutações, migration remota ou declaração de release aprovado durante a fase stacked. Depois de liberar a #147, retarget/rebase desta PR na principal e repetir os gates para o SHA integrado.
