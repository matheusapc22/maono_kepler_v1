import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SLO_CONTRACT = JSON.parse(fs.readFileSync(path.join(here, "reliability-slo-contract.json"), "utf8"));
const ACTION = "organization.storage.observation";
const DAY = 86400000;
const TYPES = new Set(["created", "operational", "failure", "blocked", "attempt"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function time(value, name) {
  invariant(typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value), `${name}: timestamp com timezone obrigatório`);
  const ms = Date.parse(value);
  invariant(Number.isFinite(ms), `${name}: timestamp inválido`);
  return ms;
}

function inventoryTime(value) {
  return time(/(?:Z|[+-]\d{2}:\d{2})$/.test(value || "") ? value : `${String(value).replace(" ", "T")}Z`, "organizations.created_at");
}

function id(value, field) {
  invariant(Number.isSafeInteger(Number(value)) && Number(value) > 0, `${field}: id inválido`);
  return Number(value);
}

export function exportRows(input) {
  if (Array.isArray(input)) {
    if (input.length && input.every((row) => row && Array.isArray(row.results))) {
      invariant(input.every((row) => row.success !== false), "Export D1 contém consulta com falha");
      return input.flatMap((row) => row.results);
    }
    return input;
  }
  if (input && Array.isArray(input.results)) {
    invariant(input.success !== false, "Export D1 contém consulta com falha");
    return input.results;
  }
  throw new Error("Esperado array de registros ou export JSON do Wrangler");
}

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => sorted.length ? sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] : null;
  return { samples: sorted.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), unit: "ms" };
}

function metric(total, successful, durations, rule) {
  return {
    total, successful, unsuccessful: total - successful,
    ratio: total ? successful / total : null,
    objective: rule.objective, deadlineMs: rule.deadlineMs, minSamples: rule.minSamples,
    status: total < rule.minSamples ? "INCONCLUSIVE" : successful / total >= rule.objective ? "PASS" : "FAIL",
    // Observed physical completion latencies: unresolved/late operations remain in
    // the denominator and cannot disappear merely because they have no duration.
    completionLatency: quantiles(durations),
  };
}

