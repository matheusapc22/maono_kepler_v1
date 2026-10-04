# Map error notices and Requests shortcut

## Scope

- Remove only the fixed lower-right **Solicitações** link from `MaonoMapRuntime`.
- Replace the project-load error card with a scoped dark/gold Maõno notice and the explicit **Tentar carregar novamente** action.
- Share the same presentation with equivalent entry failures in `MapPanelAccessGate` and `MapManagementPage`.
- Keep normalization, load/retry state, cancellation, capability decisions, support-reference policy, destinations and handlers in their original callers. No API, auth, database, migration, feature-flag or Production changes.

## Reference and diagnosis

The provided mobile reference shows the map runtime, an **Erro ao carregar o projeto** notice with the organization-storage verification message, a blank-looking white action, and the fixed Requests shortcut below the map tools. It is not a Central de Chamados notice.

A compiled baseline Chromium reproduction confirmed that the old action rendered `color`, `background-color` and `-webkit-text-fill-color` all as `rgb(255, 255, 255)` (contrast 1:1). An unlayered generic form-control reset (`button, input, optgroup, select, textarea { color: inherit }`) wins over the layered `.text-red-950` utility, inheriting the overlay’s white text while the button stays white. It has no local ownership of action foreground/background, no scoped focus state and no alert name. The overlay also lived inside the canvas stacking context, which could leave it below the rail or open panel; it now uses a React portal at the application root. The new component explicitly owns both colors and text fill in the same rule, and its specificity outranks legacy fallback action selectors without changing global button behavior. The storage condition itself is represented by the existing normalized message; this UI change does not repair backend storage.

## Equivalent locations

1. `src/pages/Kepler/map-url-loader/index.tsx`: hydration/transport failure and original retry handler.
2. `src/pages/Kepler/map-panel/MapPanelProvider.tsx`: access denied, context failure, optional viewer/replacement destination and existing support-reference policy.
3. `src/pages/Kepler/map-panel/MapManagementPage.tsx`: failure while preparing a map destination and return to Projects.

Shared presentation: `src/pages/Kepler/components/map-notice/MapErrorNotice.tsx` and `map-error-notice.css`.

## Access consequence

The removed link was the only direct shortcut to the project inbox from the map. The inbox route `/projects/:projectSlug/requests` remains registered and retains its existing API/ACL. The review workspace retains its **Solicitações** return link. Central de Chamados > Alterações still exposes **Abrir revisão** for authorized linked items. No replacement shortcut was added.

## Verification

- Focused Node tests cover shared notice wiring, loading contracts, runtime routes, normalized errors, project-change requests and inbox authorization.
- Compiled browser tests are in `tests/browser/map-error-notice.spec.ts` and run through the existing three-engine Project Pages gate.
- Cases cover desktop and 360/320px mobile load failure, readable foreground/background contrast, unclipped visible action text, keyboard focus/Enter, one retry and recovery, access-denied viewer/replacement actions, support references on storage failures, short-screen scroll, manage failure and retained inbox route.
- All HTTP/account/storage fixtures are synthetic and local. Browser coverage is not Production acceptance.

Focused Node suite: **87/87 passed**. The old compiled app was reproduced separately with synthetic API responses and its white-on-white computed styles captured. Integrated typecheck and Vite build passed with the three existing map frontend flags enabled. The initial default-heap build exhausted this local runtime’s memory (exit 137); the same sources built successfully after temporary-cache cleanup and a 4608 MiB heap. Focused lint passed without warnings. The publisher’s integrated Node gate passed **2407/2407**.

Local compiled UI results:

- Chromium: **9/9 passed**.
- WebKit: **9/9 passed**.
- Firefox: **3/3 non-WebGL cases passed** (storage/reference/short-screen scroll, manage return and retained inbox). The six cases that recover a rendered map require the headed CI environment: the local headless runtime cannot create a WebGL context (`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`). Error-card text, contrast and interaction assertions completed before readiness failed. Default/software EGL probes confirmed the same environment limit; a temporary Xvfb could not open local sockets. No assertions were removed or relaxed. The original headed Firefox Project Pages CI gate must run all nine cases on the published commit before the feature is called fully validated.
- Desktop and mobile screenshots were visually inspected. The card and action remain above the rail/panels; Requests is absent. The normal button’s text/background contrast is asserted at least 4.5:1, with no text clipping and a 44px minimum target.

The two other locations updated beyond the reference screenshot are the access/context gate and the `/manage` error page. The visual redesign intentionally preserves the existing organization-storage diagnosis rather than changing backend health.
