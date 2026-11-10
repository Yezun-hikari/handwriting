/**
 * Geometry of a capture field, in glyph units (1 = ruled-line pitch, baseline 0, y down).
 * The visible box spans TOP..BOTTOM (≈ 2 pitches); the field maps `pitchPx` CSS pixels to 1 unit.
 */
export const BOX_TOP = -1.3;
export const BOX_BOTTOM = 0.8;
export const BOX_HEIGHT = BOX_BOTTOM - BOX_TOP;

export interface GuideLine {
  y: number;
  kind: 'ruled' | 'ascender' | 'xheight' | 'baseline' | 'descender';
  label: string;
}

/** Guide lines drawn in each field. `ruled` = the paper's previous ruled line (one pitch up). */
export const GUIDES: readonly GuideLine[] = [
  { y: -1, kind: 'ruled', label: 'Linie' },
  { y: -0.75, kind: 'ascender', label: 'Oberlänge' },
  { y: -0.45, kind: 'xheight', label: 'x-Höhe' },
  { y: 0, kind: 'baseline', label: 'Grundlinie' },
  { y: 0.4, kind: 'descender', label: 'Unterlänge' },
];

/** Frame of one field in CSS pixels. */
export interface FieldFrame {
  /** CSS px per glyph unit. */
  pitchPx: number;
  /** y of the baseline in CSS px from the top of the canvas. */
  baselinePx: number;
  /** Where denormalised (already saved) glyphs are drawn: x of glyph-space 0, CSS px. */
  originXPx: number;
}

export function frameFor(pitchPx: number): FieldFrame {
  return { pitchPx, baselinePx: -BOX_TOP * pitchPx, originXPx: 0.35 * pitchPx };
}

/** Pick a comfortable pitch for a field of the given CSS width (for ~ `units` pitches wide). */
export function pitchForWidth(widthPx: number, units: number, min = 64, max = 112): number {
  return Math.max(min, Math.min(max, widthPx / units));
}