export function buildReliabilitySloReport({ manifest, organizations, audit }, contract = SLO_CONTRACT) {
  try {
    invariant(manifest?.schemaVersion === 1, "manifest.schemaVersion deve ser 1");
    for (const key of ["environment", "databaseName", "databaseId"]) {
      invariant(manifest.target?.[key] === contract.target[key], `Alvo divergente: ${key}`);
    }
    invariant(/^[0-9a-f]{40}$/i.test(manifest.releaseSha || ""), "releaseSha deve ser o SHA completo observado");
    invariant(manifest.evidenceKind === "production-observation", "Evidência simulada ou de preview não comprova SLO de produção");
    const start = time(manifest.window?.start, "window.start");
    const end = time(manifest.window?.end, "window.end");
    const through = time(manifest.window?.observedThrough, "window.observedThrough");
    invariant(end - start === contract.windowDays * DAY, `Janela deve ter ${contract.windowDays} dias`);
    invariant(through >= end, "observedThrough anterior ao fim da janela");
    const reasons = [];
    if (through < end + Math.max(contract.provisioning.deadlineMs, contract.transientRecovery.deadlineMs)) {
      reasons.push("FOLLOW_UP_WINDOW_INCOMPLETE");
    }
    const coverage = manifest.coverage || {};
    for (const field of ["organizationInventoryComplete", "auditExportComplete", "telemetryComplete"]) {
      if (coverage[field] !== true) reasons.push(`COVERAGE_${field.toUpperCase()}_UNCONFIRMED`);
    }
    if (typeof coverage.evidenceRef !== "string" || !coverage.evidenceRef.trim()) reasons.push("COVERAGE_EVIDENCE_REFERENCE_MISSING");
    if (!coverage.from || !coverage.through || time(coverage.from, "coverage.from") > start || time(coverage.through, "coverage.through") < through) {
      reasons.push("COVERAGE_INTERVAL_INCOMPLETE");
    }

    const inventory = new Map();
    for (const row of exportRows(organizations)) {
      const organizationId = id(row.id, "organization");
      const createdAt = inventoryTime(row.created_at);
      invariant(!inventory.has(organizationId), "Inventário contém organização duplicada");
      inventory.set(organizationId, { organizationId, createdAt });
    }
    const events = [];
    const ids = new Map();
    let duplicateAuditRows = 0;
    let missingCorrelation = 0;
    for (const row of exportRows(audit)) {
      if (row.action !== ACTION) continue;
      const eventId = id(row.id, "audit");
      const signature = JSON.stringify(row);
      if (ids.has(eventId)) {
        invariant(ids.get(eventId) === signature, "Eventos com mesmo audit.id e conteúdo divergente");
        duplicateAuditRows += 1;
        continue;
      }
      ids.set(eventId, signature);
      const details = typeof row.details === "string" ? JSON.parse(row.details) : row.details;
      const event = details?.metadata;
      invariant(event?.schemaVersion === 1 && TYPES.has(event.type), "Observação de storage inválida");
      invariant(["lifecycle", "scheduled", "operator"].includes(event.source), "Origem de observação inválida");
      const organizationId = id(event.organizationId, "event.organizationId");
      const observedAt = time(event.observedAt, "event.observedAt");
      invariant(observedAt <= through, "Evento posterior à coleta declarada");
      if (observedAt >= start && !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.correlationId || "")) missingCorrelation += 1;
      events.push({ ...event, organizationId, at: observedAt, auditId: eventId });
    }
    events.sort((a, b) => a.at - b.at || a.auditId - b.auditId);
    const creations = new Map();
    for (const event of events.filter((item) => item.type === "created")) {
      invariant(typeof event.activeAtCreation === "boolean", "created sem activeAtCreation");
      const createdAt = time(event.createdAt, "created.createdAt");
      invariant(createdAt <= event.at, "Evento created anterior à criação");
      if (createdAt < start || createdAt >= end) continue;
      const previous = creations.get(event.organizationId);
      invariant(!previous || (previous.createdAt === createdAt && previous.activeAtCreation === event.activeAtCreation), "Criação divergente para a mesma organização");
      creations.set(event.organizationId, { ...event, createdAt });
      if (!inventory.has(event.organizationId)) reasons.push(`CREATED_ORGANIZATION_MISSING_FROM_INVENTORY:${event.organizationId}`);
    }
    const completions = events.filter((event) => event.type === "operational" && event.physicallyVerified === true && event.superseded !== true);
    const manual = (event) => event.manualIntervention !== false || event.source === "operator";
    const intervened = (organizationId, since, until) => events.some((event) =>
      event.organizationId === organizationId && event.at >= since && event.at <= until &&
      (event.manualIntervention === true || (event.source === "operator" && ["attempt", "failure", "operational"].includes(event.type))),
    );
    let newTotal = 0;
    let newSuccessful = 0;
    let inactiveAtCreation = 0;
    const newDurations = [];
    for (const row of inventory.values()) {
      if (row.createdAt < start || row.createdAt >= end) continue;
      const creation = creations.get(row.organizationId);
      if (!creation) {
        reasons.push(`CREATION_OBSERVATION_MISSING:${row.organizationId}`);
        continue;
      }
      invariant(creation.createdAt === row.createdAt, "Data de criação diverge do inventário D1");
      if (!creation.activeAtCreation) { inactiveAtCreation += 1; continue; }
      newTotal += 1;
      const completion = completions.find((event) => event.organizationId === row.organizationId && event.at >= row.createdAt);
      if (!completion) continue;
      const duration = completion.at - row.createdAt;
      newDurations.push(duration);
      if (duration <= contract.provisioning.deadlineMs && !manual(completion) && !intervened(row.organizationId, row.createdAt, completion.at)) newSuccessful += 1;
    }

    const incidents = new Map();
    for (const event of events.filter((item) => item.type === "failure" && item.superseded !== true)) {
      invariant(typeof event.incidentId === "string" && event.incidentId.length > 0, "Falha sem incidentId");
      const firstFailedAt = time(event.firstFailedAt, "failure.firstFailedAt");
      invariant(firstFailedAt <= event.at, "Primeira falha posterior ao evento");
      if (firstFailedAt < start || firstFailedAt >= end) continue;
      const completedAt = event.completedAt ? time(event.completedAt, "failure.completedAt") : null;
      invariant(completedAt === null || (completedAt >= firstFailedAt && completedAt <= event.at), "Conclusão de falha fora da sequência temporal");
      const isInitialFailure = completedAt === firstFailedAt;
      const previous = incidents.get(event.incidentId);
      invariant(!previous || (previous.organizationId === event.organizationId && previous.firstFailedAt === firstFailedAt), "Incidente com identidade ou início divergente");
      if (isInitialFailure && previous?.initialObservationPresent) {
        invariant(previous.retryable === event.retryable, "Incidente com classificação inicial divergente");
      }
      // Preserve the initial classification: a permanent failure after initial
      // transient errors is still an unsuccessful member of that first cohort.
      // The first *exported* event may already be a retry after a lost audit row.
      // Only a completion at firstFailedAt establishes the original cohort.
      if (!previous || (isInitialFailure && !previous.initialObservationPresent)) {
        incidents.set(event.incidentId, { ...event, firstFailedAt, initialObservationPresent: isInitialFailure });
      }
    }
    for (const incident of incidents.values()) {
      if (!incident.initialObservationPresent) reasons.push(`INITIAL_FAILURE_OBSERVATION_MISSING:${incident.incidentId}`);
      else if (typeof incident.retryable !== "boolean") reasons.push(`INCIDENT_CLASSIFICATION_MISSING:${incident.incidentId}`);
    }
    for (const event of events) {
      if (event.firstFailedAt && event.type !== "failure" && event.superseded !== true) {
        const firstFailedAt = time(event.firstFailedAt, "event.firstFailedAt");
        if (firstFailedAt >= start && firstFailedAt < end && !incidents.has(event.incidentId)) {
          reasons.push(`INCIDENT_FAILURE_OBSERVATION_MISSING:${event.incidentId || "unknown"}`);
        }
      }
    }
    for (const event of events.filter((item) => item.type === "attempt" && item.superseded !== true && item.at >= start && item.at < end)) {
      if (!event.incidentId) {
        reasons.push(`ATTEMPT_INCIDENT_ID_MISSING:${event.auditId}`);
        continue;
      }
      const terminal = events.some((candidate) =>
        candidate.incidentId === event.incidentId && candidate.organizationId === event.organizationId &&
        candidate.at >= event.at && candidate.superseded !== true &&
        (candidate.type === "failure" || (candidate.type === "operational" && candidate.physicallyVerified === true)),
      );
      if (!terminal) reasons.push(`ATTEMPT_WITHOUT_TERMINAL_OBSERVATION:${event.incidentId}`);
      if (event.attemptCount > 1 && !event.firstFailedAt && !incidents.has(event.incidentId)) {
        reasons.push(`RETRIED_INCIDENT_CLASSIFICATION_MISSING:${event.incidentId}`);
      }
    }
    let recoveryTotal = 0;
    let recoverySuccessful = 0;
    const recoveryDurations = [];
    for (const incident of incidents.values()) {
      if (!incident.initialObservationPresent || incident.retryable !== true) continue;
      recoveryTotal += 1;
      const completion = completions.find((event) => event.incidentId === incident.incidentId && event.organizationId === incident.organizationId && event.at >= incident.firstFailedAt);
      if (!completion) continue;
      const duration = completion.at - incident.firstFailedAt;
      recoveryDurations.push(duration);
      if (duration <= contract.transientRecovery.deadlineMs && !manual(completion) && !intervened(incident.organizationId, incident.firstFailedAt, completion.at)) recoverySuccessful += 1;
    }
    const provisioning = metric(newTotal, newSuccessful, newDurations, contract.provisioning);
    const transientRecovery = metric(recoveryTotal, recoverySuccessful, recoveryDurations, contract.transientRecovery);
    if (provisioning.status === "INCONCLUSIVE") reasons.push("PROVISIONING_SAMPLE_INSUFFICIENT");
    if (transientRecovery.status === "INCONCLUSIVE") reasons.push("TRANSIENT_RECOVERY_SAMPLE_INSUFFICIENT");
    const checks = [];
    invariant(!manifest.safetyChecks || Array.isArray(manifest.safetyChecks), "safetyChecks deve ser array");
    for (const name of contract.zeroTolerance) {
      const matches = (manifest.safetyChecks || []).filter((check) => check.name === name);
      invariant(matches.length <= 1, `Verificação duplicada: ${name}`);
      const check = matches[0];
      if (!check) {
        checks.push({ name, status: "INCONCLUSIVE", count: null });
        reasons.push(`SAFETY_EVIDENCE_MISSING:${name}`);
        continue;
      }
      invariant(Number.isSafeInteger(check.count) && check.count >= 0, `Contagem inválida: ${name}`);
      const covered = typeof check.evidenceRef === "string" && check.evidenceRef.trim().length > 0 && time(check.from, `${name}.from`) <= start && time(check.through, `${name}.through`) >= through;
      const status = check.count > 0 ? "FAIL" : covered ? "PASS" : "INCONCLUSIVE";
      checks.push({ name, status, count: check.count, evidenceRef: check.evidenceRef || null });
      if (status === "INCONCLUSIVE") reasons.push(`SAFETY_COVERAGE_INCOMPLETE:${name}`);
    }
    checks.push({ name: "missingCorrelation", status: missingCorrelation ? "FAIL" : reasons.some((reason) => reason.startsWith("COVERAGE_")) ? "INCONCLUSIVE" : "PASS", count: missingCorrelation });
    const failure = provisioning.status === "FAIL" || transientRecovery.status === "FAIL" || checks.some((check) => check.status === "FAIL");
    const status = failure ? "FAIL" : reasons.length ? "INCONCLUSIVE" : "PASS";
    return {
      schemaVersion: 1, contractVersion: contract.version, status,
      target: manifest.target, releaseSha: manifest.releaseSha, window: manifest.window,
      provisioning, transientRecovery, safetyChecks: checks,
      cohorts: { inactiveAtCreation, incidentCount: incidents.size, permanentIncidents: [...incidents.values()].filter((incident) => incident.initialObservationPresent && incident.retryable === false).length, supersededFailures: events.filter((event) => event.type === "failure" && event.superseded === true && event.at >= start && event.at < end).length, duplicateAuditRows },
      reasons: [...new Set(reasons)],
      limitations: ["Valida o conteúdo dos exports e o manifesto; não autentica a origem da coleta.", "Percentis descrevem conclusões físicas observadas; falhas e pendências continuam no denominador.", "Contagens de integridade e UX exigem evidência própria; ausência de eventos não comprova ausência de incidentes."],
    };
  } catch (error) {
    return { schemaVersion: 1, contractVersion: contract.version, status: "INVALID", errors: [error.message] };
  }
}

