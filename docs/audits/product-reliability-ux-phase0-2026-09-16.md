# Product Reliability & UX Hardening — Fase 0

Data da auditoria: 2026-09-16  
Branch de produto auditada: `mano_kepler_v1`  
HEAD congelado: `7ba854438b810272e0a444c34b7d6111c4540ad1`  
Branch de trabalho: `audit/product-reliability-ux-phase0`  
Baseline histórico de referência: auditoria de 12/09/2026, que registrava `e53f09415e75699bb86d60a63c721ecbb9f3009e`.

> Esta fase é deliberadamente uma auditoria e um gate. Ela não migra copy em massa, não reativa Change Requests e não altera o comportamento de produção.

## 1. Baseline reprodutível

A fotografia foi congelada antes de qualquer alteração funcional. O código de aplicação auditado continua exatamente no HEAD `7ba8544...`; os commits desta branch adicionam somente documentação, scanner, testes e CI de auditoria.

Ambiente de reprodução do CI:

- Node.js 22;
- `npm install --legacy-peer-deps --no-audit --no-fund`;
- testes do scanner com `node --test scripts/audit-user-error-sinks.test.mjs`;
- inventário com `node scripts/audit-user-error-sinks.mjs --json`;
- ratchet com `scripts/user-error-sink-baseline.json`;
- build oficial com `npm run build` (`tsc -b` + Vite).

O primeiro run reprodutível foi o GitHub Actions `35160036802`. O artifact desse run confirmou **2.883 ocorrências candidatas** no `src/`:

| Regra | Ocorrências | Uso |
| --- | ---: | --- |
| `raw-error-message` | 81 | ratchet high-signal |
| `raw-response-text` | 12 | ratchet high-signal |
| `diagnostic-id` | 210 | ratchet high-signal |
| `implementation-copy` | 2.580 | descoberta/revisão manual; não bloqueia CI isoladamente |
| **Total** | **2.883** | candidatos, não 2.883 vazamentos confirmados |

O baseline high-signal contém **303 ocorrências** distribuídas em 81 pares `arquivo::regra`. O ratchet permite redução da dívida e falha apenas se um sink high-signal aumentar ou surgir em novo arquivo/regra. A regra `implementation-copy` continua no relatório para descobrir textos com termos como API/backend/storage/Worker/JSON/schema/runtime/Kepler/dataset/layer, mas não é gate automático porque também encontra tipos, imports e código interno.

## 2. Critério de classificação

- **ATIVA_INSEGURA** — caminho alcançável e há propagação de diagnóstico/raw message para UI ou helper consumido pela UI.
- **PARCIALMENTE_NORMALIZADA** — existe mapping/copy de produto para casos conhecidos, mas fallback ainda pode vazar diagnóstico.
- **ALTERADA** — superfície histórica continua relevante, porém o caminho/implementação mudou e deve ser migrado pela arquitetura atual.
- **PAUSADA_RESIDUAL** — código permanece no repositório, mas não está montado no fluxo primário.
- **PAUSADA_ROUTE_REACHABLE** — feature não volta ao backlog ativo, porém a rota direta ainda existe; não é código órfão comprovado.
- **ADMIN_OPS** — diagnóstico restrito a Admin/Ops, ainda sujeito à regra de não exibir dump bruto por padrão.

## 3. Matriz E01–E24 revalidada no HEAD

