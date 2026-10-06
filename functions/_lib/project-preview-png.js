// Deliberately dependency-free: Workers and local Node use the same bounded PNG
// parser, zlib inflater and scanline decoder. A signature is never proof of PNG.
export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
export const PREVIEW_WIDTH = 960;
export const PREVIEW_HEIGHT = 540;
export function previewError(code, status = 422) { return Object.assign(new Error(code), { code, status }); }
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
export function pngCrc(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export async function previewSha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export async function readBoundedPreview(body, { maxBytes = MAX_PREVIEW_BYTES, expectedBytes = null, timeoutMs = 10000 } = {}) {
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (body instanceof Uint8Array) {
    if (!body.length || body.length > maxBytes) throw previewError(body.length ? 'THUMBNAIL_TOO_LARGE' : 'THUMBNAIL_EMPTY', body.length ? 413 : 400);
    if (expectedBytes !== null && body.length !== expectedBytes) throw previewError('THUMBNAIL_SIZE_MISMATCH');
    return body;
  }
  if (!body?.getReader) throw previewError('THUMBNAIL_EMPTY', 400);
  const reader = body.getReader();
  // A single bounded allocation prevents one-byte chunks from consuming an
  // unbounded array of chunk objects, even under a dishonest Content-Length.
  const bytes = new Uint8Array(expectedBytes ?? maxBytes); let size = 0, timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(previewError('THUMBNAIL_READ_TIMEOUT', 408)); }, timeoutMs); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw previewError('THUMBNAIL_INVALID_BYTES');
      const nextSize = size + value.byteLength;
      if (nextSize > maxBytes || (expectedBytes !== null && nextSize > expectedBytes)) throw previewError('THUMBNAIL_TOO_LARGE', 413);
      bytes.set(value, size); size = nextSize;
    }
    if (!size || (expectedBytes !== null && size !== expectedBytes)) throw previewError('THUMBNAIL_SIZE_MISMATCH');
    return bytes.subarray(0, size);
  } catch (error) { void reader.cancel(error).catch(() => {}); throw error; }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
export async function validatePreviewPng(bytes) {
  const started = Date.now();
  const invalid = () => { throw previewError('INVALID_THUMBNAIL_PNG'); };
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length > MAX_PREVIEW_BYTES || ![137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, header = null, palette = null, ended = false, idatEnded = false, compressedSize = 0;
  const compressed = []; const seen = new Set();
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const length = view.getUint32(offset), end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) invalid();
    if (pngCrc(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) invalid();
    const data = bytes.subarray(offset + 8, end - 4);
    if (!header && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (header || offset !== 8 || length !== 13) invalid();
      const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12), depth = data[8], color = data[9];
      if (width !== PREVIEW_WIDTH || height !== PREVIEW_HEIGHT) throw previewError('THUMBNAIL_DIMENSIONS_INVALID');
      const depths = { 0:[1,2,4,8,16], 2:[8,16], 3:[1,2,4,8], 4:[8,16], 6:[8,16] };
      if (!depths[color]?.includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] > 1) invalid();
      header = { width, height, depth, color, interlace:data[12], channels:({0:1,2:3,3:1,4:2,6:4})[color] };
    } else if (type === 'PLTE') {
      if (palette || compressed.length || !length || length % 3 || length > 768 || [0,4].includes(header.color)) invalid();
      palette = length / 3;
      if (header.color === 3 && palette > 2 ** header.depth) invalid();
    } else if (type === 'IDAT') {
      if (idatEnded || (header.color === 3 && !palette)) invalid();
      compressed.push(data); compressedSize += length;
    } else if (type === 'IEND') {
      if (length !== 0 || !compressedSize || end !== bytes.length) invalid();
      ended = true;
    } else {
      if (compressed.length) idatEnded = true;
      // Unknown critical chunks and animated PNG are outside the still-image contract.
      if (type[0] === type[0].toUpperCase() || ['acTL','fcTL','fdAT'].includes(type)) invalid();
      if (type === 'tRNS') {
        if (seen.has(type) || compressed.length || [4,6].includes(header.color) ||
          (header.color === 0 && length !== 2) || (header.color === 2 && length !== 6) ||
          (header.color === 3 && (!palette || !length || length > palette))) invalid();
      }
    }
    seen.add(type); offset = end;
  }
  if (!ended) invalid();
  const passes = header.interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const layouts = passes.map(([x,y,dx,dy]) => ({ width:Math.max(0,Math.ceil((header.width-x)/dx)), height:Math.max(0,Math.ceil((header.height-y)/dy)) }))
    .filter(p => p.width && p.height).map(p => ({ ...p, stride:Math.ceil(p.width * header.channels * header.depth / 8) }));
  const decodedSize = layouts.reduce((n,p) => n + (p.stride+1)*p.height,0);
  const zipped = new Uint8Array(compressedSize); let at = 0;
  for (const part of compressed) { zipped.set(part,at); at += part.length; }
  let decoded;
  try { decoded = await readBoundedPreview(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('deflate')), { maxBytes:decodedSize, expectedBytes:decodedSize, timeoutMs:5000 }); }
  catch (error) { if (error.code === 'THUMBNAIL_READ_TIMEOUT') throw error; invalid(); }
  let cursor = 0; const bpp = Math.max(1, Math.ceil(header.channels * header.depth / 8));
  for (const pass of layouts) {
    let previous = new Uint8Array(pass.stride), row = new Uint8Array(pass.stride);
    for (let y = 0; y < pass.height; y++) {
      if (Date.now() - started > 5000) throw previewError('THUMBNAIL_DECODE_TIMEOUT', 422);
      const filter = decoded[cursor++]; if (filter > 4) invalid();
      for (let x = 0; x < pass.stride; x++) {
        const a = x >= bpp ? row[x-bpp] : 0, b = previous[x], c = x >= bpp ? previous[x-bpp] : 0;
        row[x] = (decoded[cursor++] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a+b)/2) : paeth(a,b,c))) & 255;
      }
      if (header.color === 3) for (let x = 0; x < pass.width; x++) {
        const bit = x*header.depth, index = (row[bit >>> 3] >>> (8-header.depth-(bit & 7))) & ((1 << header.depth)-1);
        if (index >= palette) invalid();
      }
      [previous,row] = [row,previous];
    }
  }
  return { width:header.width, height:header.height, sizeBytes:bytes.byteLength, imageChecksum:await previewSha256(bytes) };
}
