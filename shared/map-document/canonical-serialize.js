import { MapDocumentValidationError } from "./validate-document.js";

function canonicalError(message, code, path) {
  throw new MapDocumentValidationError(message, code, path);
}

function canonicalize(value, path, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      canonicalError(
        "Número não finito não pode ser serializado canonicamente.",
        "MAP_DOCUMENT_CANONICAL_NUMBER_INVALID",
        path,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value !== "object") {
    canonicalError(
      "Valor não representável em JSON canônico.",
      "MAP_DOCUMENT_CANONICAL_VALUE_INVALID",
      path,
    );
  }

  if (ancestors.has(value)) {
    canonicalError(
      "Documento contém referência circular.",
      "MAP_DOCUMENT_CANONICAL_CYCLE",
      path,
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => {
        if (entry === undefined) {
          canonicalError(
            "Array contém valor undefined.",
            "MAP_DOCUMENT_CANONICAL_UNDEFINED",
            `${path}[${index}]`,
          );
        }
        return canonicalize(entry, `${path}[${index}]`, ancestors);
      });
    }

    const output = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) {
        canonicalError(
          "Objeto contém valor undefined.",
          "MAP_DOCUMENT_CANONICAL_UNDEFINED",
          `${path}.${key}`,
        );
      }
      output[key] = canonicalize(entry, `${path}.${key}`, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeDocument(document) {
  return canonicalize(document, "$", new WeakSet());
}

export function canonicalSerialize(document) {
  return JSON.stringify(canonicalizeDocument(document));
}

export function canonicalSerializeBytes(document) {
  const text = canonicalSerialize(document);
  return { text, bytes: new TextEncoder().encode(text) };
}
