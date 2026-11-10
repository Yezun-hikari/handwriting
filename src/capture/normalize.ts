import type { Glyph, Point, Stroke } from '../types.ts';
import type { FieldFrame } from './geometry.ts';
import { dedupeClose, simplifyRdp } from './simplify.ts';

export interface NormalizeOptions {
  /** Right side gap added to the ink width, glyph units. */
  rightGap: number;
  /** RDP tolerance in glyph units (0.004 ≈ 0.07 mm on the target paper). */
  epsilon: number;
  /** Decimal places kept for coordinates (3 = 1/1000 pitch). */
  precision: number;
}

export const DEFAULT_NORMALIZE: NormalizeOptions = { rightGap: 0.12, epsilon: 0.004, precision: 3 };

/** Minimal visible length for single-tap strokes (dots), glyph units. */
const DOT_LEN = 0.006;

const round = (v: number, d: number): number => {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r; // no -0
};

/**
 * Raw canvas-pixel strokes → glyph space (see types.ts): unit = pitch, baseline y = 0 (from the
 * field's guide), y down, x shifted so the leftmost ink is at 0, advance = ink width + rightGap.
 * Points are simplified (RDP) and rounded. Returns null if there is no ink.
 */
export function normalizeStrokes(
  raw: readonly (readonly Point[])[],
  frame: FieldFrame,
  opts: Partial<NormalizeOptions> = {},
): { strokes: Stroke[]; advance: number } | null {
  const o = { ...DEFAULT_NORMALIZE, ...opts };
  const strokes: Stroke[] = [];
  for (const s of raw) {
    if (!s.length) continue;
    let pts: Point[] = s.map((p) => {
      const q: Point = { x: p.x / frame.pitchPx, y: (p.y - frame.baselinePx) / frame.pitchPx };
      if (p.p !== undefined) q.p = p.p;
      return q;
    });
    pts = dedupeClose(pts, o.epsilon / 4);
    pts = simplifyRdp(pts, o.epsilon);
    strokes.push(pts);
  }
  if (!strokes.length) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  for (const s of strokes)
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }

  const out = strokes.map((s) => {
    const r = s.map((p) => {
      const q: Point = { x: round(p.x - minX, o.precision), y: round(p.y, o.precision) };
      if (p.p !== undefined) q.p = round(p.p, 2);
      return q;
    });
    // A tap (i-dot, period) yields one point: make it a tiny segment so renderers draw it.
    if (r.length === 1) r.push({ ...r[0], x: round(r[0].x + DOT_LEN, o.precision) });
    return r;
  });
  const width = maxX - minX + (strokes.some((s) => s.length === 1) ? DOT_LEN : 0);
  return { strokes: out, advance: round(width + o.rightGap, o.precision) };
}

/** Glyph space → canvas pixels (to show / keep editing an already saved glyph). */
export function denormalizeStrokes(glyph: Pick<Glyph, 'strokes'>, frame: FieldFrame): Point[][] {
  return glyph.strokes.map((s) =>
    s.map((p) => {
      const q: Point = { x: frame.originXPx + p.x * frame.pitchPx, y: frame.baselinePx + p.y * frame.pitchPx };
      if (p.p !== undefined) q.p = p.p;
      return q;
    }),
  );
}

/** Build a Glyph (NFC char) from raw field strokes; null if empty. */
export function buildGlyph(
  char: string,
  variant: number,
  raw: readonly (readonly Point[])[],
  frame: FieldFrame,
  opts: Partial<NormalizeOptions> = {},
): Glyph | null {
  const n = normalizeStrokes(raw, frame, opts);
  return n && { char: char.normalize('NFC'), variant, strokes: n.strokes, advance: n.advance };
}
