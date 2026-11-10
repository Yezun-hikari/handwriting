import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRoaming, loadSettings, parseRoaming, saveSettings, setRoamingSink, SETTINGS_KEY } from './settings.ts';

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
    expect(parseRoaming(null)).toEqual({});
  });
});
