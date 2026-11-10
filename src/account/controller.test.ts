import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@yezun/konto';
import { LocalGlyphStore } from '../store/local.ts';
import { FakeDb } from '../store/__fakes__/fake-db.ts';
import type { MergePlan } from '../store/merge.ts';
import type { RoamingSettings } from '../store/settings.ts';
import { SupabaseGlyphStore } from '../store/supabase.ts';
import type { GlyphStore } from '../store/types.ts';
import { AccountController, chipLabel, mergeMemoryKey, stateFor, storageHintText, type AccountDeps, type MergeDecision } from './controller.ts';

class Mem {
  m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
}
const g = (char: string, variant: number, x = 0.2) => ({ char, variant, strokes: [[{ x: 0, y: 0 }, { x, y: -0.4 }]], advance: 0.3 });
const REG: AuthUser = { id: 'u1', username: 'anna', isGuest: false };
const GUEST: AuthUser = { id: 'g1', username: null, isGuest: true };
const DEFAULT_ROAMING: RoamingSettings = { ligatures: ['ch'], rightGap: 0.12, headingWidthMm: 0.7, bodyWidthMm: 0.35, paper: 'ruled-yellow' };

function setup(opts: { configured?: boolean; user?: AuthUser | null; local?: ReturnType<typeof g>[]; decision?: MergeDecision } = {}) {
  const db = new FakeDb();
  const localMem = new Mem();
  const local = new LocalGlyphStore(localMem);
  for (const x of opts.local ?? []) void local.save(x);
  let authCb: ((u: AuthUser | null) => void) | null = null;
  let roaming = { ...DEFAULT_ROAMING };
  let sink: ((s: RoamingSettings) => void) | null = null;
  const stores: GlyphStore[] = [];
  const asked: MergePlan[] = [];
  const notes: [string, string][] = [];
  const states: string[] = [];
  const memory = new Mem();
  let user = opts.user ?? null;
  const deps: AccountDeps = {
    configured: opts.configured ?? true,
    readUser: async () => user,
    onAuthChange: (cb) => ((authCb = cb), () => (authCb = null)),
    getClient: () => db.client(),
    setGlyphStore: async (s) => {
      stores.push(s);
      await s.load();
    },
    localStore: local,
    settings: {
      current: () => roaming,
      apply: (s) => {
        const next = { ...roaming, ...s };
        const changed = JSON.stringify(next) !== JSON.stringify(roaming);
        roaming = next;
        return changed;
      },
      setSink: (fn) => (sink = fn),
    },
    askMerge: async (plan) => (asked.push(plan), opts.decision ?? 'upload'),
    memory,
    onState: (s) => states.push(s.status),
    onSettingsApplied: vi.fn(),
    notify: (m, k) => void notes.push([k, m]),
    settingsDebounceMs: 0,
  };
  const c = new AccountController(deps);
  return {
    c, db, deps, local, stores, asked, notes, states, memory,
    login: (u: AuthUser | null) => ((user = u), authCb?.(u), c.idle),
    setUser: (u: AuthUser | null) => (user = u),
    roaming: () => roaming,
    sink: () => sink,
  };
}

describe('state & texts', () => {
  it('derives the state', () => {
    expect(stateFor(REG, false).status).toBe('unconfigured');
    expect(stateFor(null, true).status).toBe('signedOut');
    expect(stateFor(GUEST, true)).toEqual({ status: 'guest', userId: 'g1' });
    expect(stateFor(REG, true)).toEqual({ status: 'registered', userId: 'u1', username: 'anna' });
    expect(chipLabel(stateFor(REG, true))).toBe('anna');
    expect(chipLabel(stateFor(GUEST, true))).toBe('Gast');
    expect(chipLabel(stateFor(null, true))).toBe('nicht angemeldet');
    expect(storageHintText(stateFor(GUEST, true))).toMatch(/^Nur registrierte Konten/);
    expect(storageHintText(stateFor(null, true))).toMatch(/Nur registrierte Konten/);
  });
});

describe('store selection', () => {
  it('unconfigured → local store, no auth subscription', async () => {
    const t = setup({ configured: false, user: REG });
    await t.c.start();
    expect(t.stores).toEqual([t.local]);
    expect(t.states).toEqual(['unconfigured']);
  });
  it('signed out and guest → local store', async () => {
    const t = setup({ user: null });
    await t.c.start();
    expect(t.stores).toEqual([t.local]);
    await t.login(GUEST);
    expect(t.stores).toEqual([t.local, t.local]);
    expect(t.states).toEqual(['signedOut', 'guest']);
    expect(t.db.calls).toEqual([]); // guests never touch the server tables
  });
  it('registered → Supabase store for that user; sign-out → back to local', async () => {
    const t = setup({ user: REG });
    await t.c.start();
    expect(t.stores[0]).toBeInstanceOf(SupabaseGlyphStore);
    expect((t.stores[0] as SupabaseGlyphStore).userId).toBe('u1');
    await t.login(null);
    expect(t.stores.at(-1)).toBe(t.local);
    expect(t.sink()).toBeNull();
  });
  it('ignores repeated events for the same user; refresh picks up a login from the account page', async () => {
    const t = setup({ user: null });
    await t.c.start();
    await t.login(null);
    expect(t.stores).toHaveLength(1);
    t.setUser(REG);
    await t.c.refresh();
    expect(t.states).toEqual(['signedOut', 'registered']);
    expect(t.stores.at(-1)).toBeInstanceOf(SupabaseGlyphStore);
  });
  it('load error in the account → German notice, no merge offer', async () => {
    const t = setup({ user: REG, local: [g('a', 0)] });
    t.db.failWith = { error: { message: 'Failed to fetch' }, status: 0 };
    await t.c.start();
    expect(t.notes[0][0]).toBe('error');
    expect(t.notes[0][1]).toMatch(/konnte nicht geladen werden.*Keine Verbindung/);
    expect(t.asked).toHaveLength(0);
  });
});

