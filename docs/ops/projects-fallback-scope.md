# AD-VIS-01 - Projects fallback isolation

## Historical scope of AD-VIS-01

Exclude `.mm-projects-page` from every presentation selector in
`src/fallback-ui-styles.ts`. Keep login excluded, preserve global neutral resets,
legacy declarations, media queries and the idempotent stylesheet injection.

AD-VIS-01 introduced a selector list inside the **existing** `:not()`:
`#root > main:not(.maono-login-page, .mm-projects-page)`.
The maximum argument specificity remains one class. Do not chain an extra
`:not(.mm-projects-page)`, which would increase specificity on legacy screens.
Do not couple this boundary to `window.location`, delete the fallback globally,
or compensate with new `!important` declarations inside each sub-tab.

## Extensão atual: workspace Admin

O redesenho de `/admin` estende a mesma fronteira de propriedade visual. O
seletor atual em todas as 57 ocorrências de apresentação é:

```css
#root > main:not(.maono-login-page, .mm-projects-page, .maono-admin-workspace)
```

O Admin ativo e seu `AdminPageSkeleton` recebem `.maono-admin-workspace` de forma
incondicional. A classe adicional fica na lista do `:not()` existente, mantendo
a especificidade máxima de uma classe entre os argumentos. Recolher a sidebar
ou navegar entre seções não altera essa exclusão.

O Admin legado (`.maono-admin-page`, sem `.maono-admin-workspace`) **continua
recebendo o fallback**. A fixture de paridade legada permanece para provar esse
limite; não se exclui toda a família `.maono-admin-page` ou `.admin-page`.
Declarações, resets neutros, media queries e injeção idempotente preservam a
baseline histórica de AD-VIS-01. O CSS próprio do novo workspace permanece
restrito à sua raiz.

Contrato visual, recuperação contextual e verificação da aplicação real:
[Workspace Admin](admin-workspace-redesign.md). Esta extensão não substitui o
histórico nem os resultados anteriores de AD-VIS-01 por resultados do Admin.

## Evidence and tests

Original product snapshot: `42a97e96ef5b37cd496eefb52c57821545a298ca`.
Original fallback blob: `4775211773223c57399c16ababd6ab077c575c2d`.
The contract test freezes the original CSS literal with SHA-256. Only the selector
boundary is normalized before comparing it: unrelated legacy changes must not be
silently accepted by updating this baseline.

The unit suite tests all 57 presentation-selector occurrences, baseline integrity,
DOM-free evaluation, the stable style ID and duplicate-injection protection.
The original browser suite had 38 isolated cases: seven widths (320, 390, 768, 1024, 1280,
1440 and 1920 CSS px), light/dark preferences, legacy/admin/login shell fixtures,
focus/hover/disabled states, equal-specificity competition, shell identity changes,
forced colors, and reproduction of the old white/blue/centered controls.

A matriz atual acrescenta a exclusão do workspace Admin nessas larguras e
preferências de cor, forced colors e transições entre o shell legado e o novo.
A paridade de `.maono-admin-page` sem a nova classe continua sendo verificada.
Os resultados da execução atual devem ser registrados no SHA da entrega; os
números históricos acima não representam aprovação desta extensão.

**These are synthetic DOM/CSS tests, not a React application or a production
acceptance.** The fixture stylesheet is intentionally small. Passing it does not
prove the real sub-tab layout, routes, authentication, permissions, D1, Dropbox or
production deployment. Native checkbox/radio/range/file sizing is compared against
the fixture's existing behavior rather than universally restyled.

From a complete checkout with its existing dependencies installed:

```sh
node --test tests/projects-fallback-scope.test.mjs
npx playwright test tests/browser/projects-theme-regression.spec.ts --project=chromium
npm run build
```

The dedicated `Projects Fallback Scope` workflow needs no dependencies or secrets.
The existing `Product Reliability UX Gate` continues to build and run
`test:reliability-browser`, which discovers the new browser spec. Existing gates
are not removed or bypassed. Test helpers use no remote endpoints or credentials.

## Remaining gates before merge / next increment

Inspect the actual Projects sub-tabs and sidebar (open/collapsed), legacy screens,
real SPA navigation and the built CSS/chunk order. Record the exact Preview SHA
and distinguish Preview from Production. Keep the PR in draft until compatible
CI and visual-regression evidence is available. No deployment or acceptance may
be inferred from this document or from a successful unit suite.

The historical Preview folder/upload issue H-07 remains open. No new migration,
D1 write, storage write, feature flag or worker activation is part of this change.
The existing documents schema must not be reapplied by inference.

After AD-VIS-01, update the execution tracker and audit the result before deciding
whether the planned AD-VIS-02 document redesign remains the correct next step.
No redesign, functional expansion or bulk document operations are included here.

## Rollback

Revert the AD-VIS-01 code commit only after reviewing its dependents. This restores
the former selector reach (including the known visual defect) without changing
schema or stored data. A later rollback of AD-VIS-02 alone should preserve this
isolation. Rollback of code never undoes document/storage operations.
