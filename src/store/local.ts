import type { Glyph } from '../types.ts';
import { glyphKey, type GlyphStore } from './types.ts';
import { toGlyph } from './validate.ts';

export const LOCAL_KEY = 'handwriting-glyphs-local';

/** Minimal Storage subset (window.localStorage, or a fake in tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Glyphs as one JSON array in localStorage (no account needed; ~ 300 glyphs ≈ 0.5–1 MB). */
export class LocalGlyphStore implements GlyphStore {
  constructor(
    private readonly storage: KeyValueStorage = localStorage,
    private readonly key = LOCAL_KEY,
  ) {}

  private read(): Map<string, Glyph> {
    const map = new Map<string, Glyph>();
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return map;
    }
    if (!raw) return map;
    try {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr))
        for (const v of arr) {
          const g = toGlyph(v);
          if (g) map.set(glyphKey(g.char, g.variant), g);
        }
    } catch {
      /* corrupt: start empty */
    }
    return map;
  }

  private write(map: Map<string, Glyph>): void {
    // Throws QuotaExceededError when full; the caller shows it.
    this.storage.setItem(this.key, JSON.stringify([...map.values()]));
  }

  async load(): Promise<Glyph[]> {
    return [...this.read().values()];
  }

  async save(g: Glyph): Promise<void> {
    const map = this.read();
    map.set(glyphKey(g.char, g.variant), g);
    this.write(map);
  }

  async remove(char: string, variant: number): Promise<void> {
    const map = this.read();
    if (map.delete(glyphKey(char, variant))) this.write(map);
  }
}