export function reportExitCode(report, gate = false) {
  if (report.status === "INVALID") return 2;
  if (!gate || report.status === "PASS") return 0;
  return report.status === "FAIL" ? 1 : 3;
}

function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--gate") { options.gate = true; continue; }
    invariant(["--manifest", "--organizations", "--audit", "--output"].includes(key), `Opção desconhecida: ${key}`);
    invariant(!options[key] && argv[index + 1] && !argv[index + 1].startsWith("--"), `Valor ausente/duplicado: ${key}`);
    options[key] = argv[++index];
  }
  const inputs = {};
  const sourceHashes = {};
  for (const key of ["manifest", "organizations", "audit"]) {
    invariant(options[`--${key}`], `Obrigatório: --${key}`);
    const content = fs.readFileSync(options[`--${key}`], "utf8").replace(/^\uFEFF/, "");
    inputs[key] = JSON.parse(content);
    sourceHashes[key] = createHash("sha256").update(content).digest("hex");
  }
  const report = { ...buildReliabilitySloReport(inputs), sourceHashes };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options["--output"]) {
    const output = path.resolve(options["--output"]);
    invariant(!["manifest", "organizations", "audit"].some((key) => path.resolve(options[`--${key}`]) === output), "Output não pode substituir evidência de entrada");
    fs.writeFileSync(output, json, { flag: "wx" });
  }
  process.stdout.write(json);
  process.exitCode = reportExitCode(report, options.gate);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
