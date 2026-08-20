import { MapDocumentValidationError } from "./validate-document.js";

function canonicalError(message, code, path) {
  throw new MapDocumentValidationError(message, code, path);
}

function assertCanonicalJson(value, path, ancestors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      canonicalError(
        "Número não finito não pode ser serializado canonicamente.",
        "MAP_DOCUMENT_CANONICAL_NUMBER_INVALID",
        path,
      );
    }
    return;
  }

  if (typeof value !== "object") {
    canonicalError(
      "Valor não representável em JSON canônico.",
      value === undefined
        ? "MAP_DOCUMENT_CANONICAL_UNDEFINED"
        : "MAP_DOCUMENT_CANONICAL_VALUE_INVALID",
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

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    canonicalError(
      "Documento contém objeto fora do modelo JSON.",
      "MAP_DOCUMENT_CANONICAL_OBJECT_INVALID",
      path,
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        assertCanonicalJson(value[index], `${path}[${index}]`, ancestors);
      }
      return;
    }

    for (const key of Object.keys(value)) {
      assertCanonicalJson(value[key], `${path}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function canonicalReplacer(_key, value) {
  if (typeof value === "number" && Object.is(value, -0)) {
    return 0;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const ordered = {};
  for (const key of Object.keys(value).sort()) {
    ordered[key] = value[key];
  }
  return ordered;
}

export function canonicalizeDocument(document) {
  assertCanonicalJson(document, "$", new WeakSet());
  return JSON.parse(JSON.stringify(document, canonicalReplacer));
}

export function canonicalSerialize(document) {
  assertCanonicalJson(document, "$", new WeakSet());
  return JSON.stringify(document, canonicalReplacer);
}

export function canonicalSerializeBytes(document) {
  const text = canonicalSerialize(document);
  return { text, bytes: new TextEncoder().encode(text) };
}
