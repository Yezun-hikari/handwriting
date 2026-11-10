import { DEFAULT_LIGATURES } from '../capture/charset.ts';
import type { InputMode } from '../capture/input-policy.ts';

/**
 * UI settings. The *roaming* part (ligature list, right gap, stroke widths) belongs to the handwriting and follows a
 * registered account (table handwriting_settings); per-device things (input mode: Pencil vs. finger) stay local.
 * localStorage is always the working copy, so loadSettings() stays synchronous.
 */
export interface RoamingSettings {
  ligatures: string[];
  /** Right gap added to each glyph's ink width, glyph units (pitch). */
  rightGap: number;
  /** Convert page: stroke widths in mm. */
  headingWidthMm: number;
  bodyWidthMm: number;
}

export interface LocalSettings {
  inputMode: InputMode;
}

export type Settings = RoamingSettings & LocalSettings;

export const ROAMING_KEYS = ['ligatures', 'rightGap', 'headingWidthMm', 'bodyWidthMm'] as const satisfies readonly (keyof RoamingSettings)[];

export const SETTINGS_KEY = 'handwriting-settings';

export const DEFAULT_SETTINGS: Settings = {
  ligatures: [...DEFAULT_LIGATURES],
  rightGap: 0.12,
  inputMode: 'auto',
  headingWidthMm: 0.7,
  bodyWidthMm: 0.35,
};

const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const clamp = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Valid roaming fields of untrusted data (server row, storage); invalid/missing fields are left out. */
export function parseRoaming(v: unknown): Partial<RoamingSettings> {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out: Partial<RoamingSettings> = {};
  if (Array.isArray(o.ligatures) && o.ligatures.every((s) => typeof s === 'string' && s.length >= 1 && s.length <= 8))
    out.ligatures = (o.ligatures as string[]).slice(0, 40);
  if (inRange(o.rightGap, 0, 0.6)) out.rightGap = o.rightGap;
  if (inRange(o.headingWidthMm, 0.1, 2)) out.headingWidthMm = o.headingWidthMm;
  if (inRange(o.bodyWidthMm, 0.1, 2)) out.bodyWidthMm = o.bodyWidthMm;
  return out;
}

export const roamingOf = (s: Settings): RoamingSettings => ({
  ligatures: [...s.ligatures],
  rightGap: s.rightGap,
  headingWidthMm: s.headingWidthMm,
  bodyWidthMm: s.bodyWidthMm,
});

function readRaw(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const o: unknown = raw ? JSON.parse(raw) : null;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function write(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore (private mode / quota) */
  }
}

export function loadSettings(): Settings {
  const o = readRaw();
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

let roamingSink: ((s: RoamingSettings) => void) | null = null;

/** Called with the new roaming settings whenever saveSettings() changes one of them (account sync). */
export function setRoamingSink(fn: ((s: RoamingSettings) => void) | null): void {
  roamingSink = fn;
}

export const sameRoaming = (a: RoamingSettings, b: RoamingSettings): boolean => JSON.stringify(a) === JSON.stringify(b);

export function saveSettings(patch: Partial<Settings>): Settings {
  const prev = loadSettings();
  const next = { ...prev, ...patch };
  write(next);
  if (roamingSink && !sameRoaming(roamingOf(prev), roamingOf(next))) roamingSink(roamingOf(next));
  return next;
}

/** Takes over settings from the account into the local working copy (no sync back). True if anything changed. */
export function applyRoaming(remote: Partial<RoamingSettings>): boolean {
  const prev = loadSettings();
  const next: Settings = { ...prev, ...parseRoaming(remote) };
  if (sameRoaming(roamingOf(prev), roamingOf(next))) return false;
  write(next);
  return true;
}
