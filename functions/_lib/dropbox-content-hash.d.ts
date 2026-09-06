export const DROPBOX_CONTENT_HASH_BLOCK_BYTES: number;
export function dropboxContentHashBlockDigest(input: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
export function dropboxContentHashFromBlockDigestsHex(digests: Uint8Array[]): Promise<string>;
export function dropboxContentHashHex(input: Uint8Array | ArrayBuffer): Promise<string>;