| ID | Arquivo / rota atual | Reprodução / sink | Código ou categoria | Mensagem/diagnóstico que pode chegar à UI | Público | Sev. | Status | Ação desejada |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E01 | `DocumentsSection.tsx` · `/projects` > Documentos | provocar falha de listagem/upload | `code`, `stage`, `requestId` | formatter ainda anexa diagnóstico operacional | cliente | P1 | ATIVA_INSEGURA | normalizar por código e retirar IDs da copy |
| E02 | `OrganizationSection.tsx` · `/projects` > Organização | falha ao carregar/salvar organização | HTTP status + `code` | `HTTP … · CODE: error.message` | cliente | P1 | ATIVA_INSEGURA | erro de produto + detalhe só em telemetria |
| E03 | `LimitsPlansSection.tsx` · `/projects` > Limites/Planos | falha de leitura/solicitação | HTTP status + `code` | mesmo padrão técnico de E02 | cliente | P1 | ATIVA_INSEGURA | reaproveitar validação local segura e normalizar remoto |
| E04 | `maono-save-button.tsx` · `/map` salvar projeto | falha SAVE conhecida/desconhecida | SAVE/category/code/`correlationId` | categoria/código/identificador podem compor aviso | cliente | P0 | ATIVA_INSEGURA | mapear contrato SAVE para copy de produto |
| E05 | `maono-save-button.tsx` + create flow · `/map` criar projeto | falha CREATE | CREATE/code/`correlationId` | backend/diagnóstico pode aparecer no fluxo de criação | cliente | P0 | ATIVA_INSEGURA | separar mensagem pública de diagnóstico |
| E06 | `TicketErrorNotice.tsx` · `/projects` > Chamados | código conhecido vs desconhecido | catálogo parcial + `requestId` | código conhecido é traduzido; fallback/secondary detail usa mensagem da API | cliente/suporte | P1 | PARCIALMENTE_NORMALIZADA | preservar mapping e eliminar fallback bruto/ID visível |
| E07 | `RoadmapSection.tsx` · `/projects` > Roadmap | falha de carregamento/mutação | `requestId` | `error.message` + request ID | cliente | P1 | ATIVA_INSEGURA | normalizar por categoria e mover ID para observabilidade |
| E08 | `projects-api.ts` · `/projects` listagem | resposta não JSON ou erro API | `ProjectApiError` | raw body/message é convertido em Error | cliente | P0 | ATIVA_INSEGURA | migrar para erro tipado seguro; raiz compartilhada |
| E09 | `projects-api.ts` + `ProjectMetadataPanel.tsx` · `/projects` metadata | falha GET/PATCH metadata | `ProjectApiError` | mensagem/raw body chega ao painel | cliente | P1 | ATIVA_INSEGURA | normalizar transporte e consumidor |
| E10 | `auth/session.tsx` · `/login` | backend não JSON/erro de login | sessão/auth | `response.text()` ou backend message pode virar erro | cliente | P0 | ATIVA_INSEGURA | catálogo de autenticação + fallback neutro |
| E11 | `auth/session.tsx` · troca de organização | erro de switch/reload de sessão | sessão/organização | mesmo `readJsonResponse()` propaga texto remoto | cliente | P0 | ATIVA_INSEGURA | normalizar sem esconder ação recuperável |
| E12 | `UsersAccessOverviewSection.tsx` · `/projects` > Usuários/Acessos | falha governance | permissões | helper retorna `error.message` | cliente/admin org | P1 | ATIVA_INSEGURA | mapear erros de permissão/conflito |
| E13 | `OrganizationPermissionManager.tsx` | falha ao conceder/revogar | permissões | `error.message` do backend | admin org | P1 | ATIVA_INSEGURA | normalizar por código e manter contexto útil |
| E14 | `ProjectMapAccessManager.tsx` | falha de acesso ao mapa | permissões | `error.message` do backend | admin org | P1 | ATIVA_INSEGURA | mesmo contrato de E13 |
| E15 | `MapManagementPage.tsx` + `map-panel-api.ts` · `/map` | falha de operação do painel | Map Panel API | consumidor pode renderizar erro transportado/raw | cliente | P1 | ALTERADA / INSEGURA | consolidar no contrato central antes de polir copy |
| E16 | `MapPanelProvider.tsx` · `/map` gate | erro conhecido vs desconhecido | `BLOCKED_MESSAGES` | conhecidos são seguros; fallback usa `state.error?.message` | cliente | P1 | PARCIALMENTE_NORMALIZADA | reaproveitar `BLOCKED_MESSAGES` como padrão de mapping |
| E17 | `project-config-stream-client.ts` · `/map` carregar projeto | falha de descriptor/direct delivery/config | códigos de stream + IDs | Worker/body/bytes/JSON/códigos/IDs aparecem em erros técnicos | cliente | P0 | ATIVA_INSEGURA | mensagem pública estável + diagnóstico estruturado separado |
| E18 | `saved-config-hydrator.ts` · `/map` hidratação | config incompatível/erro runtime | hydration/schema | referências a schema/runtime/datasets podem compor erro | cliente | P0 | ATIVA_INSEGURA | categoria de recuperação de mapa sem internals |
| E19 | `map-visual-readiness.ts` · `/map` readiness | timeout de renderização | visual readiness | IDs de layer/dataset pendentes podem aparecer | cliente | P0 | ATIVA_INSEGURA | estado de produto + IDs somente em observabilidade |
| E20 | `PointFromPinWorkflow.tsx` | arquivo residual; não montado no `Kepler/index.tsx` principal | Change Requests | possui sinks próprios, mas fluxo principal está pausado | feature pausada | — | PAUSADA_RESIDUAL | retirar do backlog ativo; não remover sem prova de orfandade |
| E21 | `EditorRequestInboxPage.tsx` · `/projects/:projectSlug/requests` | acessar rota diretamente | Change Requests | rota ainda registrada | feature pausada | — | PAUSADA_ROUTE_REACHABLE | não desenvolver; registrar dívida de reachability separada |
| E22 | `ChangeRequestReviewPage.tsx` · `/projects/:projectSlug/review/:changeRequestId` | acessar rota diretamente | Change Requests | review ainda possui fallback de erro | feature pausada | — | PAUSADA_ROUTE_REACHABLE | não reativar; cleanup só em PR própria se comprovado órfão |
| E23 | `Admin.tsx` · `/admin` | falha no carregamento agregado | Admin/Ops | `error.message` pode aparecer em painel | super admin | P2 | ADMIN_OPS | preservar diagnóstico estruturado, sem dump bruto aberto |
| E24 | Admin atual + `AdminUserManagerLegacy.tsx` residual | falhas CRUD/admin | Admin/Ops | implementação histórica mudou; há handlers raw em código atual/legacy | super admin | P2 | ALTERADA / ADMIN_OPS | auditar componente ativo por ação; legacy não define contrato futuro |

