import { describe, expect, it } from 'vitest';
import { DB_LIMITS, toGlyph, validChar, validVariant } from './validate.ts';

const raw = (char: unknown, variant: unknown) => ({ char, variant, strokes: [[{ x: 0, y: 0 }]], advance: 0.3 });

describe('toGlyph limits match the account table', () => {
  it('counts characters as code points like Postgres char_length (1..8)', () => {
    expect(toGlyph(raw('a', 0))).not.toBeNull();
    expect(toGlyph(raw('😀😀😀😀😀😀😀😀', 0))).not.toBeNull(); // 8 code points, 16 UTF-16 units
    expect(toGlyph(raw('abcdefgh', 0))).not.toBeNull();
    expect(toGlyph(raw('abcdefghi', 0))).toBeNull();
    expect(toGlyph(raw('', 0))).toBeNull();
    expect(validChar('ä')).toBe(true); // NFC → 'ä', 1 code point
  });
  it('accepts variants 0..9 only', () => {
    expect(validVariant(DB_LIMITS.variantMax)).toBe(true);
    expect(toGlyph(raw('a', 9))).not.toBeNull();
    expect(toGlyph(raw('a', 10))).toBeNull();
    expect(toGlyph(raw('a', -1))).toBeNull();
    expect(toGlyph(raw('a', 1.5))).toBeNull();
  });
});
