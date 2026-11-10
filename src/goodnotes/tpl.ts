/**
 * "tpl\0" typed packed layout used inside Goodnotes stroke blobs (after LZ4 decompression).
 *
 * Layout: `"tpl\0" | u32le totalSize (incl. header) | signature ASCII NUL-terminated | values`,
 * values packed little-endian without padding. Signature grammar: `v` = u16, `u` = 32-bit word
 * (observed: float32), `f` = float32, `A(x)` = u32 count + count × x, `S(...)` = struct.
 */
import { fromLatin1, latin1, view } from './bytes.ts';

export type TplType = 'v' | 'u' | 'f' | { A: TplType } | { S: TplType[] };
export type TplValue = number | TplValue[];

export function parseSignature(sig: string): TplType[] {
  let i = 0;
  const one = (): TplType => {
    const c = sig[i++];
    if (c === 'v' || c === 'u' || c === 'f') return c;
    if (c === 'A' || c === 'S') {
      if (sig[i++] !== '(') throw new Error('tpl: expected ( in signature');
      const members: TplType[] = [];
      while (sig[i] !== ')') {
        if (i >= sig.length) throw new Error('tpl: unterminated (');
        members.push(one());
      }
      i++;
      if (c === 'A') {
        if (members.length !== 1) throw new Error('tpl: A() needs exactly one member');
        return { A: members[0] };
      }
      return { S: members };
    }
    throw new Error(`tpl: bad signature char ${c} at ${i - 1}`);
  };
  const top: TplType[] = [];
  while (i < sig.length) top.push(one());
  return top;
}

export interface Tpl {
  sig: string;
  values: TplValue[];
}

export function tplDecode(buf: Uint8Array): Tpl {
  if (fromLatin1(buf, 0, 4) !== 'tpl\0') throw new Error('tpl: bad magic');
  const dv = view(buf);
  const total = dv.getUint32(4, true);
  if (total !== buf.length) throw new Error(`tpl: size ${total} != ${buf.length}`);
  const nul = buf.indexOf(0, 8);
  if (nul < 0) throw new Error('tpl: unterminated signature');
  const sig = fromLatin1(buf, 8, nul);
  let pos = nul + 1;
  const need = (k: number) => {
    if (pos + k > buf.length) throw new Error('tpl: value overrun');
  };
  const rd = (t: TplType): TplValue => {
    if (t === 'v') {
      need(2);
      const x = dv.getUint16(pos, true);
      pos += 2;
      return x;
    }
    if (t === 'u' || t === 'f') {
      need(4);
      const x = dv.getFloat32(pos, true);
      pos += 4;
      return x;
    }
    if ('A' in t) {
      need(4);
      const count = dv.getUint32(pos, true);
      pos += 4;
      const a: TplValue[] = [];
      for (let k = 0; k < count; k++) a.push(rd(t.A));
      return a;
    }
    return t.S.map(rd);
  };
  const values = parseSignature(sig).map(rd);
  if (pos !== buf.length) throw new Error(`tpl: ${buf.length - pos} trailing bytes`);
  return { sig, values };
}

export function tplEncode({ sig, values }: Tpl): Uint8Array {
  const types = parseSignature(sig);
  let size = 0;
  const measure = (t: TplType, x: TplValue): void => {
    if (t === 'v') size += 2;
    else if (t === 'u' || t === 'f') size += 4;
    else if ('A' in t) {
      size += 4;
      for (const e of x as TplValue[]) measure(t.A, e);
    } else t.S.forEach((m, k) => measure(m, (x as TplValue[])[k]));
  };
  types.forEach((t, k) => measure(t, values[k]));
  const sigb = latin1(sig + '\0');
  const out = new Uint8Array(8 + sigb.length + size);
  const dv = view(out);
  out.set(latin1('tpl\0'), 0);
  dv.setUint32(4, out.length, true);
  out.set(sigb, 8);
  let pos = 8 + sigb.length;
  const wr = (t: TplType, x: TplValue): void => {
    if (t === 'v') {
      dv.setUint16(pos, x as number, true);
      pos += 2;
    } else if (t === 'u' || t === 'f') {
      dv.setFloat32(pos, x as number, true);
      pos += 4;
    } else if ('A' in t) {
      const a = x as TplValue[];
      dv.setUint32(pos, a.length, true);
      pos += 4;
      for (const e of a) wr(t.A, e);
    } else t.S.forEach((m, k) => wr(m, (x as TplValue[])[k]));
  };
  types.forEach((t, k) => wr(t, values[k]));
  return out;
}
