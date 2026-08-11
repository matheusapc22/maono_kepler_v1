import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { dropboxContentHashHex } from "../functions/_lib/dropbox-content-hash.js";

const BLOCK_BYTES = 4 * 1024 * 1024;

function expectedDropboxContentHash(bytes) {
  const blockHashes = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BLOCK_BYTES) {
    const end = Math.min(offset + BLOCK_BYTES, bytes.byteLength);
    blockHashes.push(
      createHash("sha256").update(bytes.subarray(offset, end)).digest(),
    );
  }
  return createHash("sha256").update(Buffer.concat(blockHashes)).digest("hex");
}

test("S05: content hash Dropbox coincide com implementação independente", async () => {
  const bytes = new TextEncoder().encode("Maono S05 immutable revision");
  assert.equal(
    await dropboxContentHashHex(bytes),
    expectedDropboxContentHash(bytes),
  );
});

test("S05: content hash Dropbox respeita fronteira de blocos de 4 MiB", async () => {
  const bytes = new Uint8Array(BLOCK_BYTES + 17);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    bytes[index] = index % 251;
  }
  assert.equal(
    await dropboxContentHashHex(bytes),
    expectedDropboxContentHash(bytes),
  );
});
