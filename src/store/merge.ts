import type { Glyph } from '../types.ts';
import { fitsAccount } from './supabase.ts';
import { glyphKey } from './types.ts';

/**
 * Plan for uploading this browser's glyphs into an account after sign-in.
 * Never overwrites account glyphs silently: a (char, variant) that exists in both with different strokes is a
 * *conflict* and is only uploaded when the user explicitly agrees.
 */
export interface MergePlan {
  /** Local glyphs whose (char, variant) is not in the account yet – safe to upload. */
  add: Glyph[];
  /** Local glyphs whose (char, variant) is in the account with a different drawing. */
  conflicts: Glyph[];
  /** Local glyphs identical to the account's copy. */
  same: number;
  /** Local glyphs the account cannot store (outside the table's limits). */
  unsupported: number;
  /** Glyphs in the account before the merge. */
  remoteCount: number;
}

const EPS = 1e-4; // `advance` is a float4 column: compare with tolerance
const r6 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function sameGlyph(a: Glyph, b: Glyph): boolean {
  if (Math.abs(a.advance - b.advance) > EPS || a.strokes.length !== b.strokes.length) return false;
  for (let i = 0; i < a.strokes.length; i++) {
    const s = a.strokes[i];
    const t = b.strokes[i];
    if (s.length !== t.length) return false;
    for (let j = 0; j < s.length; j++) if (r6(s[j].x) !== r6(t[j].x) || r6(s[j].y) !== r6(t[j].y)) return false;
  }
  return true;
}

export function planMerge(local: readonly Glyph[], remote: readonly Glyph[]): MergePlan {
  const remoteMap = new Map(remote.map((g) => [glyphKey(g.char, g.variant), g]));
  const plan: MergePlan = { add: [], conflicts: [], same: 0, unsupported: 0, remoteCount: remote.length };
  for (const g of local) {
    if (!fitsAccount(g)) {
      plan.unsupported++;
      continue;
    }
    const r = remoteMap.get(glyphKey(g.char, g.variant));
    if (!r) plan.add.push(g);
    else if (sameGlyph(g, r)) plan.same++;
    else plan.conflicts.push(g);
  }
  return plan;
}

/** Glyphs to upload for a decision. */
export const glyphsToUpload = (plan: MergePlan, overwrite: boolean): Glyph[] =>
  overwrite ? [...plan.add, ...plan.conflicts] : [...plan.add];

/** True if there is anything worth asking the user about. */
export const needsDecision = (plan: MergePlan): boolean => plan.add.length + plan.conflicts.length > 0;

/**
 * Fingerprint of a local glyph set, used to remember "already asked" per account: the question comes back only when
 * the local glyphs changed since. Cheap FNV-1a over keys + advances + point counts.
 */
export function localFingerprint(glyphs: readonly Glyph[]): string {
  const parts = glyphs
    .map((g) => `${glyphKey(g.char, g.variant)}:${g.advance.toFixed(4)}:${g.strokes.map((s) => s.length).join('.')}`)
    .sort();
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${glyphs.length}-${h.toString(16)}`;
}
