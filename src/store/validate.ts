import type { Glyph, Point, Stroke } from '../types.ts';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function toPoint(v: unknown): Point | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isNum(o.x) || !isNum(o.y)) return null;
  const p: Point = { x: o.x, y: o.y };
  if (isNum(o.p)) p.p = o.p;
  return p;
}

/** Defensive parse of untrusted data (storage, network) into a Glyph; null if invalid. */
export function toGlyph(v: unknown): Glyph | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.char !== 'string' || !o.char || o.char.length > 16) return null;
  if (!Number.isInteger(o.variant) || (o.variant as number) < 0 || (o.variant as number) > 99) return null;
  if (!isNum(o.advance) || !Array.isArray(o.strokes)) return null;
  const strokes: Stroke[] = [];
  for (const s of o.strokes) {
    if (!Array.isArray(s)) return null;
    const pts: Point[] = [];
    for (const p of s) {
      const q = toPoint(p);
      if (!q) return null;
      pts.push(q);
    }
    strokes.push(pts);
  }
  return { char: o.char.normalize('NFC'), variant: o.variant as number, strokes, advance: o.advance };
}
