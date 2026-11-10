import type { Glyph } from '../types.ts';

/** Persistence of captured glyphs. One record per (char, variant); `save` upserts. */
export interface GlyphStore {
  load(): Promise<Glyph[]>;
  save(g: Glyph): Promise<void>;
  remove(char: string, variant: number): Promise<void>;
}

export const glyphKey = (char: string, variant: number): string => `${char.normalize('NFC')}\u0000${variant}`;
