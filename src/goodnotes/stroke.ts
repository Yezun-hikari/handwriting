/**
 * Goodnotes 6 stroke records (content of `notes/<notesId>`).
 *
 * The file is a length-delimited stream of (header, body) record pairs:
 * - header: 1 uuid · 2 version stamp {1 counter, 2 rand u32} · 3 deleted · 8 device id (u64) ·
 *   9 per-device sequence number · 14 constant 5381 · 16 schema (24)
 * - body: 7 { 1 uuid · 2 LZ4 "bv41" frame of a tpl geometry blob · 4 colour {1..4 f32 rgba,
 *   zero components omitted} · 6, 9, 20 empty · 7 {1 {1 z index, 2 rand u32}} · 14 deleted ·
 *   15 version stamp (same as header) · 21 schema }
 *
 * Geometry (uniform pen, signature {@link STROKE_SIG}): version u16 (2) · width f32 ·
 * node types (0 = moveTo, 1 = quadTo) · moveTo points · quad segments (cx, cy, x, y) ·
 * u16 (1) · per-node widths (empty for a uniform pen).
 */
import { bytesEqual, f32Bytes, readF32 } from './bytes.ts';
import { lz4FrameDecode, lz4FrameEncode } from './lz4.ts';
import * as pb from './protobuf.ts';
import { tplDecode, tplEncode, type TplValue } from './tpl.ts';

export const STROKE_SIG = 'vuA(v)A(S(uu))A(S(uuuu))vA(f)';

export interface VersionStamp {
  counter: number;
  rand: number;
}

export interface StrokeGeometry {
  version: number;
  width: number;
  nodeTypes: number[];
  starts: [number, number][];
  quads: [number, number, number, number][];
  tail: number;
  widths: number[];
}

export interface StrokeRecord {
  uuid: string;
  clock: VersionStamp;
  deleted: boolean;
  /** u64 device id, copied from the template. */
  device: bigint;
  seq: number;
  /** Header field 14, observed constant 5381. */
  f14: number;
  schema: number;
  color: [number, number, number, number];
  z: { index: number; rand: number };
  geometry: StrokeGeometry;
}

// ---- version stamp ---------------------------------------------------------------------------

function decodeStamp(b: Uint8Array): VersionStamp {
  const m = pb.parse(b);
  return { counter: pb.getNumber(m, 1) ?? 0, rand: pb.getNumber(m, 2) ?? 0 };
}
function encodeStamp(c: VersionStamp): pb.Message {
  const o: pb.Message = [];
  if (c.counter) o.push(pb.varint(1, c.counter));
  if (c.rand) o.push(pb.varint(2, c.rand));
  return o;
}

// ---- geometry --------------------------------------------------------------------------------

export function encodeGeometry(g: StrokeGeometry): Uint8Array {
  const values: TplValue[] = [g.version, g.width, g.nodeTypes, g.starts, g.quads, g.tail, g.widths];
  return lz4FrameEncode(tplEncode({ sig: STROKE_SIG, values }));
}

export function decodeGeometry(frame: Uint8Array): StrokeGeometry {
  const t = tplDecode(lz4FrameDecode(frame));
  if (t.sig !== STROKE_SIG) throw new Error('stroke: unsupported geometry signature ' + t.sig);
  const [version, width, nodeTypes, starts, quads, tail, widths] = t.values as [
    number,
    number,
    number[],
    [number, number][],
    [number, number, number, number][],
    number,
    number[],
  ];
  return { version, width, nodeTypes, starts, quads, tail, widths };
}

const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/**
 * Raw polyline → one moveTo + quadratic segments through the midpoints of consecutive points
 * (each input point except the first and last becomes a control point). Straight end pieces use
 * their own midpoint as control. A single point becomes a zero-length segment (a dot).
 */
export function polylineToGeometry(points: readonly { x: number; y: number }[], width: number): StrokeGeometry {
  if (points.length === 0) throw new Error('stroke: empty polyline');
  const p = points;
  const n = p.length;
  const quads: [number, number, number, number][] = [];
  const q = (c: { x: number; y: number }, e: { x: number; y: number }) => quads.push([c.x, c.y, e.x, e.y]);
  if (n === 1) q(p[0], p[0]);
  else {
    let cur = mid(p[0], p[1]);
    q(mid(p[0], cur), cur);
    for (let i = 1; i < n - 1; i++) {
      const next = mid(p[i], p[i + 1]);
      q(p[i], next);
      cur = next;
    }
    q(mid(cur, p[n - 1]), p[n - 1]);
  }
  return {
    version: 2,
    width,
    nodeTypes: [0, ...quads.map(() => 1)],
    starts: [[p[0].x, p[0].y]],
    quads,
    tail: 1,
    widths: [],
  };
}

/** Inverse of {@link polylineToGeometry} (exact up to float32 rounding). */
export function geometryToPolyline(g: StrokeGeometry): { x: number; y: number }[] {
  if (g.starts.length !== 1) throw new Error('stroke: expected exactly one moveTo');
  const [sx, sy] = g.starts[0];
  if (g.quads.length <= 1) return [{ x: sx, y: sy }];
  const pts = [{ x: sx, y: sy }];
  for (let i = 1; i < g.quads.length - 1; i++) pts.push({ x: g.quads[i][0], y: g.quads[i][1] });
  const last = g.quads[g.quads.length - 1];
  pts.push({ x: last[2], y: last[3] });
  return pts;
}

