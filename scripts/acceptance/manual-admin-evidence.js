/* Paste this reviewed file in the canonical application's browser console.
 * Read-only evidence, using the human administrator's existing session. No
 * cleanup actions are performed. Keep the original operator report unchanged.
 */
(function installMaonoAcceptanceEvidence() {
  "use strict";

  const ORIGIN = "https://maono-kepler-v1.pages.dev";
  const ORGANIZATION = Object.freeze({ id: 9, slug: "maono-preview-qa", active: true });
  const SUITES = ["durable-project-save", "durable-project-preview"];
  const FUNCTIONAL_CASES = {
    "durable-project-save": ["DS-SMALL", "DS-LARGE", "DS-IDEMPOTENT", "DS-LOST-ACK", "DS-HISTORICAL", "DS-STALE-CAS", "DS-OLD-CLIENT"],
    "durable-project-preview": ["PNG-CAPTURE", "PNG-REFRESH", "PNG-ORDER", "PNG-FAILURE"],
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const SHA = /^[0-9a-f]{40}$/i;
  const WORKFLOW_RUN = /^[1-9][0-9]{0,19}$/;
  const DIGEST = /^[0-9a-f]{64}$/;
  const EXPORT_LIMIT = 24 * 1024;
  const RESPONSE_LIMIT = 2 * 1024 * 1024;
  const INPUT_LIMIT = 1024 * 1024;
  const REQUEST_TIMEOUT_MS = 15_000;
  const encoder = new TextEncoder();

  function requireValue(condition, code) {
    if (!condition) {
      const error = new Error(code);
      error.code = code;
      throw error;
    }
  }
  function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function id(value) { return Number.isSafeInteger(value) && value > 0; }
  function text(value) { return typeof value === "string" && value.length > 0 && value.length <= 512; }
  function nullableId(value) { return value === null || id(value); }
  function exactKeys(value, keys, code) {
    requireValue(object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)), code);
  }
  function freeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  // JSON data only: no getters, toJSON hooks, sparse arrays or non-finite values.
  // Sorting is identical to the Node evidence validator; array order is retained.
  function canonical(value) {
    const seen = new Set();
    let nodes = 0;
    function visit(current, depth) {
      requireValue(++nodes <= 100_000 && depth <= 40, "QA_INPUT_TOO_LARGE");
      if (current === null || typeof current === "boolean") return JSON.stringify(current);
      if (typeof current === "number") {
        requireValue(Number.isFinite(current), "QA_INPUT_INVALID");
        return JSON.stringify(current);
      }
      if (typeof current === "string") {
        requireValue(current.length <= INPUT_LIMIT, "QA_INPUT_TOO_LARGE");
        return JSON.stringify(current);
      }
      requireValue(typeof current === "object" && !seen.has(current), "QA_INPUT_INVALID");
      requireValue(Object.getOwnPropertySymbols(current).length === 0, "QA_INPUT_INVALID");
      seen.add(current);
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const keys = Object.keys(descriptors);
      requireValue(keys.every((key) => Object.hasOwn(descriptors[key], "value")), "QA_INPUT_INVALID");
      let result;
      if (Array.isArray(current)) {
        requireValue(keys.length === current.length + 1 && current.length <= 10_000, "QA_INPUT_INVALID");
        result = `[${Array.from({ length: current.length }, (_, index) => {
          requireValue(Object.hasOwn(descriptors, index), "QA_INPUT_INVALID");
          return visit(descriptors[index].value, depth + 1);
        }).join(",")}]`;
      } else {
        requireValue(keys.every((key) => descriptors[key].enumerable), "QA_INPUT_INVALID");
        result = `{${keys.sort().map((key) => `${JSON.stringify(key)}:${visit(descriptors[key].value, depth + 1)}`).join(",")}}`;
      }
      seen.delete(current);
      requireValue(result.length <= INPUT_LIMIT, "QA_INPUT_TOO_LARGE");
      return result;
    }
    const result = visit(value, 0);
    requireValue(encoder.encode(result).byteLength <= INPUT_LIMIT, "QA_INPUT_TOO_LARGE");
    return result;
  }
  function snapshot(value) { return JSON.parse(canonical(value)); }
  async function digest(value) {
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(canonical(value)));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function evidence(value) {
    requireValue(encoder.encode(JSON.stringify(value)).byteLength <= EXPORT_LIMIT, "QA_EXPORT_TOO_LARGE");
    return freeze(value);
  }
  function origin() {
    requireValue(globalThis.location?.origin === ORIGIN, "QA_ORIGIN_MISMATCH");
  }

  // Private allowlist; public functions never take request URLs or options.
  async function get(path, expectedStatus = 200) {
    origin();
    requireValue([
      "/api/session", "/api/admin/organizations/9", "/api/admin/projects?organizationId=9",
      "/api/admin/organizations/9/files",
    ].includes(path) || /^\/api\/admin\/(projects|organization-files)\/[1-9][0-9]*$/.test(path), "QA_ROUTE_FORBIDDEN");
    const url = `${ORIGIN}${path}`;
    const controller = new AbortController();
    let reader;
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        const error = new Error("QA_REQUEST_TIMEOUT");
        error.code = "QA_REQUEST_TIMEOUT";
        reject(error);
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await globalThis.fetch(url, {
          method: "GET", credentials: "same-origin", redirect: "error", mode: "same-origin",
          cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal,
        });
        requireValue(!response.redirected && response.url === url, "QA_RESPONSE_ORIGIN_MISMATCH");
        requireValue(response.status === expectedStatus, "QA_HTTP_STATUS_UNEXPECTED");
        requireValue(/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || ""), "QA_RESPONSE_INVALID");
        const length = response.headers.get("content-length");
        requireValue(length === null || (/^[0-9]+$/.test(length) && Number(length) <= RESPONSE_LIMIT), "QA_RESPONSE_TOO_LARGE");
        requireValue(response.body && typeof response.body.getReader === "function", "QA_RESPONSE_INVALID");
        reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let body = "";
        let size = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          requireValue(size <= RESPONSE_LIMIT, "QA_RESPONSE_TOO_LARGE");
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
        let parsed;
        try { parsed = JSON.parse(body); } catch { requireValue(false, "QA_RESPONSE_INVALID"); }
        requireValue(object(parsed), "QA_RESPONSE_INVALID");
        if (expectedStatus === 200) requireValue(parsed.ok !== false, "QA_RESPONSE_INVALID");
        return parsed;
      })()]);
    } catch (error) {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      // Never echo server bodies, account metadata, URLs or transport messages.
      requireValue(false, /^QA_[A-Z_]+$/.test(error?.code || "") ? error.code : "QA_READ_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  }
  function organization(value) {
    requireValue(value?.id === 9 && value.slug === ORGANIZATION.slug && value.active === true, "QA_ORGANIZATION_MISMATCH");
  }
  async function authenticate() {
    origin();
    const session = await get("/api/session");
    requireValue(session.authenticated === true && session.user?.role === "super_admin" && id(session.user.id), "QA_SUPER_ADMIN_REQUIRED");
    requireValue(session.activeOrganization?.id === 9 && session.activeOrganization.slug === ORGANIZATION.slug, "QA_ORGANIZATION_MISMATCH");
    if (Object.hasOwn(session.activeOrganization, "active")) requireValue(session.activeOrganization.active === true, "QA_ORGANIZATION_MISMATCH");
    organization((await get("/api/admin/organizations/9")).organization);
    return session.user.id;
  }
  function syntheticProject(project) { return project.name.startsWith("QA Durable") || project.slug.startsWith("qa-durable-"); }
  function syntheticFile(file) { return file.name.startsWith("QA Durable") || Boolean(file.linkedProject?.slug?.startsWith("qa-durable-")); }
  function linkedId(file) {
    requireValue(Object.hasOwn(file, "linkedProject"), "QA_INVENTORY_INCOMPLETE");
    requireValue(file.linkedProject === null || (object(file.linkedProject) && id(file.linkedProject.id)), "QA_INVENTORY_INVALID");
    return file.linkedProject?.id ?? null;
  }
  function cleanFile(file) {
    return { id: file.id, name: file.name, organizationId: 9, active: file.active, isProject: file.isProject, linkedProjectId: linkedId(file) };
  }
  function cleanProject(project, files) {
    const links = files.filter((file) => linkedId(file) === project.id);
    requireValue(links.length <= 1, "QA_INVENTORY_INVALID");
    const organizationFileId = project.organizationFileId ?? links[0]?.id ?? null;
    requireValue(nullableId(organizationFileId) && id(project.createdBy?.id), "QA_INVENTORY_INVALID");
    return { id: project.id, name: project.name, slug: project.slug, organizationId: 9, createdById: project.createdBy.id, organizationFileId };
  }
  async function inventory() {
    const projects = await get("/api/admin/projects?organizationId=9");
    const files = await get("/api/admin/organizations/9/files");
    // These reviewed routes return complete, unpaginated arrays. Any new
    // envelope field (pagination/cursor/truncation/etc.) needs code review.
    requireValue(Object.keys(projects).every((key) => ["ok", "scope", "organizationId", "projects"].includes(key)) &&
      projects.scope === "organization" && projects.organizationId === 9, "QA_INVENTORY_INCOMPLETE");
    requireValue(Object.keys(files).every((key) => ["ok", "organization", "files", "dropboxEntries"].includes(key)), "QA_INVENTORY_INCOMPLETE");
    organization(files.organization);
    requireValue(Array.isArray(projects.projects) && Array.isArray(files.files) && projects.projects.length <= 5000 && files.files.length <= 5000, "QA_INVENTORY_INCOMPLETE");
    for (const [list, isFile] of [[projects.projects, false], [files.files, true]]) {
      const ids = new Set();
      for (const row of list) {
        requireValue(object(row) && id(row.id) && !ids.has(row.id) && row.organizationId === 9, "QA_INVENTORY_SCOPE_MISMATCH");
        ids.add(row.id);
        requireValue(text(row.name), "QA_INVENTORY_INVALID");
        if (isFile) {
          requireValue(typeof row.active === "boolean" && typeof row.isProject === "boolean", "QA_INVENTORY_INVALID");
          const linked = linkedId(row);
          if (linked !== null) {
            const project = projects.projects.find((candidate) => candidate.id === linked);
            requireValue(project && project.name === row.linkedProject.name && project.slug === row.linkedProject.slug, "QA_INVENTORY_DRIFT");
          }
        } else {
          requireValue(text(row.slug), "QA_INVENTORY_INVALID");
          if (row.organization) requireValue(row.organization.id === 9 && row.organization.slug === ORGANIZATION.slug, "QA_INVENTORY_SCOPE_MISMATCH");
        }
      }
    }
    return { projects: projects.projects, files: files.files };
  }
  function sanitizedInventory(value) {
    const result = {
      projects: value.projects.filter(syntheticProject).map((project) => cleanProject(project, value.files)).sort((a, b) => a.id - b.id),
      files: value.files.filter(syntheticFile).map(cleanFile).sort((a, b) => a.id - b.id),
    };
    requireValue(result.projects.length <= 64 && result.files.length <= 64, "QA_INVENTORY_TOO_LARGE");
    return result;
  }
  function inactive(file) { return file.active === false && file.isProject === false && linkedId(file) === null; }
  function noActiveSynthetic(value) {
    requireValue(!value.projects.some(syntheticProject) && !value.files.some((file) => syntheticFile(file) && !inactive(file)), "QA_PRIOR_CLEANUP_UNVERIFIED");
  }
  function slugMatches(slug, runId, kind) {
    return typeof slug === "string" && new RegExp(`^qa-durable-${runId}-${kind}(?:-[0-9]+)?$`).test(slug);
  }
  function iso(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
  function reportInput(input) {
    const report = snapshot(input);
    const manual = report.manualAdministration;
    exactKeys(manual, ["schemaVersion", "runId", "suite", "expectedCommit", "organizationId", "creatorUserId", "administratorUserId", "origin", "beforeInventoryDigest", "beforeInventory", "resources"], "QA_REPORT_INVALID");
    requireValue(manual.schemaVersion === 1 && UUID.test(manual.runId) && SUITES.includes(manual.suite) && SHA.test(manual.expectedCommit) && manual.organizationId === 9 && id(manual.creatorUserId) && id(manual.administratorUserId) && manual.creatorUserId !== manual.administratorUserId && manual.origin === ORIGIN && DIGEST.test(manual.beforeInventoryDigest), "QA_REPORT_INVALID");
    requireValue(report.mode === "run" && report.acceptanceExecuted === true && report.configurationRestored === true && iso(report.finishedAt) && Date.parse(report.finishedAt) <= Date.now(), "QA_RUN_NOT_FINISHED");
    // Known metadata and restored flags do not prove accepted remote work has
    // settled. A failed/interrupted run needs separate human reconciliation;
    // this helper has no write, retry, recovery or override path for that case.
    requireValue(report.operationalTestsPassed === true && report.acceptanceStatus === "PENDING_MANUAL_CLEANUP" &&
      report.error?.code === "MANUAL_CLEANUP_REQUIRED" && !Object.hasOwn(report, "budgetError") && !Object.hasOwn(report, "restoreError") &&
      Array.isArray(report.cases) && report.cases.every((row) => object(row) && typeof row.id === "string") &&
      new Set(report.cases.map((row) => row.id)).size === report.cases.length &&
      FUNCTIONAL_CASES[manual.suite].every((caseId) => report.cases.some((row) => row.id === caseId && row.status === "PASS")),
    "QA_REMOTE_OPERATIONS_UNRECONCILED");
    requireValue(Array.isArray(report.cleanupErrors) && report.cleanupErrors.length > 0 && report.cleanupErrors.every((error) => error?.code === "MANUAL_CLEANUP_REQUIRED"), "QA_CLEANUP_BARRIER_UNVERIFIED");
    for (const key of ["runId", "suite", "expectedCommit", "organizationId"]) {
      requireValue(report[key] === manual[key], "QA_REPORT_BINDING_MISMATCH");
    }
    requireValue(Array.isArray(manual.resources) && manual.resources.length >= 1 && manual.resources.length <= (manual.suite === "durable-project-save" ? 2 : 1), "QA_REPORT_INVALID");
    const kinds = new Set();
    const ids = new Set();
    for (const resource of manual.resources) {
      exactKeys(resource, ["kind", "name", "projectId", "slug", "organizationFileId", "reservationStarted", "reservationUncertain"], "QA_REPORT_INVALID");
      requireValue(["small", "large"].includes(resource.kind) && (manual.suite !== "durable-project-preview" || resource.kind === "small") && !kinds.has(resource.kind), "QA_REPORT_INVALID");
      kinds.add(resource.kind);
      requireValue(resource.name === `QA Durable ${manual.runId} ${resource.kind}` && nullableId(resource.projectId) && nullableId(resource.organizationFileId) && (resource.slug === null || slugMatches(resource.slug, manual.runId, resource.kind)) && typeof resource.reservationStarted === "boolean" && typeof resource.reservationUncertain === "boolean", "QA_REPORT_INVALID");
      requireValue(resource.reservationUncertain === false && (!resource.reservationStarted || (id(resource.projectId) && slugMatches(resource.slug, manual.runId, resource.kind))), "QA_RESERVATION_OUTCOME_UNCERTAIN");
      requireValue(resource.reservationStarted || (resource.projectId === null && resource.organizationFileId === null && resource.slug === null), "QA_REPORT_INVALID");
      if (resource.projectId !== null) {
        requireValue(!ids.has(resource.projectId), "QA_REPORT_INVALID");
        ids.add(resource.projectId);
      }
    }
    const before = manual.beforeInventory;
    exactKeys(before, ["schemaVersion", "kind", "suite", "expectedCommit", "runId", "workflowRunId", "workflowRunAttempt", "administratorUserId", "organization", "capturedAt", "origin", "inventory"], "QA_BEFORE_BINDING_MISMATCH");
    requireValue(typeof report.workflowRunId === "string" && WORKFLOW_RUN.test(report.workflowRunId) &&
      report.workflowRunAttempt === 1 && before.workflowRunId === report.workflowRunId && before.workflowRunAttempt === 1,
    "QA_WORKFLOW_BINDING_MISMATCH");
    exactKeys(before.organization, ["id", "slug", "active"], "QA_BEFORE_BINDING_MISMATCH");
    organization(before.organization);
    requireValue(before.schemaVersion === 1 && before.kind === "qa-before-inventory" && before.origin === ORIGIN &&
      iso(before.capturedAt) && Date.parse(before.capturedAt) <= Date.parse(report.finishedAt), "QA_BEFORE_BINDING_MISMATCH");
    for (const key of ["runId", "suite", "expectedCommit", "administratorUserId"]) requireValue(before[key] === manual[key], "QA_BEFORE_BINDING_MISMATCH");
    exactKeys(before.inventory, ["projects", "files"], "QA_BEFORE_BINDING_MISMATCH");
    requireValue(Array.isArray(before.inventory.projects) && before.inventory.projects.length === 0 && Array.isArray(before.inventory.files) && before.inventory.files.length <= 64, "QA_BEFORE_BINDING_MISMATCH");
    const beforeFileIds = new Set();
    for (const file of before.inventory.files) {
      exactKeys(file, ["id", "name", "organizationId", "active", "isProject", "linkedProjectId"], "QA_BEFORE_BINDING_MISMATCH");
      requireValue(id(file.id) && !beforeFileIds.has(file.id) && text(file.name) && file.name.startsWith("QA Durable") &&
        !file.name.includes(manual.runId) && file.organizationId === 9 && file.active === false && file.isProject === false && file.linkedProjectId === null,
      "QA_BEFORE_BINDING_MISMATCH");
      beforeFileIds.add(file.id);
    }
    requireValue(encoder.encode(JSON.stringify(before)).byteLength <= EXPORT_LIMIT, "QA_EXPORT_TOO_LARGE");
    return { report, manual };
  }
  async function validateBeforeDigest(manual) {
    requireValue(await digest(manual.beforeInventory) === manual.beforeInventoryDigest, "QA_BEFORE_DIGEST_MISMATCH");
  }
  function matches(project, resource, manual) {
    return project.id === resource.projectId || project.name === resource.name || slugMatches(project.slug, manual.runId, resource.kind);
  }
  function identity(project, resource, manual) {
    requireValue(project?.id === resource.projectId && project.name === resource.name && project.organizationId === 9 && project.createdBy?.id === manual.creatorUserId && slugMatches(project.slug, manual.runId, resource.kind) && (resource.slug === null || resource.slug === project.slug), "QA_CLEANUP_SCOPE_MISMATCH");
    if (project.organization) requireValue(project.organization.id === 9 && project.organization.slug === ORGANIZATION.slug, "QA_CLEANUP_SCOPE_MISMATCH");
  }
  function header(kind, manual, reportDigest) {
    return { schemaVersion: 1, kind, runId: manual.runId, suite: manual.suite, expectedCommit: manual.expectedCommit, organizationId: 9, creatorUserId: manual.creatorUserId, administratorUserId: manual.administratorUserId, origin: ORIGIN, capturedAt: new Date().toISOString(), reportDigest };
  }

  async function before(input) {
    const options = snapshot(input);
    exactKeys(options, ["suite", "expectedCommit", "workflowRunId"], "QA_OPTIONS_INVALID");
    requireValue(SUITES.includes(options.suite) && typeof options.expectedCommit === "string" && SHA.test(options.expectedCommit) && typeof options.workflowRunId === "string" && WORKFLOW_RUN.test(options.workflowRunId), "QA_OPTIONS_INVALID");
    const administratorUserId = await authenticate();
    const value = await inventory();
    noActiveSynthetic(value);
    const runId = globalThis.crypto.randomUUID();
    requireValue(UUID.test(runId), "QA_RUN_ID_INVALID");
    requireValue(!value.files.some((file) => ["small", "large"].some((kind) => file.name === `QA Durable ${runId} ${kind}`)), "QA_RUN_ID_COLLISION");
    return evidence({ schemaVersion: 1, kind: "qa-before-inventory", suite: options.suite, expectedCommit: options.expectedCommit.toLowerCase(), runId, workflowRunId: options.workflowRunId, workflowRunAttempt: 1, administratorUserId, organization: { ...ORGANIZATION }, capturedAt: new Date().toISOString(), origin: ORIGIN, inventory: sanitizedInventory(value) });
  }

  async function inspect(input) {
    const { report, manual } = reportInput(input);
    await validateBeforeDigest(manual);
    const reportDigest = await digest(report);
    requireValue(await authenticate() === manual.administratorUserId, "QA_ADMINISTRATOR_ID_MISMATCH");
    const value = await inventory();
    const resources = [];
    for (const resource of manual.resources) {
      const projects = value.projects.filter((project) => matches(project, resource, manual));
      const files = value.files.filter((file) => file.name === resource.name || (resource.organizationFileId !== null && file.id === resource.organizationFileId) || (resource.projectId !== null && linkedId(file) === resource.projectId));
      if (!resource.reservationStarted) {
        requireValue(projects.length === 0 && files.length === 0, "QA_RUN_ID_COLLISION");
        continue;
      }
      requireValue(projects.length === 1 && files.length === 1, "QA_CLEANUP_SCOPE_MISMATCH");
      identity(projects[0], resource, manual);
      const detail = (await get(`/api/admin/projects/${resource.projectId}`)).project;
      identity(detail, resource, manual);
      requireValue(detail.slug === projects[0].slug && id(detail.organizationFileId) && (resource.organizationFileId === null || resource.organizationFileId === detail.organizationFileId), "QA_CLEANUP_SCOPE_MISMATCH");
      const file = files[0];
      requireValue(file.id === detail.organizationFileId && file.name === resource.name && linkedId(file) === resource.projectId, "QA_CLEANUP_SCOPE_MISMATCH");
      resources.push({ kind: resource.kind, name: resource.name, projectId: detail.id, slug: detail.slug, organizationFileId: detail.organizationFileId, createdById: manual.creatorUserId, organizationId: 9 });
    }
    requireValue(new Set(resources.map((resource) => resource.organizationFileId)).size === resources.length, "QA_CLEANUP_SCOPE_MISMATCH");
    return evidence({ ...header("qa-cleanup-inspection", manual, reportDigest), resources });
  }

  async function after(input, inspectionInput) {
    const { report, manual } = reportInput(input);
    await validateBeforeDigest(manual);
    const inspection = snapshot(inspectionInput);
    const reportDigest = await digest(report);
    exactKeys(inspection, ["schemaVersion", "kind", "runId", "suite", "expectedCommit", "organizationId", "creatorUserId", "administratorUserId", "origin", "capturedAt", "reportDigest", "resources"], "QA_INSPECTION_INVALID");
    requireValue(inspection.schemaVersion === 1 && inspection.kind === "qa-cleanup-inspection" && inspection.origin === ORIGIN && iso(inspection.capturedAt) && Date.parse(inspection.capturedAt) >= Date.parse(report.finishedAt) && Date.parse(inspection.capturedAt) <= Date.now() && inspection.reportDigest === reportDigest, "QA_INSPECTION_BINDING_MISMATCH");
    for (const key of ["runId", "suite", "expectedCommit", "organizationId", "creatorUserId", "administratorUserId"]) requireValue(inspection[key] === manual[key], "QA_INSPECTION_BINDING_MISMATCH");
    const started = manual.resources.filter((resource) => resource.reservationStarted);
    requireValue(Array.isArray(inspection.resources) && inspection.resources.length === started.length, "QA_INSPECTION_BINDING_MISMATCH");
    const fileIds = new Set();
    const projectIds = new Set();
    for (const resource of inspection.resources) {
      exactKeys(resource, ["kind", "name", "projectId", "slug", "organizationFileId", "createdById", "organizationId"], "QA_INSPECTION_INVALID");
      const original = started.find((candidate) => candidate.kind === resource.kind);
      requireValue(original && resource.projectId === original.projectId && resource.name === original.name && resource.organizationId === 9 && resource.createdById === manual.creatorUserId && slugMatches(resource.slug, manual.runId, resource.kind) && (original.slug === null || original.slug === resource.slug) && id(resource.organizationFileId) && (original.organizationFileId === null || original.organizationFileId === resource.organizationFileId) && !fileIds.has(resource.organizationFileId) && !projectIds.has(resource.projectId), "QA_INSPECTION_BINDING_MISMATCH");
      fileIds.add(resource.organizationFileId);
      projectIds.add(resource.projectId);
    }
    requireValue(await authenticate() === manual.administratorUserId, "QA_ADMINISTRATOR_ID_MISMATCH");
    const details = [];
    for (const resource of inspection.resources) {
      await get(`/api/admin/projects/${resource.projectId}`, 404);
      const file = (await get(`/api/admin/organization-files/${resource.organizationFileId}`)).file;
      requireValue(file?.id === resource.organizationFileId && file.name === resource.name && file.organizationId === 9 && file.active === false && file.isProject === false, "QA_CLEANUP_UNVERIFIED");
      details.push({ resource, file });
    }
    const value = await inventory();
    for (const resource of manual.resources) {
      requireValue(!value.projects.some((project) => matches(project, resource, manual)), "QA_CLEANUP_UNVERIFIED");
      const files = value.files.filter((file) => file.name === resource.name || fileIds.has(file.id) || (resource.projectId !== null && linkedId(file) === resource.projectId));
      requireValue(files.every(inactive), "QA_CLEANUP_UNVERIFIED");
      if (!resource.reservationStarted) requireValue(files.every((file) => fileIds.has(file.id)), "QA_RUN_ID_COLLISION");
    }
    const observations = details.map(({ resource }) => {
      const file = value.files.find((candidate) => candidate.id === resource.organizationFileId);
      requireValue(file && file.name === resource.name && inactive(file), "QA_CLEANUP_UNVERIFIED");
      requireValue(value.files.filter((candidate) => candidate.name === resource.name).length === 1, "QA_RUN_ID_COLLISION");
      return { projectId: resource.projectId, projectStatus: 404, file: cleanFile(file) };
    });
    noActiveSynthetic(value);
    return evidence({ ...header("qa-after-cleanup", manual, reportDigest), inspection, observations, inventory: sanitizedInventory(value) });
  }

  requireValue(!Object.hasOwn(globalThis, "MaonoAcceptanceEvidence"), "QA_HELPER_ALREADY_INSTALLED");
  Object.defineProperty(globalThis, "MaonoAcceptanceEvidence", {
    value: Object.freeze({ before, inspect, after }), writable: false, configurable: false, enumerable: true,
  });
})();
