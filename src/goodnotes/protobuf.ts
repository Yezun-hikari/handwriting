/**
 * Schema-less, lossless protobuf wire-format codec. A message is an ordered list of fields;
 * varints are kept as bigint (device ids are full u64), fixed32/64 and length-delimited payloads
 * as raw bytes. Re-encoding a parsed message reproduces it byte for byte (minimal varints).
 */
import { concatBytes, fromUtf8, utf8 } from './bytes.ts';

export const WT_VARINT = 0;
export const WT_I64 = 1;
export const WT_LEN = 2;
export const WT_I32 = 5;

export type Field =
  | { n: number; wt: 0; v: bigint }
  | { n: number; wt: 1 | 2 | 5; v: Uint8Array };

export type Message = Field[];

export function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  const start = pos;
  for (;;) {
    if (pos >= buf.length) throw new Error('protobuf: varint overrun at ' + start);
    if (shift > 63n) throw new Error('protobuf: varint too long at ' + start);
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    shift += 7n;
    if (!(b & 0x80)) return [result, pos];
  }
}

export function writeVarint(value: bigint | number): Uint8Array {
  let v = BigInt(value);
  if (v < 0n) v = BigInt.asUintN(64, v);
  const out: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Uint8Array.from(out);
}

export function parse(buf: Uint8Array): Message {
  const fields: Message = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos);
    const n = Number(key >> 3n);
    const wt = Number(key & 7n);
    if (n === 0) throw new Error('protobuf: field number 0 at ' + pos);
    if (wt === WT_VARINT) {
      const [v, p2] = readVarint(buf, p1);
      fields.push({ n, wt, v });
      pos = p2;
    } else if (wt === WT_I64 || wt === WT_I32) {
      const len = wt === WT_I64 ? 8 : 4;
      if (p1 + len > buf.length) throw new Error('protobuf: fixed overrun');
      fields.push({ n, wt, v: buf.subarray(p1, p1 + len) });
      pos = p1 + len;
    } else if (wt === WT_LEN) {
      const [len, p] = readVarint(buf, p1);
      const end = p + Number(len);
      if (end > buf.length) throw new Error('protobuf: length overrun');
      fields.push({ n, wt, v: buf.subarray(p, end) });
      pos = end;
    } else throw new Error(`protobuf: bad wire type ${wt} at ${pos}`);
  }
  return fields;
}

export function encodeField(f: Field): Uint8Array {
  const key = writeVarint((BigInt(f.n) << 3n) | BigInt(f.wt));
  if (f.wt === WT_VARINT) return concatBytes([key, writeVarint(f.v)]);
  if (f.wt === WT_LEN) return concatBytes([key, writeVarint(f.v.length), f.v]);
  return concatBytes([key, f.v]);
}

export const encode = (fields: Message): Uint8Array => concatBytes(fields.map(encodeField));

// ---- builders / accessors -------------------------------------------------------------------

export const varint = (n: number, v: bigint | number): Field => ({ n, wt: 0, v: BigInt(v) });
export const bytes = (n: number, v: Uint8Array): Field => ({ n, wt: 2, v });
export const str = (n: number, s: string): Field => ({ n, wt: 2, v: utf8(s) });
export const msg = (n: number, m: Message): Field => ({ n, wt: 2, v: encode(m) });
export const fixed32 = (n: number, v: Uint8Array): Field => ({ n, wt: 5, v });
export const fixed64 = (n: number, v: Uint8Array): Field => ({ n, wt: 1, v });

export const get = (m: Message, n: number): Field | undefined => m.find((f) => f.n === n);
export const getAll = (m: Message, n: number): Field[] => m.filter((f) => f.n === n);

export function getBytes(m: Message, n: number): Uint8Array | undefined {
  const f = get(m, n);
  if (!f) return undefined;
  if (f.wt !== WT_LEN) throw new Error(`protobuf: field ${n} is not length-delimited`);
  return f.v;
}
export function getString(m: Message, n: number): string | undefined {
  const b = getBytes(m, n);
  return b && fromUtf8(b);
}
export function getMessage(m: Message, n: number): Message | undefined {
  const b = getBytes(m, n);
  return b && parse(b);
}
export function getVarint(m: Message, n: number): bigint | undefined {
  const f = get(m, n);
  if (!f) return undefined;
  if (f.wt !== WT_VARINT) throw new Error(`protobuf: field ${n} is not a varint`);
  return f.v;
}
export const getNumber = (m: Message, n: number): number | undefined => {
  const v = getVarint(m, n);
  return v === undefined ? undefined : Number(v);
};

/** Returns a copy of `m` with the first field `n` replaced (or appended when missing). */
export function setField(m: Message, f: Field): Message {
  const i = m.findIndex((x) => x.n === f.n);
  if (i < 0) return [...m, f];
  const out = m.slice();
  out[i] = f;
  return out;
}

// ---- length-delimited record streams (varint length + payload, used by *.pb files) ----------

export function parseStream(buf: Uint8Array): Uint8Array[] {
  const recs: Uint8Array[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [len, p] = readVarint(buf, pos);
    const end = p + Number(len);
    if (end > buf.length) throw new Error('protobuf: stream overrun');
    recs.push(buf.subarray(p, end));
    pos = end;
  }
  return recs;
}

export function encodeStream(recs: readonly Uint8Array[]): Uint8Array {
  return concatBytes(recs.flatMap((r) => [writeVarint(r.length), r]));
}
