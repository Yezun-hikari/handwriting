/**
 * `index.events.pb`: the document's operation log, a length-delimited stream of records
 * `{ 1: object id, <type>: body }`. Types seen in the sample: 30 document, 6 attachment,
 * 2 paper (page background, references the PDF attachment), 54 page (field 3 → paper,
 * field 4 {1 order key, 2 stamp}), 10 paging-view state, 102/104/105 notes & search state.
 *
 * Body conventions (all types): field 10 = wall clock (f64 ms since 1970), field 11 = event
 * UUID, one varint ≈ 1.76e12 = Lamport-style counter (field number varies by type), version
 * stamps `{1 counter, 2 rand u32}` in field 2 of LWW sub-messages.
 */
import { f64Bytes, newUuid, randomU32, tryUtf8, utf8 } from './bytes.ts';
import * as pb from './protobuf.ts';

export const T_DOCUMENT = 30;
export const T_PAPER = 2;
export const T_PAGE = 54;
export const T_NOTES = 102;

export interface EventRecord {
  id: string;
  type: number;
  body: pb.Message;
}

export function parseEvents(buf: Uint8Array): EventRecord[] {
  return pb.parseStream(buf).map((raw) => {
    const m = pb.parse(raw);
    if (m.length !== 2 || m[0].n !== 1 || m[0].wt !== 2 || m[1].wt !== 2) {
      throw new Error('events: unexpected record layout');
    }
    return { id: pb.getString(m, 1)!, type: m[1].n, body: pb.parse(m[1].v) };
  });
}

export const encodeEvent = (r: EventRecord): Uint8Array => pb.encode([pb.str(1, r.id), pb.msg(r.type, r.body)]);
export const encodeEvents = (rs: readonly EventRecord[]): Uint8Array => pb.encodeStream(rs.map(encodeEvent));

const LAMPORT_MIN = 1_000_000_000_000n;
const LAMPORT_MAX = 100_000_000_000_000n;
const isLamport = (f: pb.Field) => f.wt === 0 && f.v >= LAMPORT_MIN && f.v < LAMPORT_MAX;

export function maxLamport(rs: readonly EventRecord[]): bigint {
  let max = 0n;
  for (const r of rs) for (const f of r.body) if (isLamport(f) && f.wt === 0 && f.v > max) max = f.v;
  return max;
}

/** A length-delimited payload that is a printable UTF-8 string (sub-messages contain control bytes). */
function asString(b: Uint8Array): string | null {
  const s = tryUtf8(b);
  // eslint-disable-next-line no-control-regex
  return s !== null && !/[\u0000-\u001f\u007f]/.test(s) ? s : null;
}

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

function isStamp(m: pb.Message): boolean {
  const last = m[m.length - 1];
  if (!last || last.n !== 2 || last.wt !== 0) return false;
  return m.length === 1 || (m.length === 2 && m[0].n === 1 && m[0].wt === 0);
}

export interface CloneContext {
  /** Old object id → new object id (page, paper, notes). */
  ids: Map<string, string>;
  /** Next Lamport counter value is `++lamport.value`. */
  lamport: { value: bigint };
  /** Wall clock in ms for field 10. */
  now: number;
  /** For page records: replacement order key. */
  orderKey?: string;
}

/**
 * Clones an event record for a new object: maps ids, fresh event UUID, new wall clock and
 * Lamport counter, fresh random parts in all version stamps; everything else is copied.
 */
export function cloneEvent(rec: EventRecord, ctx: CloneContext): EventRecord {
  const mapId = (s: string) => ctx.ids.get(s);
  const body: pb.Message = rec.body.map((f): pb.Field => {
    if (f.wt === 1 && f.n === 10) return pb.fixed64(10, f64Bytes(ctx.now));
    if (isLamport(f)) return pb.varint(f.n, ++ctx.lamport.value);
    if (f.wt !== 2) return f;
    const s = asString(f.v);
    if (s !== null) {
      const m = mapId(s);
      if (m) return pb.str(f.n, m);
      if (f.n === 11 && UUID_RE.test(s)) return pb.str(11, newUuid());
      return f;
    }
    if (f.v.length === 0) return f;
    let sub: pb.Message;
    try {
      sub = pb.parse(f.v);
    } catch {
      return f;
    }
    const isOrderKey = rec.type === T_PAGE && f.n === 4 && ctx.orderKey !== undefined;
    const out = sub.map((g): pb.Field => {
      if (g.wt !== 2) return g;
      if (g.n === 1) {
        const gs = asString(g.v);
        if (gs !== null) {
          if (isOrderKey) return pb.str(1, ctx.orderKey!);
          const m = mapId(gs);
          if (m) return pb.str(1, m);
          return g;
        }
      }
      if (g.n === 2) {
        try {
          const st = pb.parse(g.v);
          if (isStamp(st)) return pb.msg(2, [...st.slice(0, -1), pb.varint(2, randomU32())]);
        } catch {
          /* not a stamp */
        }
      }
      return g;
    });
    return pb.msg(f.n, out);
  });
  const id = mapId(rec.id) ?? rec.id;
  const res = { id, type: rec.type, body };
  // safety: no old id of a remapped object may survive in the clone
  const bytes = encodeEvent(res);
  for (const old of ctx.ids.keys()) {
    if (indexOf(bytes, utf8(old)) >= 0) throw new Error(`events: clone still references ${old}`);
  }
  return res;
}

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function pageOrderKey(page: EventRecord): string {
  const k = pb.getMessage(page.body, 4);
  const s = k && pb.getString(k, 1);
  if (!s) throw new Error('events: page without order key');
  return s;
}

export function pagePaperId(page: EventRecord): string {
  const p = pb.getMessage(page.body, 3);
  const s = p && pb.getString(p, 1);
  if (!s) throw new Error('events: page without paper reference');
  return s;
}

/** Byte-wise (= code unit, keys are ASCII) comparison used for page order keys. */
export const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const KEY_DIGITS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Order keys for `count` pages appended after the page with key `base`: `base + "V" + 2 digits`.
 * Every extension of `base` sorts after it, the fixed-width suffix keeps them ascending, and no
 * key ends in "0" (fractional-index friendly).
 */
export function orderKeysAfter(base: string, count: number): string[] {
  const n = KEY_DIGITS.length;
  if (count > n * n) throw new Error('events: too many pages');
  const keys: string[] = [];
  for (let k = 0; k < count; k++) keys.push(base + 'V' + KEY_DIGITS[Math.floor(k / n)] + KEY_DIGITS[k % n]);
  return keys;
}
