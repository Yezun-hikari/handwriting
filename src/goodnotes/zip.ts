/**
 * Minimal ZIP container reader/writer that keeps untouched entries byte for byte (local header +
 * compressed data copied verbatim) and writes new/changed entries with the same settings the
 * Goodnotes export uses: version 2.0, UTF-8 name flag (0x800), deflate, no extra fields,
 * Unix made-by 3.21, mode 100644. (De)compression via fflate.
 */
import { deflateSync, inflateSync } from 'fflate';
import { concatBytes, utf8, view } from './bytes.ts';

export interface ZipEntry {
  name: string;
  madeBy: number;
  needed: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  csize: number;
  usize: number;
  intAttr: number;
  extAttr: number;
  cdExtra: Uint8Array;
  cdComment: Uint8Array;
  localHeader: Uint8Array;
  /** Compressed payload. */
  raw: Uint8Array;
}

export interface ZipArchive {
  entries: ZipEntry[];
  comment: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function readZip(buf: Uint8Array): ZipArchive {
  const dv = view(buf);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = dv.getUint16(eocd + 10, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  const comment = buf.slice(eocd + 22, eocd + 22 + dv.getUint16(eocd + 20, true));
  const dec = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const nl = dv.getUint16(p + 28, true);
    const xl = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const flags = dv.getUint16(p + 8, true);
    if (flags & 1) throw new Error('zip: encrypted entries are not supported');
    if (flags & 8) throw new Error('zip: data descriptors are not supported');
    const csize = dv.getUint32(p + 20, true);
    const off = dv.getUint32(p + 42, true);
    if (dv.getUint32(off, true) !== 0x04034b50) throw new Error('zip: bad local header');
    const lnl = dv.getUint16(off + 26, true);
    const lxl = dv.getUint16(off + 28, true);
    const dataStart = off + 30 + lnl + lxl;
    entries.push({
      name: dec.decode(buf.subarray(p + 46, p + 46 + nl)),
      madeBy: dv.getUint16(p + 4, true),
      needed: dv.getUint16(p + 6, true),
      flags,
      method: dv.getUint16(p + 10, true),
      time: dv.getUint16(p + 12, true),
      date: dv.getUint16(p + 14, true),
      crc: dv.getUint32(p + 16, true),
      csize,
      usize: dv.getUint32(p + 24, true),
      intAttr: dv.getUint16(p + 36, true),
      extAttr: dv.getUint32(p + 38, true),
      cdExtra: buf.slice(p + 46 + nl, p + 46 + nl + xl),
      cdComment: buf.slice(p + 46 + nl + xl, p + 46 + nl + xl + cl),
      localHeader: buf.slice(off, dataStart),
      raw: buf.slice(dataStart, dataStart + csize),
    });
    p += 46 + nl + xl + cl;
  }
  return { entries, comment };
}

export function entryData(e: ZipEntry): Uint8Array {
  let data: Uint8Array;
  if (e.method === 0) data = e.raw;
  else if (e.method === 8) data = e.raw.length ? inflateSync(e.raw, { out: new Uint8Array(e.usize) }) : new Uint8Array(0);
  else throw new Error('zip: unsupported compression method ' + e.method);
  if (data.length !== e.usize || crc32(data) !== e.crc) throw new Error('zip: CRC/size mismatch in ' + e.name);
  return data;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function buildLocalHeader(e: Omit<ZipEntry, 'localHeader'>): Uint8Array {
  const nm = utf8(e.name);
  const lh = new Uint8Array(30 + nm.length);
  const dv = view(lh);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(4, e.needed, true);
  dv.setUint16(6, e.flags, true);
  dv.setUint16(8, e.method, true);
  dv.setUint16(10, e.time, true);
  dv.setUint16(12, e.date, true);
  dv.setUint32(14, e.crc, true);
  dv.setUint32(18, e.csize, true);
  dv.setUint32(22, e.usize, true);
  dv.setUint16(26, nm.length, true);
  dv.setUint16(28, 0, true);
  lh.set(nm, 30);
  return lh;
}

/** New deflated entry with Goodnotes export settings. */
export function makeEntry(name: string, data: Uint8Array, mtime = new Date()): ZipEntry {
  const raw = deflateSync(data, { level: 6 });
  const { time, date } = dosDateTime(mtime);
  const e = {
    name,
    madeBy: 0x0315,
    needed: 20,
    flags: 0x0800,
    method: 8,
    time,
    date,
    crc: crc32(data),
    csize: raw.length,
    usize: data.length,
    intAttr: 0,
    extAttr: (0o100644 << 16) >>> 0,
    cdExtra: new Uint8Array(0),
    cdComment: new Uint8Array(0),
    raw,
  };
  return { ...e, localHeader: buildLocalHeader(e) };
}

/** Same metadata as `e`, new content (re-deflated if `e` was deflated). */
export function replaceEntryData(e: ZipEntry, data: Uint8Array): ZipEntry {
  const raw = e.method === 0 ? data : deflateSync(data, { level: 6 });
  const n = { ...e, raw, crc: crc32(data), csize: raw.length, usize: data.length };
  const lh = e.localHeader.slice();
  const dv = view(lh);
  dv.setUint32(14, n.crc, true);
  dv.setUint32(18, n.csize, true);
  dv.setUint32(22, n.usize, true);
  return { ...n, localHeader: lh };
}

export function writeZip({ entries, comment }: ZipArchive): Uint8Array {
  const parts: Uint8Array[] = [];
  const cds: Uint8Array[] = [];
  let off = 0;
  for (const e of entries) {
    parts.push(e.localHeader, e.raw);
    const nm = utf8(e.name);
    const cd = new Uint8Array(46);
    const dv = view(cd);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, e.madeBy, true);
    dv.setUint16(6, e.needed, true);
    dv.setUint16(8, e.flags, true);
    dv.setUint16(10, e.method, true);
    dv.setUint16(12, e.time, true);
    dv.setUint16(14, e.date, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.csize, true);
    dv.setUint32(24, e.usize, true);
    dv.setUint16(28, nm.length, true);
    dv.setUint16(30, e.cdExtra.length, true);
    dv.setUint16(32, e.cdComment.length, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, e.intAttr, true);
    dv.setUint32(38, e.extAttr, true);
    dv.setUint32(42, off, true);
    cds.push(cd, nm, e.cdExtra, e.cdComment);
    off += e.localHeader.length + e.raw.length;
  }
  const cdBuf = concatBytes(cds);
  const eocd = new Uint8Array(22);
  const dv = view(eocd);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, cdBuf.length, true);
  dv.setUint32(16, off, true);
  dv.setUint16(20, comment.length, true);
  return concatBytes([...parts, cdBuf, eocd, comment]);
}
