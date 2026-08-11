const DROPBOX_CONTENT_HASH_BLOCK_BYTES = 4 * 1024 * 1024;

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
    const digest = await crypto.subtle.digest("SHA-256", block);
    blockDigests.push(new Uint8Array(digest));
  }

  const concatenated = new Uint8Array(blockDigests.length * 32);
  for (let index = 0; index < blockDigests.length; index += 1) {
    concatenated.set(blockDigests[index], index * 32);
  }

  const finalDigest = await crypto.subtle.digest("SHA-256", concatenated);
  return hex(new Uint8Array(finalDigest));
}
