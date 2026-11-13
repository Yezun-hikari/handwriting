import { describe, expect, it } from 'vitest';
import type { Glyph } from '../types.ts';
import { accountCacheKey, CachedGlyphStore, type AccountGlyphStore } from './cached.ts';
import { StoreError } from './errors.ts';

class Mem {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
}
const g = (char: string): Glyph => ({ char, variant: 0, strokes: [[{ x: 0, y: 0 }]], advance: 0.3 });

function remote(glyphs: Glyph[]): AccountGlyphStore & { fail: Error | null } {
  const rows = new Map(glyphs.map((x) => [x.char, x]));
  const r = {
    fail: null as Error | null,
    async load() {
      if (r.fail) throw r.fail;
      return [...rows.values()];
    },
    async save(x: Glyph) {
      if (r.fail) throw r.fail;
      rows.set(x.char, x);
    },
    async remove(c: string) {
      if (r.fail) throw r.fail;
      rows.delete(c);
    },
    async saveMany(xs: readonly Glyph[]) {
      for (const x of xs) await r.save(x);
    },
  };
  return r;
}

describe('CachedGlyphStore', () => {
  it('keeps a copy of every successful load and write, and serves it when offline', async () => {
    const mem = new Mem();
    const r = remote([g('a')]);
    const s = new CachedGlyphStore(r, mem, 'u1');
    await s.load();
    await s.save(g('b'));
    expect(s.fromCache).toBe(false);

    r.fail = new StoreError('offline');
    const offline = new CachedGlyphStore(r, mem, 'u1');
    expect((await offline.load()).map((x) => x.char).sort()).toEqual(['a', 'b']);
    expect(offline.fromCache).toBe(true);
    await expect(offline.save(g('c'))).rejects.toThrow(); // writes are not queued
  });

  it('a fetch TypeError counts as offline too', async () => {
    const mem = new Mem();
    await new CachedGlyphStore(remote([g('a')]), mem, 'u1').load();
    const r = remote([]);
    r.fail = new TypeError('Failed to fetch');
    expect(await new CachedGlyphStore(r, mem, 'u1').load()).toHaveLength(1);
  });

  it('rethrows when there is no copy, or the error is not about the network', async () => {
    const mem = new Mem();
    const r = remote([]);
    r.fail = new StoreError('offline');
    await expect(new CachedGlyphStore(r, mem, 'u1').load()).rejects.toThrow(StoreError);

    await new CachedGlyphStore(remote([g('a')]), mem, 'u1').load();
    r.fail = new StoreError('forbidden');
    await expect(new CachedGlyphStore(r, mem, 'u1').load()).rejects.toThrow(StoreError);
  });

  it('copies are per account', async () => {
    const mem = new Mem();
    await new CachedGlyphStore(remote([g('a')]), mem, 'u1').load();
    expect(mem.getItem(accountCacheKey('u1'))).toContain('"a"');
    expect(mem.getItem(accountCacheKey('u2'))).toBeNull();
  });
});
