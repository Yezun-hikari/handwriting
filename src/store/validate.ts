import type { Glyph, Point, Stroke } from '../types.ts';

/**
 * Limits of the account tables' check constraints (konto repo, supabase/migrations/*_handwriting.sql):
 * `char_length(char) between 1 and 8` (Postgres counts characters = Unicode code points, not UTF-16 units),
 * `variant between 0 and 9`, `advance between 0 and 10`, `pg_column_size(strokes) <= 65536`,
 * settings jsonb `pg_column_size(settings) <= 16384`. Local data is validated with the same char/variant limits so
 * nothing exists in this browser that could never move into an account.
 */
export const DB_LIMITS = {
  charMin: 1,
  charMax: 8,
  variantMin: 0,
  variantMax: 9,
  advanceMin: 0,
  advanceMax: 10,
  /** JSON text length of strokes; below 64 KiB to leave room for jsonb overhead. */
  strokesJsonMax: 60_000,
  /** UTF-8 bytes of the settings JSON; below 16 KiB to leave room for jsonb overhead. */
  settingsBytesMax: 15_000,
} as const;

/** Number of characters as Postgres char_length() counts them (code points). */
export const charLength = (s: string): number => [...s].length;

export const validChar = (s: unknown): s is string => {
  if (typeof s !== 'string') return false;
  const n = charLength(s.normalize('NFC'));
  return n >= DB_LIMITS.charMin && n <= DB_LIMITS.charMax;
};

export const validVariant = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= DB_LIMITS.variantMin && (v as number) <= DB_LIMITS.variantMax;

/** UTF-8 size of a value's JSON text (approximation of its jsonb column size). */
export function jsonBytes(v: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(v) ?? '').length;
  } catch {
    return Infinity; // cyclic / BigInt
  }
}

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
  if (!validChar(o.char) || !validVariant(o.variant)) return null;
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
