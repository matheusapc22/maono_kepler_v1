import {
  createCorrelationId,
  normalizeMaonoError,
  toPublicError,
} from "./maono-error.js";

const DEFAULT_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: init.status || 200,
    headers: {
      ...DEFAULT_HEADERS,
      ...(init.headers || {}),
    },
  });
}

function logErrorEnvelope(error) {
  const payload = {
    correlationId: error.correlationId,
    code: error.code,
    category: error.category,
    retryable: Boolean(error.retryable),
    status: Number(error.status || 500),
  };
  const method = payload.status >= 500 ? "error" : "warn";
  console[method]("[Maono HTTP error]", payload);
}

export function errorResponse(
  message,
  status = 400,
  code = "BAD_REQUEST",
  details = null,
  options = {},
) {
  const correlationId = options.correlationId || createCorrelationId();
  const normalized = normalizeMaonoError(
    options.error || {
      message,
      status,
      code,
      details,
      category: options.category,
      retryable: options.retryable,
      correlationId,
    },
    {
      defaultCode: code,
      status,
      message,
      details,
      category: options.category,
      retryable: options.retryable,
      correlationId,
    },
  );
  const publicError = toPublicError(normalized, {
    correlationId,
    includeMessage: options.includeMessage !== false,
  });

  logErrorEnvelope({
    ...normalized,
    correlationId: publicError.correlationId,
  });

  return jsonResponse(
    {
      ok: false,
      error: publicError,
    },
    {
      status: normalized.status || status,
      headers: {
        "X-Correlation-Id": publicError.correlationId,
        ...(options.headers || {}),
      },
    },
  );
}

export function errorResponseFromError(error, options = {}) {
  const correlationId = options.correlationId || error?.correlationId || createCorrelationId();
  const normalized = normalizeMaonoError(error, {
    defaultCode: options.defaultCode,
    status: options.status,
    category: options.category,
    retryable: options.retryable,
    message: options.message,
    details: options.details,
    correlationId,
  });

  // A causa técnica define code/category/status/retryable, mas nunca deve
  // substituir uma mensagem pública deliberadamente sanitizada pelo endpoint.
  return errorResponse(
    options.publicMessage || normalized.message,
    normalized.status,
    normalized.code,
    normalized.details || null,
    {
      correlationId,
      category: normalized.category,
      retryable: normalized.retryable,
      includeMessage: options.includeMessage !== false,
      headers: options.headers,
    },
  );
}

export function methodNotAllowed(allowedMethods = ["GET"], options = {}) {
  return errorResponse(
    `Método não permitido. Use: ${allowedMethods.join(", ")}.`,
    405,
    "METHOD_NOT_ALLOWED",
    null,
    options,
  );
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = cookieHeader.split(";").map((item) => item.trim());

  for (const cookie of cookies) {
    const [cookieName, ...cookieValueParts] = cookie.split("=");
    if (cookieName === name) {
      return decodeURIComponent(cookieValueParts.join("="));
    }
  }

  return null;
}

export function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure !== false) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);

  return parts.join("; ");
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch (_error) {
    return null;
  }
}

export function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    const error = new Error(`Variáveis/bindings ausentes: ${missing.join(", ")}`);
    error.status = 500;
    error.code = "INFRASTRUCTURE_ENV_NOT_CONFIGURED";
    error.retryable = false;
    throw error;
  }
}
