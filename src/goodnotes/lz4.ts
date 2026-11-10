/**
 * LZ4 block codec and Apple's "bv41" frame (Compression framework, COMPRESSION_LZ4), used for the
 * geometry blobs inside Goodnotes stroke records.
 *
 * Frame: sequence of blocks `"bv41" | u32le rawSize | u32le compSize | lz4 block` or
 * `"bv4-" | u32le rawSize | raw bytes`, terminated by `"bv4$"`.
 */
import { concatBytes, fromLatin1, latin1, view } from './bytes.ts';

export function lz4BlockDecode(src: Uint8Array, rawSize: number): Uint8Array {
  const out = new Uint8Array(rawSize);
  let ip = 0;
  let op = 0;
  while (ip < src.length) {
    const token = src[ip++];
    let lit = token >> 4;
    if (lit === 15) {
      let b: number;
      do {
        b = src[ip++];
        lit += b;
      } while (b === 255);
    }
    if (ip + lit > src.length || op + lit > rawSize) throw new Error('lz4: literal overrun');
    out.set(src.subarray(ip, ip + lit), op);
    ip += lit;
    op += lit;
    if (ip >= src.length) break; // last sequence has literals only
    const off = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (off === 0 || off > op) throw new Error('lz4: bad offset');
    let ml = token & 15;
    if (ml === 15) {
      let b: number;
      do {
        b = src[ip++];
        ml += b;
      } while (b === 255);
    }
    ml += 4;
    if (op + ml > rawSize) throw new Error('lz4: match overrun');
    for (let i = 0; i < ml; i++, op++) out[op] = out[op - off];
  }
  if (op !== rawSize) throw new Error(`lz4: size mismatch ${op} != ${rawSize}`);
  return out;
}

/**
 * Greedy single-probe LZ4 block encoder. Spec compliant: the last 5 bytes are literals and the
 * last match starts at least 12 bytes before the end.
 */
export function lz4BlockEncode(src: Uint8Array): Uint8Array {
  const n = src.length;
  const out: number[] = [];
  const table = new Map<number, number>();
  const dv = view(src);
  const MFLIMIT = 12;
  const LASTLITERALS = 5;
  let anchor = 0;
  let ip = 0;
  const writeLen = (len: number) => {
    while (len >= 255) {
      out.push(255);
      len -= 255;
    }
    out.push(len);
  };
  const emit = (litEnd: number, off: number, ml: number) => {
    const lit = litEnd - anchor;
    const tokPos = out.length;
    out.push(0);
    let tok = (lit >= 15 ? 15 : lit) << 4;
    if (lit >= 15) writeLen(lit - 15);
    for (let i = anchor; i < litEnd; i++) out.push(src[i]);
    if (off) {
      out.push(off & 255, off >> 8);
      const m = ml - 4;
      tok |= m >= 15 ? 15 : m;
      if (m >= 15) writeLen(m - 15);
    }
    out[tokPos] = tok;
  };
  while (ip + MFLIMIT < n) {
    const key = dv.getUint32(ip, true);
    const cand = table.get(key);
    table.set(key, ip);
    if (cand !== undefined && ip - cand < 65536 && dv.getUint32(cand, true) === key) {
      let ml = 4;
      while (ip + ml < n - LASTLITERALS && src[cand + ml] === src[ip + ml]) ml++;
      emit(ip, ip - cand, ml);
      ip += ml;
      anchor = ip;
    } else ip++;
  }
  emit(n, 0, 0);
  return Uint8Array.from(out);
}

export function lz4FrameDecode(buf: Uint8Array): Uint8Array {
  const dv = view(buf);
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (;;) {
    if (pos + 4 > buf.length) throw new Error('lz4 frame: missing end marker');
    const magic = fromLatin1(buf, pos, pos + 4);
    if (magic === 'bv4$') {
      pos += 4;
      break;
    }
    if (magic === 'bv41') {
      const raw = dv.getUint32(pos + 4, true);
      const comp = dv.getUint32(pos + 8, true);
      parts.push(lz4BlockDecode(buf.subarray(pos + 12, pos + 12 + comp), raw));
      pos += 12 + comp;
    } else if (magic === 'bv4-') {
      const raw = dv.getUint32(pos + 4, true);
      parts.push(buf.slice(pos + 8, pos + 8 + raw));
      pos += 8 + raw;
    } else throw new Error(`lz4 frame: bad magic ${JSON.stringify(magic)} at ${pos}`);
  }
  if (pos !== buf.length) throw new Error('lz4 frame: trailing bytes');
  return concatBytes(parts);
}

/** Single "bv41" block + end marker (what Goodnotes writes for stroke blobs). */
export function lz4FrameEncode(raw: Uint8Array): Uint8Array {
  const comp = lz4BlockEncode(raw);
  const head = new Uint8Array(12);
  head.set(latin1('bv41'), 0);
  view(head).setUint32(4, raw.length, true);
  view(head).setUint32(8, comp.length, true);
  return concatBytes([head, comp, latin1('bv4$')]);
}
