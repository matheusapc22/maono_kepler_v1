# Evolução das seis subabas do Admin

Versão 1, 27/10/2026. Base de produto: `e47deac18888195b945a244dadb9e27c5902638f`.
Decisão vigente: uma PR em rascunho e um PDF por subaba; nenhum merge automático.
Esta entrega implementa somente **Usuários e Permissões**.

## Contrato comum

Aplicar a menor mudança que resolva uma necessidade demonstrada. Manter dark/dourado,
sidebar 240/72 px, raiz 16 px, densidade vigente, navegação `/admin?section=...`,
Back/Forward e layout móvel sem overflow global. Não usar zoom/scale nem botão
Atualizar global. O contrato visual está em [admin-workspace-redesign.md](admin-workspace-redesign.md).

Cada região distingue carregamento, vazio confirmado, erro, acesso negado e dado
indisponível. Não converter ausência de fonte em zero, evento ou sucesso. Preservar
dados válidos em falha transitória; limpar dados privados ao perder autorização.
Rascunhos, foco, teclado e cancelar fazem parte do aceite local. Não gravar dados
privados em logs, localStorage ou cache público.

Migrations pendentes não serão aplicadas nem reordenadas. Priorizar schema atual;
uma necessidade futura de schema precisa vir isolada, testada localmente e documentada.
Nenhuma flag, conta, credencial ou permissão real será alterada por esses testes.

## Ordem e entregas

| Ordem | Subaba | Necessidade verificada e recorte funcional | Critério de conclusão |
| --- | --- | --- | --- |
| 1 | Usuários e Permissões | Proteger último responsável em vínculos concorrentes e caminhos equivalentes; serializar ações da interface e rejeitar respostas de identidade/contexto antigos; manter cadastro, dados, senha, organizações, funcionalidades e delegação existentes. | SQLite real com corridas PUT/DELETE, exclusão/desativação e rotas alternativas; rejeição sem efeitos parciais; cliques repetidos, rascunho/foco, sessão, retenção e ACL preservados. |
| 2 | Projetos e Mapas | Expor os metadados que a API já retorna: organização, lifecycle, metadataVersion, autoria e datas. Oferecer filtros úteis por organização/estado e contexto de abertura/gestão, sem criar um segundo editor de mapas. | Contratos de metadados e lifecycle preservados; estados indisponíveis explícitos; filtros acessíveis, isolamento de organização, Back/Forward, ações existentes e temas testados. |
| 3 | Solicitações | Substituir os três zeros literais por filas reais e claramente identificadas. Primeiro inventariar solicitações de limites e pedidos de alteração de mapa, seus endpoints e ACL; confirmar quais têm decisão administrativa já suportada. | Uma fila mínima consultável com origem, estado, data e destino autorizado. Se não existir consulta agregada, implementar endpoint paginado e filtrado de leitura no schema existente, com ACL e testes; decisões somente quando houver serviço transacional existente. Nunca inventar pedidos nem marcar pendências como resolvidas. |
| 4 | Auditoria | Remover os três textos estáticos apresentados como eventos. Inventariar `audit_logs` e trilhas especializadas; definir um conjunto seguro de campos, paginação por cursor e filtros por ação/organização/período. Não existe `/api/audit` na base. | Endpoint administrativo de leitura com limite, ordenação estável, ACL e redaction por lista permitida. Mostrar apenas eventos persistidos, distinguir ausência de fonte de lista vazia, sem expor payloads, senhas, tokens ou dados pessoais de terceiros. Não prometer auditoria universal ou exportação irrestrita. |
| 5 | Sistema | Transformar descrição de tecnologias em informação operacional verificável. `/api/health` hoje verifica presença de binding/credenciais e `SELECT 1`; isso não prova Dropbox, readiness ou migrations. | Exibir alcance e horário de cada verificação. Reutilizar diagnósticos autorizados existentes; verificações adicionais devem ser somente leitura, limitadas e sem segredos. Apresentar “não verificado” para Dropbox/readiness/ledger quando não houver evidência. Não adicionar controles de deploy, migration ou flags. |
| 6 | Painel | Consolidar métricas e atalhos depois que suas fontes estiverem confiáveis. Reavaliar nomes, escopos e atualização das contagens atuais; incorporar só resumos comprovados das outras subabas. | Contagens com semântica documentada, carregamento independente, erros regionais e atalhos coerentes. Nenhum KPI ou alerta sintetizado sem fonte. Preservar atualização após mutação e evitar polling/global refresh não solicitado. |

## Dependências e coordenação

- Organizações pertence à PR #254 (`feat/admin-organizations-management`), fora deste escopo.
  Ela não estava integrada na base desta tarefa. Não copiar sua migration, PDF ou evidências.
- Usuários compartilha `functions/_lib/organizations.js` com Organizações. Ao integrar
  futuramente, revisar os trechos de alteração de usuário/vínculo, preservar ambos os
  contratos e repetir concorrência, senha, ACL e compatibilidade antes de declarar pronto.
- O gate global de lint tem dívida preexistente acompanhada na tarefa de Organizações.
  Não duplicar limpeza ampla, relaxar regras ou declarar esta PR pronta por checks antigos.
- Projetos antecede Solicitações para estabilizar contexto/lifecycle e destinos dos pedidos.
  Auditoria depende das ações reais conhecidas; Painel depende de todas as fontes.
- Não bloquear entregas independentes por migração futura: separar funcionalidades
  indisponíveis e explicar limites. Autorizações de aplicação e de operação remota são distintas.

## Protocolo de entrega por PR

1. Confirmar base, `AGENTS.md`, escopo e dependências; reproduzir o problema com dados sintéticos.
2. Preparar a menor alteração, testes positivos/negativos e falhas concorrentes pertinentes.
3. Rodar os gates atuais relevantes sem remover cobertura: mutações, assignment, delegação,
   negações, retenção; `admin-progressive-loading`, `initial-loading-presentation`,
   `projects-fallback-scope`, TypeScript, build, lint de escopo e gate global informado separadamente.
4. Rodar `admin-workspace`, `admin-progressive-loading` e `projects-theme-regression`
   nos três motores aplicáveis, além das novas provas da subaba. HTTP local interceptado,
   bloqueio de origens externas, um worker; coordenar instalações/builds pela memória limitada.
5. Produzir PDF versionado com finalidade, perfis/caminhos, operação, salvaguardas,
   implementado versus pendente, limitações, schema/flags, reversão, testes e SHA/PR.
   Renderizar todas as páginas e inspecionar visualmente.
6. Push e PR draft para `mano_kepler_v1`; acompanhar CI do SHA exato até estado terminal
   ou registrar bloqueio específico. Nenhum merge, auto-merge ou aceite em Produção.

## Reversão

Enquanto draft, manter a branch isolada e corrigir por novos commits. Após eventual
integração humana, reverter a PR de cada subaba de forma independente e repetir os
gates. Não desfazer migrations ou dados por automatismo. A reversão da proteção de
Usuários reabre o risco de último owner; restringir as operações afetadas até a correção.
