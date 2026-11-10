import { describe, expect, it } from 'vitest';
import { FakeDb } from './__fakes__/fake-db.ts';
import { classifyPgError, describeStoreError, STORE_MSG, StoreError } from './errors.ts';
import { SupabaseSettingsStore } from './supabase-settings.ts';
import { fitsAccount, GLYPH_TABLE, SupabaseGlyphStore, UPLOAD_CHUNK } from './supabase.ts';

const g = (char: string, variant: number, advance = 0.3) => ({ char, variant, strokes: [[{ x: 0, y: 0 }, { x: 0.2, y: -0.4 }]], advance });

describe('SupabaseGlyphStore', () => {
  it('loads own rows, upserts, removes', async () => {
    const db = new FakeDb();
    db.rows(GLYPH_TABLE).push({ user_id: 'u1', ...g('a', 0) }, { user_id: 'u2', ...g('b', 0) }, { user_id: 'u1', bad: 1 });
    const s = new SupabaseGlyphStore(db.client(), 'u1');
    expect(await s.load()).toEqual([g('a', 0)]);
    await s.save(g('ü', 2));
    await s.save(g('ü', 2, 0.5));
    expect(db.rows(GLYPH_TABLE).filter((r) => r.char === 'ü')).toEqual([{ user_id: 'u1', ...g('ü', 2, 0.5) }]);
    await s.remove('ü', 2);
    expect(db.rows(GLYPH_TABLE).some((r) => r.char === 'ü')).toBe(false);
    expect(db.calls).toContainEqual(['upsert', 1, 'user_id,char,variant']);
    expect(db.calls).toContainEqual(['eq', 'variant', 2]);
  });

  it('saveMany uploads in chunks with progress', async () => {
    const db = new FakeDb();
    const s = new SupabaseGlyphStore(db.client(), 'u1');
    const many = Array.from({ length: UPLOAD_CHUNK * 2 + 3 }, (_, i) => g(`c${i}`, 0));
    const progress: number[] = [];
    await s.saveMany(many, (n) => progress.push(n));
    expect(db.rows(GLYPH_TABLE)).toHaveLength(many.length);
    expect(progress).toEqual([UPLOAD_CHUNK, UPLOAD_CHUNK * 2, many.length]);
  });

  it('maps RLS / session / network errors to German StoreErrors', async () => {
    const db = new FakeDb();
    const s = new SupabaseGlyphStore(db.client(), 'u1');
    db.failWith = { error: { message: 'new row violates row-level security policy for table "handwriting_glyphs"', code: '42501' }, status: 403 };
    await expect(s.save(g('a', 0))).rejects.toMatchObject({ kind: 'forbidden', message: STORE_MSG.forbidden });
    db.failWith = { error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 };
    await expect(s.load()).rejects.toMatchObject({ kind: 'session' });
    db.failWith = { error: { message: 'TypeError: Failed to fetch' }, status: 0 };
    await expect(s.remove('a', 0)).rejects.toMatchObject({ kind: 'offline' });
  });
});

describe('error texts', () => {
  it('classifies', () => {
    expect(classifyPgError({ code: '42501', message: 'x' })).toBe('forbidden');
    expect(classifyPgError({ code: '23514', message: 'violates check constraint' }, 400)).toBe('server');
    expect(describeStoreError(new StoreError('offline'))).toBe(STORE_MSG.offline);
    expect(describeStoreError(new TypeError('Failed to fetch'))).toBe(STORE_MSG.offline);
    expect(describeStoreError({ name: 'QuotaExceededError' })).toBe(STORE_MSG.quota);
    expect(describeStoreError('??')).toBe(STORE_MSG.server);
  });
});

describe('fitsAccount', () => {
  it('follows the table constraints', () => {
    expect(fitsAccount(g('sch', 2))).toBe(true);
    expect(fitsAccount(g('a', 3))).toBe(false);
    expect(fitsAccount(g('abcde', 0))).toBe(false);
    expect(fitsAccount(g('a', 0, 11))).toBe(false);
  });
});

describe('SupabaseSettingsStore', () => {
  it('returns null without row, saves and reloads valid fields only', async () => {
    const db = new FakeDb();
    const s = new SupabaseSettingsStore(db.client(), 'u1');
    expect(await s.load()).toBeNull();
    await s.save({ ligatures: ['ch'], rightGap: 0.2, headingWidthMm: 0.8, bodyWidthMm: 0.3 });
    expect(await s.load()).toEqual({ ligatures: ['ch'], rightGap: 0.2, headingWidthMm: 0.8, bodyWidthMm: 0.3 });
    db.rows('handwriting_settings')[0].settings = { rightGap: 'x', bodyWidthMm: 0.5, inputMode: 'pen' };
    expect(await s.load()).toEqual({ bodyWidthMm: 0.5 });
    expect(db.calls).toContainEqual(['upsert', 1, 'user_id']);
  });
});
