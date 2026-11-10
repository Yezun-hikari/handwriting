import { describe, expect, it } from 'vitest';
import type { Glyph } from '../types.ts';
import {
  allGlyphs,
  ensureLoaded,
  getGlyph,
  glyphStoreGeneration,
  holdGlyphStore,
  onBeforeStoreSwitch,
  onGlyphsChange,
  removeGlyph,
  saveGlyph,
  setGlyphStore,
} from './repo.ts';
import type { GlyphStore } from './types.ts';

const g = (char: string, advance = 0.3): Glyph => ({ char, variant: 0, strokes: [], advance });
type TestStore = GlyphStore & { loads: number; saved: string[]; removed: string[] };
function store(glyphs: Glyph[], delay = 0): TestStore {
  return {
    loads: 0,
    saved: [],
    removed: [],
    load() {
      this.loads++;
      return new Promise((r) => setTimeout(() => r(glyphs), delay));
    },
    async save(x) {
      this.saved.push(x.char);
    },
    async remove(c) {
      this.removed.push(c);
    },
  };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

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
  it('a caller of a superseded load waits for the new store, not just the stale one', async () => {
    const slow = store([g('old')], 10);
    const fast = store([g('new')], 30);
    const p1 = setGlyphStore(slow);
    await tick(1);
    void setGlyphStore(fast);
    await p1;
    expect(allGlyphs().map((x) => x.char)).toEqual(['new']);
  });
});

describe('repo store switch: flushing and refilling', () => {
  it('runs switch hooks while the OLD store is active, so flushed saves land there', async () => {
    const local = store([]);
    const account = store([g('a')]);
    await setGlyphStore(local);
    const off = onBeforeStoreSwitch(() => void saveGlyph(g('pending')));
    const gen = glyphStoreGeneration();
    await setGlyphStore(account);
    off();
    expect(local.saved).toEqual(['pending']);
    expect(account.saved).toEqual([]);
    expect(glyphStoreGeneration()).toBe(gen + 1);
    // the stale local glyph is not part of the account's cache
    expect(allGlyphs().map((x) => x.char)).toEqual(['a']);
  });
  it('the same holds on logout (account → local)', async () => {
    const account = store([]);
    const local = store([g('l')]);
    await setGlyphStore(account);
    const off = onBeforeStoreSwitch(() => void removeGlyph('x', 0));
    await setGlyphStore(local);
    off();
    expect(account.removed).toEqual(['x']);
    expect(local.removed).toEqual([]);
    expect(allGlyphs().map((x) => x.char)).toEqual(['l']);
  });
  it('a save racing with a switch still goes to the store active when it was issued', async () => {
    let release!: () => void;
    const local = store([]);
    local.save = function (x) {
      this.saved.push(x.char);
      return new Promise<void>((r) => (release = r));
    };
    await setGlyphStore(local);
    const p = saveGlyph(g('s'));
    const account = store([]);
    await setGlyphStore(account);
    release();
    await p;
    expect(local.saved).toEqual(['s']);
    expect(account.saved).toEqual([]);
  });
  it('listeners see the generation change first with an empty cache, then the new glyphs', async () => {
    await setGlyphStore(store([g('old')]));
    const seen: string[][] = [];
    const off = onGlyphsChange(() => seen.push(allGlyphs().map((x) => x.char)));
    await setGlyphStore(store([g('new')], 5));
    off();
    expect(seen).toEqual([[], ['new']]);
  });
});

describe('repo writes during an in-flight load', () => {
  it('keeps glyphs saved while the load was running (newer than the load result)', async () => {
    const s = store([g('a', 0.1), g('b')], 20);
    const p = setGlyphStore(s);
    await tick(1);
    await saveGlyph(g('a', 0.9));
    await saveGlyph(g('c'));
    await p;
    expect(getGlyph('a', 0)?.advance).toBe(0.9);
    expect(allGlyphs().map((x) => x.char).sort()).toEqual(['a', 'b', 'c']);
  });
  it('keeps removals made while the load was running', async () => {
    const s = store([g('a'), g('b')], 20);
    const p = setGlyphStore(s);
    await tick(1);
    await removeGlyph('a', 0);
    await p;
    expect(allGlyphs().map((x) => x.char)).toEqual(['b']);
  });
  it('writes made for a previous store are not merged into the next store', async () => {
    const first = store([], 20);
    const p1 = setGlyphStore(first);
    await saveGlyph(g('stale'));
    await setGlyphStore(store([g('n')]));
    await p1;
    expect(allGlyphs().map((x) => x.char)).toEqual(['n']);
  });
});
