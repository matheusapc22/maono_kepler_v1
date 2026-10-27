# Solicitações - plano e limites de entrega

Base: `e47deac18888195b945a244dadb9e27c5902638f`, produto `mano_kepler_v1`.
Branch: `feat/admin-requests-navigation`. Entrega por PR draft; sem merge.

## Diagnóstico reproduzido

`renderRequests` de Admin exibia três valores literais `0`, sem leitura de chamados
ou revisões. A Central real é `TicketsSection` em Projects; o contrato de navegação
é `/projects?cc_org=<id>&cc_view=list`. Projects exige que o ID pertença à lista
da sessão antes de abrir o contexto. Revisões têm rota por projeto
`/projects/:slug/requests`; não há agregador global autorizado neste painel.

## Implementação

1. Substituir exclusivamente o conteúdo de Solicitações por `AdminRequests`.
2. Usar a organização ativa e sua associação na sessão, nunca o inventário global
   administrativo. Ausência, ID inválido ou organização inativa não geram atalho.
3. Oferecer o link de chamados apenas com contexto válido; o destino mantém ACL,
   filtros e operações. Não criar endpoint, polling, seleção de outra organização
   ou requisição adicional. Na perda de sessão detectada pelo workspace, retirar
   os atalhos imediatamente.
4. Separar revisões de mapas e encaminhar à seleção autorizada de projetos.
   Não gerar links para mapas a partir do inventário global.
5. Registrar testes específicos, gates preservados e PDF inspecionado.

## Sequência das quatro entregas e merge futuro

Ordem de implementação e revisão recomendada: Solicitações, Auditoria, Sistema,
Painel. Cada branch parte diretamente da base de produto acima; não há dependência
de schema ou de commits de outra subaba. Painel deve ser revisado por último para
conferir as descrições dos destinos. Amanhã, resolver conscientemente os pequenos
conflitos de imports/renderizações do Admin e dos inversos de preservação; reexecutar
os gates sobre a integração. Não copiar snapshots inteiros nem descartar canários.

Auditoria avaliará projeção restrita do schema existente ou indisponibilidade
explícita. Sistema exibirá apenas o contrato limitado de `/api/health`. Painel
explicitará escopo, origem e dados indisponíveis/desatualizados. Nenhuma entrega
autoriza migration, flag, conta, credencial ou acceptance em Produção.

## Validação e reversão

Testar navegação por sessão, contexto ausente/inativo/inválido, perda de sessão,
sem contagens fabricadas, sem chamadas extras, Back/Forward, teclado e mobile.
Executar contratos de carregamento/preservação, TypeScript, build com as três flags
de mapa e ESLint de escopo; os browsers de Admin e regressão de Projects nos três
motores. Dependências/build/browser aguardam coordenação técnica de RAM.

Fixtures sintéticas não comprovam D1, Dropbox ou autorização real em Produção.
Sem nova migration, alteração de schema ou flag. Reversão: reverter o commit da
entrega; nenhum dado remoto é criado ou alterado.

## Evidência local de 27/10/2026

- Quatro contratos específicos aprovados.
- 47 testes aprovados: contratos específicos, `admin-progressive-loading`,
  `initial-loading-presentation` e `projects-fallback-scope`; zero falhas/ignorados.
- ESLint dos arquivos alterados aprovado; `git diff --check` aprovado.
- A primeira tentativa ampliada encontrou `esbuild` ausente. A junção de leitura
  para a instalação existente foi autorizada pela revisão automática; nenhum pacote
  ou lockfile foi instalado/alterado. O fallback histórico exigiu normalização local
  de CRLF para LF, sem mudança semântica, de hash esperado ou de assertion.
- Build e navegadores locais ainda aguardam coordenação por RAM. A PR executará os
  gates existentes em CI. Não confundir estes resultados com validação em Produção.

O lint global preexistente é tratado por outra frente e não foi reexecutado aqui.

## Ambiente dos testes de navegador

A suíte nova integra exclusivamente o gate compilado progressive-loading, nos
três motores, como as suítes administrativas existentes. O config de desenvolvimento
a exclui porque StrictMode remonta efeitos: a execução duplicada mostrou oito
leituras onde o contrato compilado exige quatro. Assertions, timeouts e cobertura
do gate compilado permanecem intactos. Não há relaxamento da contagem de requests.
