export {
  isPersistentViewerMutationOperation,
  validatePersistentViewerMutationOperation,
} from "./project-change-request-persistent-mutation-operations-core.js";

import {
  applyPersistentViewerMutationOperation as applyCorePersistentViewerMutationOperation,
} from "./project-change-request-persistent-mutation-operations-core.js";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value, maximum = 300) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.length <= maximum ? normalized : "";
}

function failure(message, details = null) {
  const error = new Error(message);
  error.code = "CHANGE_REQUEST_OPERATION_TARGET_MISSING";
  error.status = 409;
  if (details) error.details = details;
  return error;
}

function datasetId(dataset) {
  return text(dataset?.data?.id ?? dataset?.info?.id ?? dataset?.id, 200);
}

function datasetFields(dataset) {
  const fields = dataset?.data?.fields ?? dataset?.fields ?? [];
  return new Set(
    (Array.isArray(fields) ? fields : [])
      .map((field) => text(field?.name, 200))
      .filter(Boolean),
  );
}

function assertDefinitionReferences(config, operation) {
  if (operation?.type !== "layer.definition.update") return;
  const payload = record(operation.payload);
  const after = record(payload?.after);
  if (!after) return;

  const dataIds = Array.isArray(after.dataIds)
    ? after.dataIds.map((item) => text(item, 200)).filter(Boolean)
    : [];
  const datasets = Array.isArray(config?.datasets) ? config.datasets : [];
  const selected = dataIds.map((dataId) => {
    const dataset = datasets.find((candidate) => datasetId(candidate) === dataId);
    if (!dataset) {
      throw failure("O dataset associado à camada não existe mais.", { dataId });
    }
    return dataset;
  });

  const available = new Set();
  for (const dataset of selected) {
    for (const field of datasetFields(dataset)) available.add(field);
  }

  const columns = record(after.columns) || {};
  const references = [
    columns.latitude,
    columns.longitude,
    columns.geojson,
    columns.altitude,
    after.colorField,
    after.strokeColorField,
    after.radiusField,
  ]
    .map((value) => text(value, 200))
    .filter(Boolean);

  const missing = references.find((field) => !available.has(field));
  if (missing) {
    throw failure("Um campo referenciado pela definição da camada não existe mais.", {
      fieldName: missing,
      dataIds,
    });
  }
}

export function applyPersistentViewerMutationOperation(config, operation) {
  assertDefinitionReferences(config, operation);
  return applyCorePersistentViewerMutationOperation(config, operation);
}
