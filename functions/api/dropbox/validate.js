import {
  errorResponse,
  jsonResponse,
  methodNotAllowed,
  readJsonBody,
} from "../../_lib/http.js";
import { requireSession } from "../../_lib/auth.js";
import { downloadDropboxTextFile } from "../../_lib/dropbox.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDropboxNotFound(error) {
  const message = String(error?.message || "");
  return message.includes("path/not_found") || message.includes("not_found");
}

function baseValidation(rootPath, fileName) {
  return {
    valid: false,
    message: "Arquivo ainda não validado.",
    rootPath,
    fileName,
    checks: {
      fileExists: false,
      jsonValid: false,
      hasDatasets: false,
      hasConfig: false,
      hasKeplerStructure: false,
      canLoadMap: false,
    },
    details: {
      datasetsCount: 0,
      configSections: [],
      errors: [],
      warnings: [],
    },
  };
}

function resolveSavedKeplerConfig(rawConfig) {
  if (!isObject(rawConfig)) {
    return null;
  }

  // Formato oficial de mapa salvo pelo schema do Kepler:
  // { config: { version: 'v1', config: { visState, mapState, mapStyle } } }
  if (isObject(rawConfig.config)) {
    return rawConfig.config;
  }

  // Formato já processado para addDataToMap:
  // { config: { visState, mapState, mapStyle } }
  return rawConfig;
}

function validateDataset(dataset, index, validation) {
  if (!isObject(dataset)) {
    validation.details.errors.push(`Dataset ${index + 1}: precisa ser um objeto.`);
    return;
  }

  // Formato oficial salvo pelo KeplerGLSchema:
  // { version: 'v1', data: { id, label, color, allData, fields } }
  const datasetData = isObject(dataset.data) ? dataset.data : dataset;

  if (!isObject(datasetData)) {
    validation.details.errors.push(`Dataset ${index + 1}: propriedade data ausente ou inválida.`);
    return;
  }

  const hasFields = Array.isArray(datasetData.fields);
  const hasRows = Array.isArray(datasetData.rows);
  const hasAllData = Array.isArray(datasetData.allData);

  if (!hasFields) {
    validation.details.errors.push(`Dataset ${index + 1}: fields ausente ou inválido.`);
  }

  if (!hasRows && !hasAllData) {
    validation.details.warnings.push(
      `Dataset ${index + 1}: não encontrei rows nem allData. O Kepler pode abrir sem dados nesse dataset.`
    );
  }
}

function validateKeplerObject(parsed, validation) {
  if (!isObject(parsed)) {
    validation.details.errors.push("A raiz do JSON precisa ser um objeto.");
    validation.message = "Arquivo encontrado, mas JSON inválido para Kepler.";
    return validation;
  }

  const datasets = Array.isArray(parsed.datasets) ? parsed.datasets : null;
  const normalizedConfig = resolveSavedKeplerConfig(parsed.config);

  validation.checks.hasDatasets = Boolean(datasets);
  validation.checks.hasConfig = Boolean(normalizedConfig);
  validation.details.datasetsCount = datasets ? datasets.length : 0;

  if (!datasets) {
    validation.details.errors.push("A propriedade datasets não foi encontrada ou não é uma lista.");
  } else if (datasets.length === 0) {
    validation.details.warnings.push("A lista datasets está vazia. O mapa pode abrir sem camadas/dados.");
  }

  if (!normalizedConfig) {
    validation.details.errors.push("A propriedade config não foi encontrada ou não é um objeto.");
  } else {
    const requiredSections = ["visState", "mapState", "mapStyle"];
    validation.details.configSections = requiredSections.filter((section) =>
      isObject(normalizedConfig[section])
    );

    for (const section of requiredSections) {
      if (!isObject(normalizedConfig[section])) {
        validation.details.errors.push(
          `A seção config.${section} não foi encontrada ou não é um objeto.`
        );
      }
    }
  }

  if (datasets) {
    datasets.forEach((dataset, index) => validateDataset(dataset, index, validation));
  }

  validation.checks.hasKeplerStructure = Boolean(
    datasets &&
      normalizedConfig &&
      isObject(normalizedConfig.visState) &&
      isObject(normalizedConfig.mapState) &&
      isObject(normalizedConfig.mapStyle)
  );

  validation.checks.canLoadMap = Boolean(
    validation.checks.fileExists &&
      validation.checks.jsonValid &&
      validation.checks.hasDatasets &&
      validation.checks.hasConfig &&
      validation.checks.hasKeplerStructure &&
      validation.details.errors.length === 0
  );

  validation.valid = validation.checks.canLoadMap;
  validation.message = validation.valid
    ? "Arquivo válido para Kepler."
    : "Arquivo encontrado, mas não passou em todas as validações do Kepler.";

  return validation;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }

  try {
    const user = await requireSession(env, request);

    if (user.role !== "admin") {
      return errorResponse("Apenas administradores podem validar arquivos do Dropbox.", 403, "FORBIDDEN");
    }

    const body = await readJsonBody(request);
    const rootPath = normalizeText(body?.dropboxRootPath || body?.rootPath);
    const fileName = normalizeText(body?.defaultConfigFile || body?.fileName);

    if (!rootPath || !rootPath.startsWith("/")) {
      return errorResponse("Informe uma pasta Dropbox válida começando com /.", 400, "DROPBOX_PATH_INVALID");
    }

    if (!fileName) {
      return errorResponse("Informe o nome do arquivo JSON.", 400, "DROPBOX_FILE_REQUIRED");
    }

    const validation = baseValidation(rootPath, fileName);
    let text = "";

    try {
      text = await downloadDropboxTextFile(env, rootPath, fileName);
      validation.checks.fileExists = true;
    } catch (error) {
      if (isDropboxNotFound(error)) {
        validation.message = "Arquivo não encontrado no Dropbox.";
        validation.details.errors.push("Arquivo não encontrado no caminho informado.");
        return jsonResponse({ ok: true, validation });
      }
      throw error;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(text);
      validation.checks.jsonValid = true;
    } catch (error) {
      validation.message = "Arquivo encontrado, mas JSON inválido.";
      validation.details.errors.push(error instanceof Error ? error.message : "Falha ao interpretar JSON.");
      return jsonResponse({ ok: true, validation });
    }

    return jsonResponse({ ok: true, validation: validateKeplerObject(parsed, validation) });
  } catch (error) {
    return errorResponse(error.message, error.status || 500, error.code || "DROPBOX_VALIDATE_ERROR");
  }
}
