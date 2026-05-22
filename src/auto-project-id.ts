const ORIGINAL_PROMPT = window.prompt.bind(window);

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortId(length = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);

  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  }

  return Math.random().toString(36).slice(2, 2 + length);
}

function createProjectIdentifier(defaultValue?: string | null) {
  const base = slugify(defaultValue || "projeto");
  return `${base || "projeto"}-${shortId(6)}`;
}

window.prompt = (message?: string, defaultValue?: string) => {
  if (String(message || "").toLowerCase().includes("identificador do projeto")) {
    return createProjectIdentifier(defaultValue);
  }

  return ORIGINAL_PROMPT(message, defaultValue);
};

export {};
