import { describe, expect, it } from 'vitest';
import type { Glyph } from '../types.ts';
import { allGlyphs, ensureLoaded, holdGlyphStore, setGlyphStore } from './repo.ts';
import type { GlyphStore } from './types.ts';

const g = (char: string): Glyph => ({ char, variant: 0, strokes: [], advance: 0.3 });
function store(glyphs: Glyph[], delay = 0): GlyphStore & { loads: number } {
  return {
    loads: 0,
    load() {
      this.loads++;
      return new Promise((r) => setTimeout(() => r(glyphs), delay));
    },
    save: async () => {},
    remove: async () => {},
  };
}

describe('repo store switching', () => {
  it('holds loading until the store is chosen, then loads only that store', async () => {
    const local = store([g('l')]);
    await setGlyphStore(local);
    holdGlyphStore(10_000);
    const remote = store([g('r')]);
    const early = ensureLoaded(); // a screen mounts before the account check finished
    await new Promise((r) => setTimeout(r, 5));
    expect(remote.loads).toBe(0);
    await setGlyphStore(remote);
    await early;
    expect(allGlyphs().map((x) => x.char)).toEqual(['r']);
    expect(remote.loads).toBe(1);
  });
  it('ignores a slow load of a store that was replaced meanwhile', async () => {
    const slow = store([g('old')], 30);
    const fast = store([g('new')], 0);
    const p1 = setGlyphStore(slow);
    await setGlyphStore(fast);
    await p1;
    expect(allGlyphs().map((x) => x.char)).toEqual(['new']);
  });
});
