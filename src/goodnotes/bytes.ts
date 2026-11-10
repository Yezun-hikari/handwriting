/** Small byte helpers shared by the Goodnotes codecs (browser + node, no Buffer). */

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export const utf8 = (s: string): Uint8Array => enc.encode(s);
export function fromUtf8(b: Uint8Array): string {
  return dec.decode(b);
}
/** Decodes UTF-8 or returns null if the bytes are not valid UTF-8. */
export function tryUtf8(b: Uint8Array): string | null {
  try {
    return dec.decode(b);
  } catch {
    return null;
  }
}

export function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
export function fromLatin1(b: Uint8Array, start = 0, end = b.length): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

export function f32Bytes(x: number): Uint8Array {
  const b = new Uint8Array(4);
  view(b).setFloat32(0, x, true);
  return b;
}
export function f64Bytes(x: number): Uint8Array {
  const b = new Uint8Array(8);
  view(b).setFloat64(0, x, true);
  return b;
}
export const readF32 = (b: Uint8Array): number => view(b).getFloat32(0, true);
export const readF64 = (b: Uint8Array): number => view(b).getFloat64(0, true);

/** Random non-zero unsigned 32-bit integer (version stamps / z-order tiebreakers). */
export function randomU32(): number {
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a);
  while (a[0] === 0);
  return a[0];
}

/** Fresh RFC 4122 v4 UUID in the uppercase form Goodnotes uses. */
export const newUuid = (): string => crypto.randomUUID().toUpperCase();

/** UUID string + n, treating the UUID as a 128-bit big-endian integer (notes id = page id + 1). */
export function uuidAdd(uuid: string, n: number): string {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9A-Fa-f]{32}$/.test(hex)) throw new Error('not a UUID: ' + uuid);
  const v = (BigInt('0x' + hex) + BigInt(n)) & ((1n << 128n) - 1n);
  const h = v.toString(16).toUpperCase().padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