/** SVG path data of any stroke geometry. */
export function geometryToSvgPath(g: StrokeGeometry): string {
  let si = 0;
  let qi = 0;
  let d = '';
  const r = (x: number) => +x.toFixed(3);
  for (const t of g.nodeTypes) {
    if (t === 0) {
      const [x, y] = g.starts[si++];
      d += `M${r(x)} ${r(y)}`;
    } else if (t === 1) {
      const [cx, cy, x, y] = g.quads[qi++];
      d += `Q${r(cx)} ${r(cy)} ${r(x)} ${r(y)}`;
    } else throw new Error('stroke: unknown node type ' + t);
  }
  return d;
}

// ---- records ---------------------------------------------------------------------------------

export function encodeStrokeHeader(s: StrokeRecord): Uint8Array {
  const o: pb.Message = [pb.str(1, s.uuid), pb.msg(2, encodeStamp(s.clock))];
  if (s.deleted) o.push(pb.varint(3, 1));
  if (s.device) o.push(pb.varint(8, s.device));
  if (s.seq) o.push(pb.varint(9, s.seq));
  if (s.f14) o.push(pb.varint(14, s.f14));
  if (s.schema) o.push(pb.varint(16, s.schema));
  return pb.encode(o);
}

export function encodeStrokeBody(s: StrokeRecord): Uint8Array {
  const col: pb.Message = [];
  s.color.forEach((c, k) => {
    if (c !== 0) col.push(pb.fixed32(k + 1, f32Bytes(c)));
  });
  const z: pb.Message = [];
  if (s.z.index) z.push(pb.varint(1, s.z.index));
  if (s.z.rand) z.push(pb.varint(2, s.z.rand));
  const empty = new Uint8Array(0);
  const o: pb.Message = [
    pb.str(1, s.uuid),
    pb.bytes(2, encodeGeometry(s.geometry)),
    pb.msg(4, col),
    pb.bytes(6, empty),
    pb.msg(7, [pb.msg(1, z)]),
    pb.bytes(9, empty),
  ];
  if (s.deleted) o.push(pb.varint(14, 1));
  o.push(pb.msg(15, encodeStamp(s.clock)), pb.bytes(20, empty));
  if (s.schema) o.push(pb.varint(21, s.schema));
  return pb.encode([pb.msg(7, o)]);
}

export function decodeStrokeRecord(header: Uint8Array, body: Uint8Array): StrokeRecord {
  const h = pb.parse(header);
  const outer = pb.parse(body);
  if (outer.length !== 1 || outer[0].n !== 7 || outer[0].wt !== 2) {
    throw new Error('stroke: record body is not a stroke (field 7)');
  }
  const b = pb.parse(outer[0].v);
  const uuid = pb.getString(h, 1) ?? '';
  if (pb.getString(b, 1) !== uuid) throw new Error('stroke: header/body uuid mismatch');
  const colM = pb.getMessage(b, 4) ?? [];
  const color = [1, 2, 3, 4].map((n) => {
    const f = pb.get(colM, n);
    return f && f.wt === 5 ? readF32(f.v) : 0;
  }) as [number, number, number, number];
  const zOuter = pb.getMessage(b, 7) ?? [];
  const zm = pb.getMessage(zOuter, 1) ?? [];
  const clock = decodeStamp(pb.getBytes(h, 2) ?? new Uint8Array(0));
  return {
    uuid,
    clock,
    deleted: (pb.getNumber(h, 3) ?? 0) !== 0,
    device: pb.getVarint(h, 8) ?? 0n,
    seq: pb.getNumber(h, 9) ?? 0,
    f14: pb.getNumber(h, 14) ?? 0,
    schema: pb.getNumber(h, 16) ?? 0,
    color,
    z: { index: pb.getNumber(zm, 1) ?? 0, rand: pb.getNumber(zm, 2) ?? 0 },
    geometry: decodeGeometry(pb.getBytes(b, 2) ?? new Uint8Array(0)),
  };
}

export interface RawRecordPair {
  header: Uint8Array;
  body: Uint8Array;
}

export function splitNotesFile(buf: Uint8Array): RawRecordPair[] {
  const recs = pb.parseStream(buf);
  if (recs.length % 2) throw new Error('stroke: odd record count in notes file');
  const out: RawRecordPair[] = [];
  for (let i = 0; i < recs.length; i += 2) out.push({ header: recs[i], body: recs[i + 1] });
  return out;
}

export const decodeNotesFile = (buf: Uint8Array): StrokeRecord[] =>
  splitNotesFile(buf).map((r) => decodeStrokeRecord(r.header, r.body));

export function encodeNotesFile(pairs: readonly RawRecordPair[]): Uint8Array {
  return pb.encodeStream(pairs.flatMap((p) => [p.header, p.body]));
}

export function strokeToRaw(s: StrokeRecord): RawRecordPair {
  return { header: encodeStrokeHeader(s), body: encodeStrokeBody(s) };
}

/** True if re-encoding the decoded record reproduces the header byte for byte. */
export function headerRoundTrips(raw: RawRecordPair): boolean {
  return bytesEqual(encodeStrokeHeader(decodeStrokeRecord(raw.header, raw.body)), raw.header);
}
