import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dropboxPath = new URL("../functions/_lib/dropbox.js", import.meta.url);
const clientPath = new URL("../functions/_lib/dropbox-client.js", import.meta.url);
const repositoryPath = new URL(
  "../functions/_lib/dropbox-map-config-repository.js",
  import.meta.url,
);
const catalogPath = new URL("../functions/_lib/error-catalog.js", import.meta.url);

test("Dropbox backend usa wrapper único em vez de fetch disperso", async () => {
  const [dropbox, client] = await Promise.all([
    readFile(dropboxPath, "utf8"),
    readFile(clientPath, "utf8"),
  ]);

  assert.match(dropbox, /getDropboxClient/);
  assert.doesNotMatch(dropbox, /\bfetch\s*\(/);
  assert.match(client, /AbortController/);
  assert.match(client, /RETRYABLE_STATUS = new Set\(\[429, 502, 503, 504\]\)/);
  assert.match(client, /retry-after/i);
  assert.match(client, /DROPBOX_TIMEOUT/);
  assert.match(client, /DROPBOX_RATE_LIMITED/);
  assert.match(client, /DROPBOX_UNAVAILABLE/);
  assert.match(client, /DROPBOX_AUTH_FAILED/);
});

test("upload imutável continua create-only e conflito é reconciliado no repository", async () => {
  const [dropbox, repository] = await Promise.all([
    readFile(dropboxPath, "utf8"),
    readFile(repositoryPath, "utf8"),
  ]);

  assert.match(dropbox, /strict_conflict:\s*createOnly/);
  assert.match(dropbox, /mode:\s*createOnly \? "add" : "overwrite"/);
  assert.match(repository, /isWriteConflict\(error\)/);
  assert.match(repository, /existingRevisionResult/);
  assert.match(repository, /idempotent:\s*true/);
});

test("upload sessions não recebem retry cego por cursor", async () => {
  const dropbox = await readFile(dropboxPath, "utf8");
  assert.match(
    dropbox,
    /uploadSessionRequest[\s\S]*maxRetries:\s*0/,
  );
});

test("catálogo expõe os quatro códigos canônicos da SAVE-03", async () => {
  const catalog = await readFile(catalogPath, "utf8");
  assert.match(catalog, /DROPBOX_TIMEOUT:[^\n]*status:\s*504[^\n]*retryable:\s*true/);
  assert.match(catalog, /DROPBOX_RATE_LIMITED:[^\n]*status:\s*429[^\n]*retryable:\s*true/);
  assert.match(catalog, /DROPBOX_UNAVAILABLE:[^\n]*status:\s*503[^\n]*retryable:\s*true/);
  assert.match(catalog, /DROPBOX_AUTH_FAILED:[^\n]*status:\s*503[^\n]*retryable:\s*false/);
});
