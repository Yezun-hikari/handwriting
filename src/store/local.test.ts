import { describe, expect, it } from 'vitest';
import { LocalGlyphStore } from './local.ts';
import { SupabaseGlyphStore, type SupabaseClientLike } from './supabase.ts';
import { parseLigatures } from '../capture/charset.ts';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const g = (char: string, variant: number) => ({ char, variant, strokes: [[{ x: 0, y: 0 }, { x: 0.2, y: -0.4, p: 0.5 }]], advance: 0.3 });

describe('LocalGlyphStore', () => {
  it('saves (upsert), loads and removes', async () => {
    const mem = new MemStorage();
    const s = new LocalGlyphStore(mem);
    await s.save(g('a', 0));
    await s.save(g('a', 1));
    await s.save({ ...g('a', 0), advance: 0.5 });
    let all = await s.load();
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.variant === 0)!.advance).toBe(0.5);
    await s.remove('a', 1);
    all = await new LocalGlyphStore(mem).load();
    expect(all).toEqual([{ ...g('a', 0), advance: 0.5 }]);
  });
  it('ignores corrupt or invalid data', async () => {
    const mem = new MemStorage();
    mem.setItem('handwriting-glyphs-local', '{nope');
    expect(await new LocalGlyphStore(mem).load()).toEqual([]);
    mem.setItem('handwriting-glyphs-local', JSON.stringify([g('b', 0), { char: 'x', variant: 'no' }, { ...g('c', 0), strokes: [[{ x: 'a' }]] }]));
    expect((await new LocalGlyphStore(mem).load()).map((x) => x.char)).toEqual(['b']);
  });
});

describe('SupabaseGlyphStore', () => {
  it('issues the expected queries', async () => {
    const calls: unknown[] = [];
    const filter = (data: unknown) => {
      const f = {
        eq(c: string, v: unknown) {
          calls.push(['eq', c, v]);
          return f;
        },
        then(res: (r: { data: unknown; error: null }) => unknown) {
          return Promise.resolve(res({ data, error: null }));
        },
      };
      return f as never;
    };
    const client: SupabaseClientLike = {
      from: (t) => {
        calls.push(['from', t]);
        return {
          select: (cols) => (calls.push(['select', cols]), filter([g('a', 0), { bad: 1 }])),
          upsert: (row, o) => (calls.push(['upsert', row.char, row.variant, row.user_id, o]), Promise.resolve({ data: null, error: null })),
          delete: () => (calls.push(['delete']), filter(null)),
        };
      },
    };
    const s = new SupabaseGlyphStore(client, 'u1');
    expect(await s.load()).toEqual([g('a', 0)]);
    await s.save(g('ü', 2));
    await s.remove('ü', 2);
    expect(calls).toContainEqual(['upsert', 'ü', 2, 'u1', { onConflict: 'user_id,char,variant' }]);
    expect(calls).toContainEqual(['eq', 'variant', 2]);
  });
});

describe('parseLigatures', () => {
  it('cleans the list', () => {
    expect(parseLigatures(' ch, ck  sch;x ch toolongg ei')).toEqual(['ch', 'ck', 'sch', 'ei']);
  });
});