### Resultado E01–E24

- E01–E19: nenhuma deve ser considerada “resolvida por histórico”; E06 e E16 são **parcialmente normalizadas** e fornecem padrões reutilizáveis.
- E20–E22: removidas do escopo ativo de Product Reliability & UX. A auditoria provou que E21/E22 ainda são alcançáveis por rota direta e, portanto, o conjunto não é órfão comprovado.
- E23–E24: permanecem rastreadas como Admin/Ops, com prioridade abaixo das superfícies públicas, sem aceitar dump bruto como UX final.

## 4. Superfícies E25+ encontradas no HEAD

| ID | Arquivo / rota | Reprodução / sink | Código/categoria | Público | Sev. | Status | Ação desejada |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E25 | `src/lib/api.ts` · helper compartilhado | API retorna erro JSON, texto puro ou download falha | `ApiError`, status/code/raw body | múltiplas telas | P0 | ATIVA_INSEGURA_COMPARTILHADA | alvo prioritário da próxima fase: erro tipado + `normalizeUserError()`; nenhum consumidor deve depender de raw body |
| E26 | `ExportsSection.tsx` · `/projects` > Exportações | list/create export falha | erro vindo de `src/lib/api.ts` | cliente autorizado | P1 | ATIVA_INSEGURA | herdar normalização central em vez de tratamento local ad hoc |
| E27 | `buffer-api.ts` · `/map` Buffer radial | erro conhecido vs fallback desconhecido | `BUFFER_*` | cliente | P1 | PARCIALMENTE_NORMALIZADA | preservar mappings atuais; fallback final não deve retornar `error.message` cru |
| E28 | `isochrone-api.ts` · `/map` Isócronas | timeout/429/erro desconhecido | `ISOCHRONE_*` | cliente | P1 | PARCIALMENTE_NORMALIZADA | preservar 401/403/429/timeout; eliminar fallback bruto |
| E29 | `load-data-modal/load-remote-map.tsx` · `/map` carregar mapa remoto | loader lança exceção | exceção genérica | cliente | P1 | ATIVA_INSEGURA | passar pelo contrato central antes de renderizar descrição |

