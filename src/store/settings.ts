import { DEFAULT_LIGATURES } from '../capture/charset.ts';
import type { InputMode } from '../capture/input-policy.ts';
import { DEFAULT_PAPER, isPaperId, type PaperId } from '../types.ts';
import { DB_LIMITS, jsonBytes, validChar } from './validate.ts';

/**
 * UI settings. The *roaming* part (ligature list, right gap, stroke widths, paper) belongs to the handwriting and follows a
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
  /** Convert page: paper template. */
  paper: PaperId;
}

export interface LocalSettings {
  inputMode: InputMode;
}

export type Settings = RoamingSettings & LocalSettings;

export const ROAMING_KEYS = ['ligatures', 'rightGap', 'headingWidthMm', 'bodyWidthMm', 'paper'] as const satisfies readonly (keyof RoamingSettings)[];

export const SETTINGS_KEY = 'handwriting-settings';

export const DEFAULT_SETTINGS: Settings = {
  ligatures: [...DEFAULT_LIGATURES],
  rightGap: 0.12,
  inputMode: 'auto',
  headingWidthMm: 0.7,
  bodyWidthMm: 0.35,
  paper: DEFAULT_PAPER,
};

export const MAX_LIGATURES = 40;
/** Stroke widths on the convert page, mm. */
export const PEN_MIN_MM = 0.1;
export const PEN_MAX_MM = 2;

/** Clamps a pen width to {@link PEN_MIN_MM}..{@link PEN_MAX_MM}; non-numbers give `fallback`. */
export function clampPenMm(v: unknown, fallback: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(PEN_MAX_MM, Math.max(PEN_MIN_MM, n)) : fallback;
}

/** True if the roaming settings fit the account table (handwriting_settings: jsonb ≤ 16 KiB). */
export const fitsAccountSettings = (s: RoamingSettings): boolean => jsonBytes(s) <= DB_LIMITS.settingsBytesMax;

const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const clamp = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Valid roaming fields of untrusted data (server row, storage); invalid/missing fields are left out. */
export function parseRoaming(v: unknown): Partial<RoamingSettings> {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: Partial<RoamingSettings> = {};
  if (jsonBytes(o) > DB_LIMITS.settingsBytesMax) return out; // larger than the account table accepts: not ours
  if (Array.isArray(o.ligatures) && o.ligatures.length <= MAX_LIGATURES && o.ligatures.every(validChar))
    out.ligatures = (o.ligatures as string[]).map((s) => s.normalize('NFC'));
  if (inRange(o.rightGap, 0, 0.6)) out.rightGap = o.rightGap;
  if (inRange(o.headingWidthMm, PEN_MIN_MM, PEN_MAX_MM)) out.headingWidthMm = o.headingWidthMm;
  if (inRange(o.bodyWidthMm, PEN_MIN_MM, PEN_MAX_MM)) out.bodyWidthMm = o.bodyWidthMm;
  if (isPaperId(o.paper)) out.paper = o.paper;
  return out;
}

/** Roaming settings as the account may store them: pen widths clamped, ligatures within the table's limits. */
export function sanitizeRoaming(s: RoamingSettings): RoamingSettings {
  const d = DEFAULT_SETTINGS;
  return {
    ligatures: (Array.isArray(s.ligatures) ? s.ligatures : []).filter(validChar).slice(0, MAX_LIGATURES),
    rightGap: clamp(s.rightGap, 0, 0.6, d.rightGap),
    headingWidthMm: clampPenMm(s.headingWidthMm, d.headingWidthMm),
    bodyWidthMm: clampPenMm(s.bodyWidthMm, d.bodyWidthMm),
    paper: isPaperId(s.paper) ? s.paper : d.paper,
  };
}

export const roamingOf = (s: Settings): RoamingSettings => ({
  ligatures: [...s.ligatures],
  rightGap: s.rightGap,
  headingWidthMm: s.headingWidthMm,
  bodyWidthMm: s.bodyWidthMm,
  paper: s.paper,
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
        ? (o.ligatures as string[]).slice(0, MAX_LIGATURES)
        : [...d.ligatures],
    rightGap: clamp(o.rightGap, 0, 0.6, d.rightGap),
    inputMode: o.inputMode === 'pen' || o.inputMode === 'any' || o.inputMode === 'auto' ? o.inputMode : d.inputMode,
    headingWidthMm: clamp(o.headingWidthMm, PEN_MIN_MM, PEN_MAX_MM, d.headingWidthMm),
    bodyWidthMm: clamp(o.bodyWidthMm, PEN_MIN_MM, PEN_MAX_MM, d.bodyWidthMm),
    paper: isPaperId(o.paper) ? o.paper : d.paper,
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
  next.headingWidthMm = clampPenMm(next.headingWidthMm, prev.headingWidthMm);
  next.bodyWidthMm = clampPenMm(next.bodyWidthMm, prev.bodyWidthMm);
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
