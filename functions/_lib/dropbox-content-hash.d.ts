export declare const DROPBOX_CONTENT_HASH_BLOCK_BYTES: number;
export declare function dropboxContentHashBlockDigest(input: Uint8Array | ArrayBuffer): Promise<Uint8Array>;
export declare function dropboxContentHashFromBlockDigestsHex(digests: Uint8Array[]): Promise<string>;
export declare function dropboxContentHashHex(input: Uint8Array | ArrayBuffer): Promise<string>;
