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

export function errorResponse(message, status = 400, code = "BAD_REQUEST", details = null) {
  return jsonResponse(
    {
      ok: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status }
  );
}

export function methodNotAllowed(allowedMethods = ["GET"]) {
  return errorResponse(
    `Método não permitido. Use: ${allowedMethods.join(", ")}.`,
    405,
    "METHOD_NOT_ALLOWED"
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
    throw new Error(`Variáveis/bindings ausentes: ${missing.join(", ")}`);
  }
}
