import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRoaming,
  clampPenMm,
  fitsAccountSettings,
  loadSettings,
  parseRoaming,
  sanitizeRoaming,
  saveSettings,
  setRoamingSink,
  SETTINGS_KEY,
} from './settings.ts';
import { FakeDb } from './__fakes__/fake-db.ts';
import { SETTINGS_TABLE, SupabaseSettingsStore } from './supabase-settings.ts';

beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
  setRoamingSink(null);
});

describe('settings split', () => {
  it('only roaming changes reach the sink; input mode stays local', () => {
    const sink = vi.fn();
    setRoamingSink(sink);
    saveSettings({ inputMode: 'pen' });
    expect(sink).not.toHaveBeenCalled();
    saveSettings({ rightGap: 0.2 });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ rightGap: 0.2 }));
    expect(sink.mock.calls[0][0]).not.toHaveProperty('inputMode');
  });
  it('applyRoaming takes valid account values, keeps input mode, does not echo', () => {
    saveSettings({ inputMode: 'any' });
    const sink = vi.fn();
    setRoamingSink(sink);
    expect(applyRoaming({ rightGap: 0.25, ligatures: ['sch'] })).toBe(true);
    expect(applyRoaming({ rightGap: 0.25 })).toBe(false);
    expect(loadSettings()).toMatchObject({ rightGap: 0.25, ligatures: ['sch'], inputMode: 'any' });
    expect(sink).not.toHaveBeenCalled();
    expect(localStorage.getItem(SETTINGS_KEY)).toContain('0.25');
  });
  it('parseRoaming drops invalid fields', () => {
    expect(parseRoaming({ rightGap: 5, ligatures: [1], bodyWidthMm: 0.4, inputMode: 'pen' })).toEqual({ bodyWidthMm: 0.4 });
    expect(parseRoaming({ paper: 'grid-yellow' })).toEqual({ paper: 'grid-yellow' });
    expect(parseRoaming({ paper: 'toString' })).toEqual({});
    expect(parseRoaming(null)).toEqual({});
  });
  it('parseRoaming rejects oversized objects and over-long ligatures (code points)', () => {
    expect(parseRoaming({ rightGap: 0.2, junk: 'x'.repeat(20_000) })).toEqual({});
    expect(parseRoaming({ ligatures: ['abcdefghi'] })).toEqual({});
    expect(parseRoaming({ ligatures: ['😀😀'] })).toEqual({ ligatures: ['😀😀'] });
  });
});

describe('pen widths', () => {
  it('clampPenMm keeps 0.1..2 mm', () => {
    expect(clampPenMm(5, 0.35)).toBe(2);
    expect(clampPenMm(0.01, 0.35)).toBe(0.1);
    expect(clampPenMm('0.5', 0.35)).toBe(0.5);
    expect(clampPenMm('', 0.35)).toBe(0.35);
    expect(clampPenMm(NaN, 0.35)).toBe(0.35);
    expect(clampPenMm(-1, 0.35)).toBe(0.35);
  });
  it('saveSettings clamps before storing and before the roaming sink', () => {
    const sink = vi.fn();
    setRoamingSink(sink);
    const s = saveSettings({ headingWidthMm: 9, bodyWidthMm: 0 });
    expect(s.headingWidthMm).toBe(2);
    expect(s.bodyWidthMm).toBe(0.35); // invalid → previous value
    expect(loadSettings().headingWidthMm).toBe(2);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ headingWidthMm: 2 }));
  });
  it('the account store saves sanitized settings that fit the table', async () => {
    const db = new FakeDb();
    const st = new SupabaseSettingsStore(db.client(), 'u1');
    await st.save({ ligatures: ['sch', 'abcdefghi'], rightGap: 0.1, headingWidthMm: 7, bodyWidthMm: 0.05, paper: 'nope' as never });
    expect(db.rows(SETTINGS_TABLE)[0].settings).toEqual({ ligatures: ['sch'], rightGap: 0.1, headingWidthMm: 2, bodyWidthMm: 0.1, paper: 'ruled-yellow' });
    expect(fitsAccountSettings(sanitizeRoaming({ ligatures: [], rightGap: 0, headingWidthMm: 1, bodyWidthMm: 1, paper: 'wide-white' }))).toBe(true);
  });
});