describe('settings roaming', () => {
  it('account settings win; changes are pushed back', async () => {
    const t = setup({ user: REG });
    t.db.rows('handwriting_settings').push({ user_id: 'u1', settings: { rightGap: 0.3, ligatures: ['sch'] } });
    await t.c.start();
    expect(t.roaming().rightGap).toBe(0.3);
    expect(t.deps.onSettingsApplied).toHaveBeenCalledOnce();
    t.sink()!({ ...t.roaming(), bodyWidthMm: 0.5 });
    await new Promise((r) => setTimeout(r, 5));
    expect((t.db.rows('handwriting_settings')[0].settings as RoamingSettings).bodyWidthMm).toBe(0.5);
  });
  it('first sign-in uploads this device’s settings', async () => {
    const t = setup({ user: REG });
    await t.c.start();
    expect(t.db.rows('handwriting_settings')).toEqual([{ user_id: 'u1', settings: DEFAULT_ROAMING }]);
    expect(t.deps.onSettingsApplied).not.toHaveBeenCalled();
  });
});

describe('upload of local glyphs after sign-in', () => {
  const remoteRows = (t: ReturnType<typeof setup>) => t.db.rows('handwriting_glyphs');

  it('no local glyphs → no question', async () => {
    const t = setup({ user: REG });
    await t.c.start();
    expect(t.asked).toHaveLength(0);
  });

  it('uploads only new glyphs by default, keeps differing account glyphs, remembers the decision', async () => {
    const t = setup({ user: REG, local: [g('a', 0, 0.9), g('b', 0), g('c', 1)] });
    remoteRows(t).push({ user_id: 'u1', ...g('a', 0) });
    await t.c.start();
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0].add).toHaveLength(2);
    expect(t.asked[0].conflicts).toHaveLength(1);
    expect(remoteRows(t)).toHaveLength(3);
    expect(remoteRows(t).find((r) => r.char === 'a')!.strokes).toEqual(g('a', 0).strokes); // not overwritten
    expect(t.notes).toContainEqual(['info', '2 Zeichen ins Konto übernommen.']);
    expect(t.stores.at(-1)).toBeInstanceOf(SupabaseGlyphStore); // cache reloaded
    expect(t.memory.getItem(mergeMemoryKey('u1'))).toBeTruthy();
    // next sign-in with the same local set: no question again
    await t.login(null);
    await t.login(REG);
    expect(t.asked).toHaveLength(1);
  });

  it('overwrite replaces differing glyphs only when chosen', async () => {
    const t = setup({ user: REG, local: [g('a', 0, 0.9)], decision: 'overwrite' });
    remoteRows(t).push({ user_id: 'u1', ...g('a', 0) });
    await t.c.start();
    expect(remoteRows(t)[0].strokes).toEqual(g('a', 0, 0.9).strokes);
  });

  it('"later" asks again next time, "skip" does not', async () => {
    const later = setup({ user: REG, local: [g('a', 0)], decision: 'later' });
    await later.c.start();
    await later.login(null);
    await later.login(REG);
    expect(later.asked).toHaveLength(2);
    expect(remoteRows(later)).toHaveLength(0);

    const skip = setup({ user: REG, local: [g('a', 0)], decision: 'skip' });
    await skip.c.start();
    await skip.login(null);
    await skip.login(REG);
    expect(skip.asked).toHaveLength(1);
    expect(remoteRows(skip)).toHaveLength(0);
  });

  it('upload rejected by RLS → German error, decision not remembered', async () => {
    const t = setup({ user: REG, local: [g('a', 0)] });
    t.db.failOn = 'upsert';
    t.db.failWith = { error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 };
    await t.c.start();
    const err = t.notes.find(([k, m]) => k === 'error' && m.startsWith('Hochladen fehlgeschlagen'));
    expect(err?.[1]).toMatch(/Nur registrierte Konten/);
    expect(t.memory.getItem(mergeMemoryKey('u1'))).toBeNull();
  });

  it('identical sets need no question', async () => {
    const t = setup({ user: REG, local: [g('a', 0)] });
    remoteRows(t).push({ user_id: 'u1', ...g('a', 0) });
    await t.c.start();
    expect(t.asked).toHaveLength(0);
  });
});
