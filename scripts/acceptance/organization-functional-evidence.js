/* AU-AC01-A: paste this reviewed, pinned file in the existing human browser.
 * It sends ONLY fixed same-origin GETs. It never logs in, writes application
 * data, clicks controls, activates flags, copies cookies, or stores credentials.
 * UI actions remain manual. Exported measurements are NOT an attestation. */
(() => {
  'use strict';
  const VERSION = 1, MAX_RESPONSE = 256 * 1024, MAX_EXPORT = 2 * 1024 * 1024;
  const MAX_RUN_MS = 30 * 60_000, MAX_UI_MS = 120_000, MAX_SAMPLES = 1300;
  const strictPattern = pattern => ({ test: value => typeof value === 'string' && pattern.exec(value)?.[0] === value });
  const UUID = strictPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const EVENT = strictPattern(/^(?:frame|legacy):[1-9][0-9]{0,14}$/);
  const SHA = strictPattern(/^[0-9a-f]{40}$/);
  const BLOCKER_CODE = strictPattern(/^[A-Z][A-Z0-9_]{0,100}$/), SOURCE = strictPattern(/^[a-z][a-z0-9_]{0,79}$/);
  const CONTENT_LENGTH = strictPattern(/^\d+$/), controlledErrors = new WeakSet();
  const CASES = ['snapshot', 'save_success', 'save_error', 'edit_conflict', 'pause_success', 'pause_conflict', 'recovery_query', 'deletion_observed'];
  const RESULTS = new Set(['requested', 'authorized', 'denied', 'running', 'succeeded', 'failed', 'blocked', 'partial', 'unknown', 'noop', 'legacy_unproven']);
  const ACTIONS = new Set(['organization.create', 'organization.created', 'organization.update', 'organization.updated', 'organization.legacy_updated',
    'organization.policy_updated', 'organization.configured', 'organization.pause', 'organization.paused', 'organization.resume', 'organization.resumed',
    'organization.review', 'organization.request_approved', 'organization.request_rejected', 'organization.permanent_delete', 'organization.reconcile',
    'organization.deletion_requested', 'organization.storage_recovery', 'organization.storage_disable', 'organization.storage_observed', 'other']);
  const STORAGE = new Set(['UNKNOWN', 'READY', 'ACTIVE', 'CONFIGURED', 'DISABLED', 'PENDING', 'PREPARING', 'ERROR', 'FAILED', 'RECOVERING', 'DELETING']);
  const AUDIT_SOURCES = new Set(['audit_logs', 'organization_operation', 'organization_management_events', 'organization_lifecycle', 'organization_legacy_create',
    'organization_storage_observation', 'organization_deletion', 'organization_deletion_audit', 'organization_deletion_inspection', 'organization_deletion_worker',
    'organization_operation_inspection', 'organization_operation_consultation', 'organization_reconciliation', 'audit_recovery_request', 'other']);
  const base = '/api/admin/organization-management';
  const encoder = new TextEncoder(), fetchRead = globalThis.fetch.bind(globalThis);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const positive = value => integer(value) && value > 0;
  const bool = value => typeof value === 'boolean';
  const nullable = (value, test) => value === null || test(value);
  const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  function controlledError(code) { const error = Object.assign(new Error(code), { code }); controlledErrors.add(error); return error; }
  function requireValue(value, code = 'ORG_COLLECTOR_INVALID') { if (!value) throw controlledError(code); }
  function allowedOrigin() {
    const url = new URL(location.href);
    return !url.username && !url.password && (url.protocol === 'https:' && /^(?:[a-z0-9-]+\.)?maono-kepler-v1\.pages\.dev$/.test(url.hostname) ||
      url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  }
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  async function digest(value) {
    const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value)));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function iso(value) {
    requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'ORG_RESPONSE_TIME_INVALID');
    return new Date(value).toISOString();
  }
  let state = null, recorder = null, captureInFlight = false, requestCount = 0, invalidated = false;
  const controllers = new Set(), nodeIds = new WeakMap(); let nextNode = 0;
  const nodeId = node => node ? (nodeIds.has(node) ? nodeIds.get(node) : (nodeIds.set(node, ++nextNode), nextNode)) : null;
  function current() {
    requireValue(!invalidated, 'ORG_COLLECTOR_INVALIDATED');
    requireValue(state && allowedOrigin() && location.origin === state.origin && /^\/admin(?:\/|$)/.test(location.pathname), 'ORG_ORIGIN_OR_CONTEXT_CHANGED');
    requireValue(Date.now() - Date.parse(state.startedAt) <= MAX_RUN_MS, 'ORG_COLLECTOR_EXPIRED');
    return state;
  }
  function pathFor(kind, id) {
    const s = current();
    switch (kind) {
      case 'session': return '/api/session';
      case 'detail': return `${base}/organizations/${s.organizationId}`;
      case 'preview': return `${base}/organizations/${s.organizationId}/deletion-preview`;
      case 'audit-list': return `/api/admin/audit?organizationId=${s.organizationId}`;
      case 'audit-detail': requireValue(EVENT.test(id), 'ORG_EVENT_ID_INVALID'); return `/api/admin/audit/${encodeURIComponent(id)}`;
      case 'deletion': requireValue(UUID.test(id), 'ORG_OPERATION_ID_INVALID'); return `${base}/deletions/${id}`;
      default: throw controlledError('ORG_ROUTE_NOT_ALLOWED');
    }
  }
  async function get(kind, requests, id = null) {
    requireValue(++requestCount <= 96, 'ORG_REQUEST_BUDGET_EXCEEDED');
    const path = pathFor(kind, id), target = new URL(path, location.origin);
    requireValue(target.origin === location.origin, 'ORG_ROUTE_NOT_ALLOWED');
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchRead(target.href, {
        method: 'GET', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'X-Maono-UI-Route': '/admin', ...(kind.startsWith('audit-') ? { 'X-Maono-Audit': 'operations-v1' } : {}) },
      });
      requireValue(!response.redirected && (!response.url || new URL(response.url).origin === location.origin), 'ORG_REDIRECT_FORBIDDEN');
      if ([401, 403].includes(response.status)) throw controlledError('ORG_SESSION_CHANGED');
      requireValue([200, 404, 503].includes(response.status) && response.headers.get('content-type')?.includes('application/json'), 'ORG_HTTP_UNCONFIRMED');
      const advertised = response.headers.get('content-length');
      requireValue(advertised === null || CONTENT_LENGTH.test(advertised) && Number(advertised) <= MAX_RESPONSE, 'ORG_RESPONSE_TOO_LARGE');
      const reader = response.body?.getReader(); requireValue(reader, 'ORG_RESPONSE_BODY_MISSING');
      let length = 0; const chunks = [];
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength;
          if (length > MAX_RESPONSE) { await reader.cancel(); requireValue(false, 'ORG_RESPONSE_TOO_LARGE'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      requireValue(!controller.signal.aborted, 'ORG_REQUEST_TIMEOUT');
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let payload;
      try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { requireValue(false, 'ORG_RESPONSE_INVALID_JSON'); }
      requireValue(object(payload), 'ORG_RESPONSE_INVALID');
      requests.push({ route: kind, method: 'GET', status: response.status, at: new Date().toISOString(), bytes: length });
      return { status: response.status, payload };
    } catch (error) {
      if (controller.signal.aborted) throw controlledError('ORG_REQUEST_TIMEOUT');
      if (controlledErrors.has(error)) throw error;
      throw controlledError('ORG_READ_UNCONFIRMED');
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function entry(row) {
    requireValue(object(row) && EVENT.test(row.id) && row.organization?.id === state.organizationId && nullable(row.createdAt, value => typeof value === 'string' && Number.isFinite(Date.parse(value))) &&
      nullable(row.actor?.id, positive) && RESULTS.has(row.result) && typeof row.action === 'string' && bool(row.legacy), 'ORG_AUDIT_SCOPE_INVALID');
    return { id: row.id, createdAt: row.createdAt === null ? null : iso(row.createdAt), actorId: row.actor.id, organizationId: row.organization.id,
      action: ACTIONS.has(row.action) ? row.action : 'other', result: row.result, legacy: row.legacy };
  }
  async function captureInternal() {
    const s = current(); requireValue(!captureInFlight && s.captures.length < 12, 'ORG_CAPTURE_BUSY_OR_LIMIT'); captureInFlight = true;
    try {
      const requests = [], session = await get('session', requests);
      requireValue(session.status === 200 && session.payload.authenticated === true && session.payload.user?.role === 'super_admin' && positive(session.payload.user.id), 'ORG_HUMAN_ADMIN_REQUIRED');
      if (s.administratorUserId === null) s.administratorUserId = session.payload.user.id;
      requireValue(session.payload.user.id === s.administratorUserId, 'ORG_SESSION_CHANGED');
      const detailRead = await get('detail', requests), org = detailRead.payload.organization;
      let organization = null;
      if (detailRead.status === 200) {
        requireValue(detailRead.payload.ok === true && org?.id === s.organizationId && typeof org.name === 'string' && typeof org.slug === 'string' && typeof org.description === 'string' &&
          integer(org.version) && bool(org.active) && STORAGE.has(org.storageStatus) && [org.projectCount, org.fileCount, org.userCount].every(integer), 'ORG_DETAIL_INVALID');
        const syntheticMarkerMatches = org.name === `QA Auditoria ${s.runId}`;
        requireValue(s.mode !== 'functional' || syntheticMarkerMatches, 'ORG_SYNTHETIC_SCOPE_UNCONFIRMED');
        organization = { id: org.id, nameDigest: await digest([s.runId, 'name', org.name]), slugDigest: await digest([s.runId, 'slug', org.slug]),
          descriptionDigest: await digest([s.runId, 'description', org.description]), version: org.version, active: org.active, storageStatus: org.storageStatus,
          projectCount: org.projectCount, fileCount: org.fileCount, userCount: org.userCount, syntheticMarkerMatches };
      }
      const previewRead = await get('preview', requests);
      let preview = { status: previewRead.status, eligible: null, version: null, blockers: [], waitUntil: null };
      if (previewRead.status === 200) {
        const p = previewRead.payload;
        requireValue(p.ok === true && p.organizationId === s.organizationId && bool(p.eligible) && integer(p.version) && Array.isArray(p.blockers) && p.blockers.length <= 100, 'ORG_PREVIEW_INVALID');
        const blockers = p.blockers.map(row => {
          requireValue(BLOCKER_CODE.test(row.code) && integer(row.count) && (!row.action || ['pause', 'query', 'follow', 'review'].includes(row.action.kind) && bool(row.action.enabled)), 'ORG_PREVIEW_INVALID');
          return { code: row.code, count: row.count, action: row.action ? { kind: row.action.kind, enabled: row.action.enabled } : null };
        });
        preview = { status: 200, eligible: p.eligible, version: p.version, blockers, waitUntil: p.waitUntil == null ? null : iso(p.waitUntil) };
      }
      const auditRead = await get('audit-list', requests);
      let audit = { status: auditRead.status, truncated: false, entries: [], details: [] };
      if (auditRead.status === 200) {
        const data = auditRead.payload;
        requireValue(data.ok === true && data.capabilities?.operations === true && Array.isArray(data.entries) && data.entries.length <= 25 && nullable(data.nextBefore, value => typeof value === 'string'), 'ORG_AUDIT_CONTRACT_UNAVAILABLE');
        const entries = data.entries.map(entry); requireValue(new Set(entries.map(row => row.id)).size === entries.length, 'ORG_AUDIT_DUPLICATES');
        audit = { status: 200, truncated: data.nextBefore !== null, entries, details: [] };
        const owned = entries.filter(row => !row.legacy && row.actorId === s.administratorUserId);
        const recent = owned.filter(row => row.createdAt && Date.parse(row.createdAt) >= Date.parse(s.startedAt) - 1000);
        const actions = ['organization.update', 'organization.updated', 'organization.reconcile', 'organization.permanent_delete'];
        if (s.requestedCases.some(id => id.startsWith('pause_'))) actions.push('organization.pause', 'organization.paused');
        const candidates = [...recent.filter(row => actions.includes(row.action)),
          ...recent, ...owned].filter((row, index, values) => values.findIndex(value => value.id === row.id) === index).slice(0, 3);
        for (const candidate of candidates) {
          const response = await get('audit-detail', requests, candidate.id), body = response.payload;
          requireValue(response.status === 200 && body.ok === true && body.capabilities?.operations === true && body.entry?.id === candidate.id, 'ORG_AUDIT_DETAIL_UNCONFIRMED');
          const e = entry(body.entry), t = body.technical;
          requireValue(t && nullable(t.operationId, value => UUID.test(value)) && SOURCE.test(t.source) &&
            nullable(t.originalActor?.id, positive) && nullable(t.version, integer), 'ORG_AUDIT_DETAIL_INVALID');
          audit.details.push({ eventId: e.id, operationId: t.operationId, source: AUDIT_SOURCES.has(t.source) ? t.source : 'other', organizationId: e.organizationId, actorId: e.actorId,
            originalActorId: t.originalActor.id, result: e.result, action: e.action, version: t.version });
        }
      }
      let deletion = null;
      const deletionEntry = audit.details.find(row => row.operationId && row.action === 'organization.permanent_delete');
      if (deletionEntry) {
        const result = await get('deletion', requests, deletionEntry.operationId);
        if (result.status === 200) {
          const row = result.payload.deletion;
          requireValue(result.payload.ok === true && row?.id === deletionEntry.operationId && row.organizationId === s.organizationId &&
            ['pending', 'storage_deleted', 'completed'].includes(row.state) && nullable(row.errorCode, value => typeof value === 'string'), 'ORG_DELETION_SCOPE_INVALID');
          deletion = { id: row.id, organizationId: row.organizationId, state: row.state, hasError: row.errorCode !== null };
        }
      }
      const capture = { id: crypto.randomUUID(), capturedAt: new Date().toISOString(), administratorUserId: s.administratorUserId, requests,
        detail: { status: detailRead.status, organization }, preview, audit, deletion };
      s.captures.push(capture); s.capturedAt = capture.capturedAt; return capture;
    } finally { captureInFlight = false; }
  }
  function visible(node) {
    if (!node?.isConnected) return false;
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }
  function rectangle(node) {
    if (!visible(node)) return null;
    const r = node.getBoundingClientRect();
    return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(r[key] * 100) / 100]));
  }
  function dialog() { return [...document.querySelectorAll('dialog.admin-organizations-dialog[open],dialog.admin-audit-detail[open]')].filter(visible).at(-1) || null; }
  function dialogMatchesScope(d) {
    if (!d) return true; // Removal is an observed failure, not a substitute UI.
    const params = new URL(location.href).searchParams, name = `QA Auditoria ${state.runId}`;
    if (d.matches('.admin-organizations-dialog')) {
      return params.get('org_id') === String(state.organizationId) && d.querySelector('header h2')?.textContent?.trim() === name;
    }
    const eventId = params.get('audit_event');
    const known = state.captures.some(capture => capture.audit.entries.some(row => row.id === eventId));
    const label = [...d.querySelectorAll('.audit-detail-facts dt')].find(node => node.textContent?.trim() === 'Organização');
    return known && label?.nextElementSibling?.textContent?.trim() === name;
  }
  function domSnapshot(r) {
    const d = dialog();
    if (!dialogMatchesScope(d)) return null;
    const form = d?.querySelector('form.aog-form') || d?.querySelector('.audit-detail-content') || null;
    const body = d?.querySelector('.aog-dialog-body,.audit-detail-content');
    const overlay = d?.querySelector('.aog-dialog-loading-overlay,.audit-detail-busy');
    const ring = overlay?.querySelector('.mm-universal-loader__ring');
    const colors = ring && visible(ring) ? [...getComputedStyle(ring).backgroundImage.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)].slice(0, 12).map(match => match.slice(1, 4).map(Number)) : [];
    const rawDraft = form ? [...form.querySelectorAll('input:not([type=password]):not([type=file]):not([type=hidden]),textarea,select')].map((input, index) =>
      ({ index, type: input.type || input.tagName.toLowerCase(), value: input.value, checked: input.type === 'checkbox' || input.type === 'radio' ? input.checked : null })) : null;
    const toasts = [...document.querySelectorAll('.aog-deletion-toast,.aog-deletion-error-toast,.audit-command-success,.audit-command-error')].filter(visible).map(node => ({
      id: nodeId(node), kind: node.matches('.aog-deletion-error-toast,.audit-command-error') ? 'error' : 'success', rect: rectangle(node),
      hasCloseButton: Boolean(node.querySelector('button[aria-label="Fechar aviso de erro"]')),
      hasTechnicalReference: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|Referência\s*:/i.test(node.textContent || ''),
    }));
    const observedT = Math.round((performance.now() - r.monotonicStart) * 100) / 100;
    r.lastQueuedT = Math.max(observedT, (r.lastQueuedT ?? -0.01) + 0.01);
    return { sample: { t: r.lastQueuedT, surface: d ? d.matches('.admin-organizations-dialog') ? 'organization' : 'audit' : null, dialogId: nodeId(d), formId: nodeId(form),
      busy: body?.getAttribute('aria-busy') === 'true', overlay: visible(overlay), loaderColors: colors, rect: rectangle(d), draftDigest: null,
      scroll: body?.scrollTop || 0, viewport: { width: innerWidth, height: innerHeight }, documentVisible: document.visibilityState === 'visible',
      focusInDialog: Boolean(d?.contains(document.activeElement)), technicalReports: d ? [...d.querySelectorAll('.aog-operation-items,.aog-deletion-panel code')].filter(visible).length +
        [...d.querySelectorAll('p[role="status"]')].filter(node => visible(node) && node.textContent?.includes('A exclusão ainda está indisponível')).length : 0, toasts }, rawDraft };
  }
  function enqueueObservation(r, observation) {
    r.pendingCount++;
    // Snapshot DOM synchronously; digest the observed values asynchronously.
    // Raw values never leave this closure and are never persisted/exported.
    r.queue = r.queue.then(async () => {
      observation.sample.draftDigest = observation.rawDraft === null ? null : await digest([state.runId, 'draft', observation.rawDraft]);
      r.output.samples.push(observation.sample); r.pendingCount--;
    }).catch(() => { r.failed = true; r.pendingCount--; });
  }
  function recordSample(r) {
    if (recorder !== r || r.stopping) return;
    if (r.pendingCount + r.output.samples.length >= MAX_SAMPLES - 1) { void stopRecording('timeout'); return; }
    const observation = domSnapshot(r);
    if (!observation) { r.scopeLost = true; void stopRecording('session_changed'); return; }
    enqueueObservation(r, observation);
  }
  function atAnimationFrame(observe) {
    return new Promise(resolve => {
      const frame = requestAnimationFrame(() => { clearTimeout(deadline); observe(); resolve(true); });
      // A hidden or stalled rendering surface cannot provide a final frame.
      // Keep its actual timestamps and mark the run incomplete instead of
      // waiting indefinitely or inventing a visible sample.
      const deadline = setTimeout(() => { cancelAnimationFrame(frame); resolve(false); }, 500);
    });
  }
  function scheduleSample(r) {
    if (recorder !== r || r.stopping || r.initializing || r.frame !== null) return;
    r.frame = requestAnimationFrame(() => { r.frame = null; recordSample(r); });
  }
  async function stopRecording(reason) {
    const r = recorder; requireValue(r, 'ORG_RECORDING_NOT_STARTED');
    if (r.stopping) return r.finishing;
    r.stopping = true;
    if (r.frame !== null) cancelAnimationFrame(r.frame);
    r.observer.disconnect(); clearInterval(r.interval); clearTimeout(r.timer);
    document.removeEventListener('visibilitychange', r.sample); globalThis.removeEventListener('resize', r.sample);
    r.finishing = (async () => {
      const measured = r.scopeLost ? false : await atAnimationFrame(() => {
        const observation = domSnapshot(r);
        if (observation && r.pendingCount + r.output.samples.length < MAX_SAMPLES) enqueueObservation(r, observation);
        else if (!observation) r.scopeLost = true;
      });
      r.output.endedAt = new Date().toISOString();
      r.output.stopReason = r.scopeLost ? 'session_changed' : !measured && reason === 'finished' ? 'stopped' : reason;
      await r.queue;
      if (r.failed) r.output.stopReason = 'stopped';
      state.uiRuns.push(r.output); state.capturedAt = r.output.endedAt; recorder = null;
      if (r.scopeLost) { state = null; invalidated = true; }
      return r.output;
    })();
    return r.finishing;
  }
  function safe(fn) {
    return async (...args) => {
      try { requireValue(args.length === fn.length, 'ORG_ARGUMENTS_INVALID'); return await fn(...args); }
      catch (error) {
        if (controlledErrors.has(error) && /^ORG_(?:SESSION_CHANGED|HUMAN_ADMIN_REQUIRED|READ_UNCONFIRMED|HTTP_UNCONFIRMED|REQUEST_|RESPONSE_|REDIRECT_|ORIGIN_OR_CONTEXT_CHANGED|UI_SCOPE_CHANGED|FRAME_|AUDIT_|DETAIL_INVALID|PREVIEW_INVALID|DELETION_SCOPE_INVALID)/.test(error.code)) {
          if (recorder) await stopRecording(error?.code === 'ORG_SESSION_CHANGED' ? 'session_changed' : 'stopped');
          for (const controller of controllers) controller.abort();
          // A failed/foreign/truncated read must not leave an export that looks
          // complete, or private context available after access changes.
          state = null; invalidated = true;
        }
        if (controlledErrors.has(error)) throw controlledError(error.code);
        throw controlledError('ORG_COLLECTOR_UNCONFIRMED');
      }
    };
  }
  const api = {
    start: safe(async input => {
      requireValue(!invalidated && state === null && allowedOrigin() && /^\/admin(?:\/|$)/.test(location.pathname), 'ORG_COLLECTOR_START_FORBIDDEN');
      requireValue(exact(input, ['runId', 'organizationId', 'expectedCommit', 'expectedDeploymentId', 'mode', 'requestedCases']) && UUID.test(input.runId) &&
        positive(input.organizationId) && SHA.test(input.expectedCommit) && UUID.test(input.expectedDeploymentId) &&
        ['diagnostic', 'functional'].includes(input.mode) && Array.isArray(input.requestedCases) && input.requestedCases.length > 0 && input.requestedCases.length <= CASES.length &&
        input.requestedCases.every(id => CASES.includes(id)) && new Set(input.requestedCases).size === input.requestedCases.length, 'ORG_COLLECTOR_OPTIONS_INVALID');
      requireValue(input.mode !== 'diagnostic' || input.requestedCases.length === 1 && input.requestedCases[0] === 'snapshot', 'ORG_DIAGNOSTIC_MUTATION_CASE');
      requireValue(!input.requestedCases.some(id => ['edit_conflict','pause_success','pause_conflict'].includes(id)) || ['localhost','127.0.0.1'].includes(location.hostname), 'ORG_SANDBOX_ONLY');
      const at = new Date().toISOString();
      state = { schemaVersion: 1, kind: 'organization-functional-evidence', contractVersion: VERSION, origin: location.origin, mode: input.mode, runId: input.runId,
        organizationId: input.organizationId, administratorUserId: null, expectedCommit: input.expectedCommit, expectedDeploymentId: input.expectedDeploymentId,
        startedAt: at, capturedAt: at, requestedCases: [...input.requestedCases], captures: [], uiRuns: [] };
      const first = await captureInternal();
      return { runId: state.runId, captureId: first.id, mode: state.mode, organizationId: state.organizationId, requestsPerformed: requestCount };
    }),
    capture: safe(async () => { const value = await captureInternal(); return { captureId: value.id, capturedAt: value.capturedAt }; }),
    begin: safe(async caseId => {
      const s = current(); requireValue(!recorder && !captureInFlight && s.mode === 'functional' && ['save_success', 'save_error', 'edit_conflict', 'pause_success', 'pause_conflict', 'recovery_query'].includes(caseId) &&
        s.requestedCases.includes(caseId) && !s.uiRuns.some(row => row.caseId === caseId) && s.uiRuns.length < 4, 'ORG_RECORDING_CASE_INVALID');
      const before = await captureInternal(); requireValue(dialog(), 'ORG_FORM_NOT_OPEN'); requireValue(dialogMatchesScope(dialog()), 'ORG_UI_SCOPE_CHANGED');
      const startedAt = new Date().toISOString(), r = { output: { id: crypto.randomUUID(), caseId, sampling: 'animation_frame', startedAt, endedAt: null, beforeCaptureId: before.id,
        afterCaptureId: null, samples: [], stopReason: null }, monotonicStart: performance.now(), queue: Promise.resolve(), pendingCount: 0, stopping: false, failed: false, initializing: true, frame: null };
      recorder = r; r.sample = () => scheduleSample(r);
      r.observer = new MutationObserver(r.sample); r.observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
      r.interval = setInterval(r.sample, 100); r.timer = setTimeout(() => { void stopRecording('timeout'); }, MAX_UI_MS);
      document.addEventListener('visibilitychange', r.sample); globalThis.addEventListener('resize', r.sample);
      requireValue(await atAnimationFrame(() => recordSample(r)), 'ORG_FRAME_UNAVAILABLE'); r.initializing = false;
      await r.queue;
      return { recordingId: r.output.id, caseId, startedAt, note: 'Observe only; perform the approved UI action manually.' };
    }),
    finish: safe(async () => {
      current(); const result = await stopRecording('finished');
      try { const after = await captureInternal(); result.afterCaptureId = after.id; }
      catch (error) { result.stopReason = error?.code === 'ORG_SESSION_CHANGED' ? 'session_changed' : 'stopped'; throw error; }
      return { recordingId: result.id, samples: result.samples.length, afterCaptureId: result.afterCaptureId };
    }),
    stop: safe(async () => {
      for (const controller of controllers) controller.abort();
      if (recorder) await stopRecording('stopped');
      return { stopped: true, writesPerformedByCollector: false };
    }),
    export: safe(async () => {
      current(); requireValue(!recorder && !captureInFlight && state.captures.length, 'ORG_EXPORT_NOT_READY');
      state.capturedAt = new Date().toISOString();
      const exported = structuredClone(state); requireValue(encoder.encode(JSON.stringify(exported)).byteLength <= MAX_EXPORT, 'ORG_EXPORT_TOO_LARGE');
      return exported;
    }),
  };
  requireValue(!Object.hasOwn(globalThis, 'MaonoOrganizationEvidence'), 'ORG_COLLECTOR_ALREADY_INSTALLED');
  Object.defineProperty(globalThis, 'MaonoOrganizationEvidence', { value: Object.freeze(api), writable: false, configurable: false, enumerable: true });
})();
