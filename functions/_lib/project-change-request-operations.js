import {
  buildProjectChangeProposal as buildCoreProjectChangeProposal,
  isProjectChangeOperationConflict as isCoreProjectChangeOperationConflict,
} from "./project-change-request-operations-core.js";
import {
  applyFrozenAnalysisOperation,
  isFrozenAnalysisOperation,
} from "./project-change-request-analysis-operations.js";
import {
  applyPersistentVisualizationOperation,
  isPersistentVisualizationOperation,
} from "./project-change-request-visualization-operations.js";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function operationError(message, code, details = null, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

export function buildProjectChangeProposal({ baseConfig, operations }) {
  if (!baseConfig || typeof baseConfig !== "object" || Array.isArray(baseConfig)) {
    throw operationError(
      "A revisão-base não contém uma configuração válida.",
      "CHANGE_REQUEST_BASE_CONFIG_INVALID",
      null,
      409,
    );
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw operationError(
      "A solicitação não possui operações para aplicar.",
      "CHANGE_REQUEST_OPERATION_COUNT_INVALID",
    );
  }

  let config = cloneJson(baseConfig);
  const projections = [];
  for (const operation of operations) {
    try {
      if (isFrozenAnalysisOperation(operation)) {
        projections.push(applyFrozenAnalysisOperation(config, operation));
        continue;
      }
      if (isPersistentVisualizationOperation(operation)) {
        projections.push(applyPersistentVisualizationOperation(config, operation));
        continue;
      }
      const result = buildCoreProjectChangeProposal({
        baseConfig: config,
        operations: [operation],
      });
      config = result.config;
      projections.push(...result.projections);
    } catch (error) {
      if (error && typeof error === "object") {
        if (!error.details) error.details = {};
        error.details.operationId = String(operation?.id || "").trim() || null;
        error.details.sequence = Number(operation?.sequence ?? 0);
      }
      throw error;
    }
  }

  return {
    config,
    projections,
    operationCount: operations.length,
  };
}

export function isProjectChangeOperationConflict(error) {
  return isCoreProjectChangeOperationConflict(error) ||
    String(error?.code || "").startsWith("CHANGE_REQUEST_OPERATION_TARGET_");
}