Outros candidatos do scanner (cloud providers, engine adapter, thumbnail, observability e código de debug) permanecem **candidatos estáticos**, não recebem ID E nesta fase até que haja prova de reachability + sink visual. Isso evita transformar uma busca textual em falsa lista de defeitos de UX.

## 5. Normalizações e padrões seguros já existentes

A auditoria atual não parte do zero:

1. `functions/_lib/error-catalog.js` e `functions/_lib/maono-error.js` já formam o contrato técnico canônico do backend. A fase seguinte deve mapear esses códigos no frontend, não criar uma taxonomia concorrente.
2. `BLOCKED_MESSAGES` em `MapPanelProvider.tsx` demonstra mapping de código conhecido para copy de produto; o problema está no fallback desconhecido.
3. `TicketErrorNotice.tsx` já traduz códigos conhecidos; o secondary detail/raw fallback precisa ser removido da superfície pública.
4. `bufferErrorMessage()` e `isochroneErrorMessage()` já normalizam sessão, permissão, timeout, indisponibilidade e rate limit; devem ser endurecidos no fallback.
5. validações locais em formulários (por exemplo Limites/Planos e criação de projeto) geram mensagens de produto sem depender do texto do backend.
6. observabilidade de SAVE e map-load já transporta identificadores técnicos; isso permite retirar IDs da copy sem perder capacidade de diagnóstico.

## 6. Change Requests: disposition de Fase 0

Change Requests **não volta ao escopo ativo** deste programa.

- E20: código residual presente, sem montagem no entry point principal do Kepler verificado nesta auditoria.
- E21 e E22: `Routes.tsx` ainda registra as rotas diretas de inbox/review.
- Consequência: não há base para apagar o conjunto como “órfão”. Qualquer cleanup deve ser uma PR separada, posterior e explicitamente aprovada.
- Esta auditoria não habilita mutations, não aplica migrations 0021/0022/0023 e não altera feature flags.

## 7. Testes-baseline e ratchet

Foram adicionados:

- `scripts/audit-user-error-sinks.mjs` — scanner reproduzível;
- `scripts/audit-user-error-sinks.test.mjs` — testes das regras, incluindo fixtures que reproduzem `error.message`, `response.text()`, IDs operacionais e vocabulário técnico;
- `scripts/user-error-sink-baseline.json` — baseline high-signal do HEAD congelado;
- `.github/workflows/product-reliability-ux-phase0.yml` — executa testes, inventário, ratchet, build e publica artifact.

Princípio do ratchet: **dívida existente pode cair, nunca crescer silenciosamente**. A regra ampla de vocabulário técnico é review-only; os três sinais objetivos são o gate automático.

## 8. Gate da Fase 0

A Fase 0 pode ser considerada concluída somente quando todos os itens abaixo estiverem verdadeiros no mesmo HEAD da branch de auditoria:

- [x] HEAD da `mano_kepler_v1` congelado e registrado;
- [x] E01–E24 revalidadas no código atual;
- [x] E20–E22 retiradas do backlog ativo sem reativação/remoção indevida;
- [x] E25+ identificadas apenas quando há evidência suficiente;
- [x] padrões seguros existentes catalogados;
- [x] baseline high-signal versionado;
- [x] testes do scanner versionados;
- [ ] CI final com o **baseline já commitado** precisa passar ratchet + build;
- [ ] confirmar, no encerramento, que `mano_kepler_v1` ainda aponta para `7ba8544...`; se avançar, esta fotografia deve ser atualizada antes do merge.

Nenhuma PR massiva de copy/UX deve começar antes dos dois últimos itens. Após o gate, a próxima etapa correta é o contrato central de erro no frontend, começando pelo transporte compartilhado (`src/lib/api.ts`) e reutilizando o catálogo canônico do backend.
