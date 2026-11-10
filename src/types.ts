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

const pt = (v: number): number => v * (11 / 6);

/**
 * Paper templates the user can choose (public/template/<file>.goodnotes, derived with
 * src/goodnotes/tools/make-paper-variants.mjs). Rules measured from the Goodnotes PDFs (pt from top):
 * narrow 17.5 pt from 50 (45 lines), wide 25 pt from 49.5 (32 lines), grid 16 pt from 15.5 in both
 * directions; on grid paper text starts on the third line, leaving a top margin like the ruled papers.
 */
export const PAPERS = {
  'ruled-yellow': { label: 'Liniert schmal · gelb', file: 'a4-ruled-yellow', white: false, grid: false, ...PAPER_A4_RULED },
  'ruled-white': { label: 'Liniert schmal · weiß', file: 'a4-ruled-white', white: true, grid: false, ...PAPER_A4_RULED },
  'wide-yellow': { label: 'Liniert breit · gelb', file: 'a4-wide-yellow', white: false, grid: false, ...PAPER_A4_RULED, pitch: pt(25), firstLineY: pt(49.5), lineCount: 32 },
  'wide-white': { label: 'Liniert breit · weiß', file: 'a4-wide-white', white: true, grid: false, ...PAPER_A4_RULED, pitch: pt(25), firstLineY: pt(49.5), lineCount: 32 },
  'grid-yellow': { label: 'Kariert · gelb', file: 'a4-grid-yellow', white: false, grid: true, ...PAPER_A4_RULED, pitch: pt(16), firstLineY: pt(47.5), lineCount: 49 },
  'grid-white': { label: 'Kariert · weiß', file: 'a4-grid-white', white: true, grid: true, ...PAPER_A4_RULED, pitch: pt(16), firstLineY: pt(47.5), lineCount: 49 },
} as const;
export type PaperId = keyof typeof PAPERS;
export const DEFAULT_PAPER: PaperId = 'ruled-yellow';
export const isPaperId = (v: unknown): v is PaperId => typeof v === 'string' && Object.hasOwn(PAPERS, v);

/** mm → canvas units. */
export const mmToCanvas = (mm: number): number => (mm / 25.4) * 72 * (11 / 6);
