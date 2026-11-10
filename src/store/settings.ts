import { DEFAULT_LIGATURES } from '../capture/charset.ts';
import type { InputMode } from '../capture/input-policy.ts';

/** Per-device UI settings (not synced). */
export interface Settings {
  ligatures: string[];
  /** Right gap added to each glyph's ink width, glyph units (pitch). */
  rightGap: number;
  inputMode: InputMode;
  /** Convert page: stroke widths in mm. */
  headingWidthMm: number;
  bodyWidthMm: number;
}

export const SETTINGS_KEY = 'handwriting-settings';

export const DEFAULT_SETTINGS: Settings = {
  ligatures: [...DEFAULT_LIGATURES],
  rightGap: 0.12,
  inputMode: 'auto',
  headingWidthMm: 0.7,
  bodyWidthMm: 0.35,
};

const clamp = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

export function loadSettings(): Settings {
  let o: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) o = JSON.parse(raw) ?? {};
  } catch {
    /* ignore */
  }
  const d = DEFAULT_SETTINGS;
  return {
    ligatures:
      Array.isArray(o.ligatures) && o.ligatures.every((s) => typeof s === 'string')
        ? (o.ligatures as string[]).slice(0, 40)
        : [...d.ligatures],
    rightGap: clamp(o.rightGap, 0, 0.6, d.rightGap),
    inputMode: o.inputMode === 'pen' || o.inputMode === 'any' || o.inputMode === 'auto' ? o.inputMode : d.inputMode,
    headingWidthMm: clamp(o.headingWidthMm, 0.1, 2, d.headingWidthMm),
    bodyWidthMm: clamp(o.bodyWidthMm, 0.1, 2, d.bodyWidthMm),
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
