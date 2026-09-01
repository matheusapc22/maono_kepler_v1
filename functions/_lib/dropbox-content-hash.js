export const DROPBOX_CONTENT_HASH_BLOCK_BYTES = 4 * 1024 * 1024;

function normalizeBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  const error = new Error("Bytes inválidos para cálculo do content hash Dropbox.");
  error.status = 400;
  error.code = "DROPBOX_CONTENT_HASH_BYTES_INVALID";
  throw error;
}

function hex(bytes) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function dropboxContentHashBlockDigest(input) {
  const bytes = normalizeBytes(input);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function dropboxContentHashFromBlockDigestsHex(blockDigests) {
  const digests = Array.from(blockDigests || [], (digest) => normalizeBytes(digest));
  const concatenated = new Uint8Array(digests.length * 32);

  for (let index = 0; index < digests.length; index += 1) {
    if (digests[index].byteLength !== 32) {
      const error = new Error("Digest de bloco inválido para content hash Dropbox.");
      error.status = 400;
      error.code = "DROPBOX_CONTENT_HASH_DIGEST_INVALID";
      throw error;
    }
    concatenated.set(digests[index], index * 32);
  }

  const finalDigest = await crypto.subtle.digest("SHA-256", concatenated);
  return hex(new Uint8Array(finalDigest));
}

export async function dropboxContentHashHex(input) {
  const bytes = normalizeBytes(input);
  const blockDigests = [];

  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += DROPBOX_CONTENT_HASH_BLOCK_BYTES
  ) {
    const block = bytes.subarray(
      offset,
      Math.min(offset + DROPBOX_CONTENT_HASH_BLOCK_BYTES, bytes.byteLength),
    );
    blockDigests.push(await dropboxContentHashBlockDigest(block));
  }

  return dropboxContentHashFromBlockDigestsHex(blockDigests);
}
