import { describe, expect, it } from 'vitest';
import { DB_LIMITS, toGlyph, validChar, validVariant } from './validate.ts';

const raw = (char: unknown, variant: unknown) => ({ char, variant, strokes: [[{ x: 0, y: 0 }]], advance: 0.3 });

describe('toGlyph limits match the account table', () => {
  it('counts characters as code points like Postgres char_length (1..4)', () => {
    expect(toGlyph(raw('a', 0))).not.toBeNull();
    expect(toGlyph(raw('😀😀😀😀', 0))).not.toBeNull(); // 4 code points, 8 UTF-16 units
    expect(toGlyph(raw('abcd', 0))).not.toBeNull();
    expect(toGlyph(raw('abcde', 0))).toBeNull();
    expect(toGlyph(raw('', 0))).toBeNull();
    expect(validChar('ä')).toBe(true); // NFC → 'ä', 1 code point
  });
  it('accepts variants 0..2 only', () => {
    expect(validVariant(DB_LIMITS.variantMax)).toBe(true);
    expect(toGlyph(raw('a', 2))).not.toBeNull();
    expect(toGlyph(raw('a', 3))).toBeNull();
    expect(toGlyph(raw('a', -1))).toBeNull();
    expect(toGlyph(raw('a', 1.5))).toBeNull();
  });
});
