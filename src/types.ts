/**
 * Shared data contracts between capture (src/capture), layout (src/layout), storage (src/store)
 * and the Goodnotes writer (src/goodnotes). Change only together with all consumers.
 */

/** A pen sample. Glyph space: see {@link Glyph}. `p` = pressure 0..1 (optional, informational). */
export interface Point {
  x: number;
  y: number;
  p?: number;
}

/** One pen-down..pen-up path. */
export type Stroke = Point[];

/**
 * One handwritten sample of a character or ligature, as captured with the Apple Pencil.
 *
 * Glyph space (resolution independent):
 * - Unit 1.0 = one ruled-line pitch of the target paper (distance between two ruled lines).
 * - y = 0 is the baseline, y grows DOWNWARDS (descenders positive, ascenders/caps negative,
 *   typical x-height ≈ -0.45, cap height ≈ -0.75).
 * - x = 0 is the left edge of the ink (minus nothing); `advance` is the horizontal distance to
 *   the next glyph's x = 0, i.e. ink width plus the natural right side gap.
 */
export interface Glyph {
  /** One character ("a", "Ä", "?") or a ligature of several ("ch", "sch"). NFC-normalised. */
  char: string;
  /** 0-based variant index; several variants per char make the output look less stamped. */
  variant: number;
  strokes: Stroke[];
  advance: number;
}

/** All glyphs of a user, plus settings. */
export interface HandwritingSet {
  glyphs: Glyph[];
}

/** RGBA, each 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A stroke placed on a page, in Goodnotes canvas units (PDF points × 11/6, origin top-left, y down). */
export interface PageStroke {
  points: { x: number; y: number }[];
  /** Absolute stroke width in canvas units (0.25 mm ≈ 1.2992, 0.70 mm ≈ 3.6378). */
  width: number;
  color: Rgba;
}

export interface PageContent {
  strokes: PageStroke[];
}

/** Input of the Goodnotes writer, output of the layout engine. */
export interface DocumentContent {
  pages: PageContent[];
}

/**
 * Geometry of the paper template (A4 ruled, "a4_1_1 - Yellow"), canvas units.
 * Verified from the sample file: canvas = PDF pt × 11/6, pitch 17.5 pt, first line 50 pt from top,
 * 45 lines.
 */
export const PAPER_A4_RULED = {
  width: 1091.35,
  height: 1543.46,
  /** Distance between ruled lines. */
  pitch: 32.0833,
  /** y of the first ruled line (text sits ON the line, i.e. this is a baseline). */
  firstLineY: 91.667,
  lineCount: 45,
  /** Suggested horizontal text margins. */
  marginLeft: 36,
  marginRight: 36,
} as const;

/** mm → canvas units. */
export const mmToCanvas = (mm: number): number => (mm / 25.4) * 72 * (11 / 6);
