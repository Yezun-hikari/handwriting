/**
 * Text → handwriting layout engine.
 *
 * Takes plain text (with "# " headings) and the user's glyph samples (glyph space, see
 * src/types.ts) and produces Goodnotes page strokes (canvas units) sitting on the ruled lines.
 */
import { PAPER_A4_RULED, mmToCanvas } from '../types.ts';
import type { DocumentContent, Glyph, PageContent, PageStroke, Rgba } from '../types.ts';
import { Rng } from './rng.ts';

/** Paper geometry, structurally compatible with {@link PAPER_A4_RULED}. */
export interface PaperGeometry {
  width: number;
  height: number;
  pitch: number;
  firstLineY: number;
  lineCount: number;
  marginLeft: number;
  marginRight: number;
  /** Preview only: white instead of yellow paper; grid (rules every `pitch` across the whole page, both directions). */
  white?: boolean;
  grid?: boolean;
}

/** Jitter amplitudes (maximum deviation). Set a field to 0 to disable it. */
export interface JitterOptions {
  /** Per-glyph vertical offset, in glyph units (pitch × scale). */
  baseline: number;
  /** Per-glyph relative size change (0.03 = ±3 %). */
  scale: number;
  /** Per-glyph rotation in degrees. */
  rotationDeg: number;
  /** Per-glyph horizontal spacing change, in glyph units. */
  spacing: number;
  /** Per-line baseline offset and drift (slope over the full line), in glyph units. */
  lineDrift: number;
}

export interface LayoutOptions {
  paper?: PaperGeometry;
  /** Body stroke width in mm (default 0.25). */
  bodyWidthMm?: number;
  /** Heading stroke width in mm (default 0.70). */
  headingWidthMm?: number;
  color?: Rgba;
  /** Body glyph size relative to the line pitch (default 1.0 = as captured). */
  glyphScale?: number;
  /** Heading size relative to the body size (default 1.6). */
  headingScale?: number;
  /** Extra space between glyphs, glyph units (default 0). */
  letterSpacing?: number;
  /** Width of one space, glyph units (default: " " glyph advance, else derived from advances). */
  wordSpacing?: number;
  /** Seed for all randomness (default 1). */
  seed?: number;
  /** Jitter amplitudes; partial objects are merged with the defaults. */
  jitter?: Partial<JitterOptions>;
  /**
   * Only count pages / lines and collect missing characters; pages come back without strokes. Much cheaper than a
   * full layout (used for the page count of long texts while only the first pages are previewed).
   */
  measureOnly?: boolean;
}

export interface LayoutStats {
  pages: number;
  /** Ruled lines carrying text. */
  textLines: number;
  headings: number;
  glyphsPlaced: number;
  strokes: number;
  /** Number of character occurrences without a glyph. */
  missingOccurrences: number;
}

export interface LayoutResult {
  doc: DocumentContent;
  /** Unique characters without a glyph, in order of first occurrence. */
  missing: string[];
  stats: LayoutStats;
}

export const DEFAULT_INK: Rgba = { r: 30 / 255, g: 27 / 255, b: 27 / 255, a: 1 };

export const DEFAULT_JITTER: JitterOptions = {
  baseline: 0.015,
  scale: 0.04,
  rotationDeg: 1.5,
  spacing: 0.025,
  lineDrift: 0.02,
};

const TAB_SPACES = 4;
/** Width reserved for a character without a glyph, glyph units. */
const MISSING_ADVANCE = 0.4;

/** A shaped unit: one glyph (possibly a ligature) or a missing-character gap. */
interface Unit {
  glyph: Glyph | null;
  advance: number;
}

type Token = { kind: 'space' } | { kind: 'word'; units: Unit[] };

/** A wrapped line: units with x positions in glyph units (unscaled) relative to the line start. */
interface WrappedLine {
  heading: boolean;
  /** Ruled lines to skip before this line (paragraph gaps). */
  gapBefore: number;
  placed: { unit: Unit; x: number }[];
}

/**
 * A glyph that can be placed: finite advance and only finite points. Anything else (corrupt storage, NaN from a bad
 * normalisation) is treated like a missing character instead of producing NaN coordinates in the file.
 */
function usableGlyph(g: Glyph): boolean {
  if (typeof g.advance !== 'number' || !Number.isFinite(g.advance) || !Array.isArray(g.strokes)) return false;
  for (const s of g.strokes) {
    if (!Array.isArray(s)) return false;
    for (const p of s) if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  return true;
}

class GlyphIndex {
  private byKey = new Map<string, Glyph[]>();
  private lastVariant = new Map<string, number>();
  readonly maxKeyLen: number;

  constructor(glyphs: Glyph[]) {
    let maxLen = 1;
    for (const g of glyphs) {
      if (!g || typeof g.char !== 'string' || g.char.length === 0 || !usableGlyph(g)) continue;
      const key = g.char.normalize('NFC');
      let list = this.byKey.get(key);
      if (!list) this.byKey.set(key, (list = []));
      list.push(g);
      maxLen = Math.max(maxLen, Array.from(key).length);
    }
    for (const list of this.byKey.values()) list.sort((a, b) => a.variant - b.variant);
    this.maxKeyLen = maxLen;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  get(key: string): Glyph[] | undefined {
    return this.byKey.get(key);
  }

  /** Random variant, avoiding the variant used for the previous occurrence of the same key. */
  pick(key: string, rng: Rng): Glyph {
    const list = this.byKey.get(key)!;
    let i = rng.int(list.length);
    const last = this.lastVariant.get(key);
    if (list.length > 1 && i === last) i = (i + 1 + rng.int(list.length - 1)) % list.length;
    this.lastVariant.set(key, i);
    return list[i];
  }

  allGlyphs(): Glyph[] {
    return [...this.byKey.values()].flat();
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Highest point above the baseline over the glyph set (positive number, glyph units). */
function ascentOf(glyphs: Glyph[]): number {
  let minY = 0;
  for (const g of glyphs) for (const s of g.strokes) for (const p of s) if (p.y < minY) minY = p.y;
  return -minY;
}

/** Split a word into units, greedily preferring the longest available glyph key. */
function shapeWord(word: string, index: GlyphIndex, rng: Rng, missing: Map<string, number>): Unit[] {
  const cps = Array.from(word);
  const units: Unit[] = [];
  let i = 0;
  while (i < cps.length) {
    let matched = 0;
    for (let len = Math.min(index.maxKeyLen, cps.length - i); len >= 1; len--) {
      const key = cps.slice(i, i + len).join('');
      if (index.has(key)) {
        const glyph = index.pick(key, rng);
        units.push({ glyph, advance: Math.max(0, glyph.advance) });
        matched = len;
        break;
      }
    }
    if (matched === 0) {
      const ch = cps[i];
      missing.set(ch, (missing.get(ch) ?? 0) + 1);
      units.push({ glyph: null, advance: MISSING_ADVANCE });
      matched = 1;
    }
    i += matched;
  }
  return units;
}

function tokenize(text: string, index: GlyphIndex, rng: Rng, missing: Map<string, number>): Token[] {
  const tokens: Token[] = [];
  for (const part of text.split(/( )/)) {
    if (part === '') continue;
    if (part === ' ') tokens.push({ kind: 'space' });
    else tokens.push({ kind: 'word', units: shapeWord(part, index, rng, missing) });
  }
  return tokens;
}

function wordWidth(units: Unit[], letterSpacing: number): number {
  let w = 0;
  for (let i = 0; i < units.length; i++) w += units[i].advance + (i > 0 ? letterSpacing : 0);
  return w;
}

/**
 * Word-wrap one paragraph. `maxWidth` is in unscaled glyph units for this paragraph's scale.
 * Words longer than a line are broken between units.
 */
function wrapParagraph(
  tokens: Token[],
  maxWidth: number,
  letterSpacing: number,
  wordSpacing: number,
  heading: boolean,
  gapBefore: number,
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let cur: WrappedLine = { heading, gapBefore, placed: [] };
  let x = 0;
  let pendingSpace = 0;
  let hasInk = false;
  const EPS = 1e-9;

  const newLine = () => {
    lines.push(cur);
    cur = { heading, gapBefore: 0, placed: [] };
    x = 0;
    pendingSpace = 0;
    hasInk = false;
  };

  for (const t of tokens) {
    if (t.kind === 'space') {
      pendingSpace += wordSpacing;
      continue;
    }
    // Leading spaces of a paragraph indent; spaces at a wrap point vanish.
    const lead = hasInk || lines.length === 0 ? pendingSpace : 0;
    const w = wordWidth(t.units, letterSpacing);
    if (hasInk && x + lead + w > maxWidth + EPS && w <= maxWidth + EPS) newLine();
    // Place the word; if it is longer than a whole line, break it between units.
    let px = hasInk || lines.length === 0 ? x + Math.min(lead, maxWidth / 2) : 0;
    t.units.forEach((u, i) => {
      let gap = i > 0 ? letterSpacing : 0;
      if (cur.placed.length > 0 && px + gap + u.advance > maxWidth + EPS) {
        newLine();
        px = 0;
        gap = 0;
      }
      px += gap;
      cur.placed.push({ unit: u, x: px });
      px += u.advance;
      hasInk = true;
    });
    x = px;
    pendingSpace = 0;
  }
  // An empty paragraph text still occupies its line (e.g. "# " alone): push it only if it has ink.
  if (cur.placed.length > 0) lines.push(cur);
  return lines;
}

/** Lay out `text` with the given glyphs. Never throws on unusual input. */
export function layoutText(text: string, glyphs: Glyph[], opts: LayoutOptions = {}): LayoutResult {
  const paper = opts.paper ?? PAPER_A4_RULED;
  const bodyScale = opts.glyphScale ?? 1.0;
  const headingScaleRel = opts.headingScale ?? 1.6;
  const headingScale = bodyScale * headingScaleRel;
  const bodyWidth = mmToCanvas(opts.bodyWidthMm ?? 0.25);
  const headingWidth = mmToCanvas(opts.headingWidthMm ?? 0.7);
  const color: Rgba = { ...(opts.color ?? DEFAULT_INK) };
  const jitter: JitterOptions = { ...DEFAULT_JITTER, ...(opts.jitter ?? {}) };
  const letterSpacing = opts.letterSpacing ?? 0;
  const rng = new Rng(opts.seed ?? 1);

  const index = new GlyphIndex(Array.isArray(glyphs) ? glyphs : []);
  const all = index.allGlyphs();
  const spaceGlyphs = index.get(' ');
  const advances = all.filter((g) => Array.from(g.char).length === 1 && g.char !== ' ').map((g) => g.advance);
  const wordSpacing =
    opts.wordSpacing ??
    (spaceGlyphs ? median(spaceGlyphs.map((g) => g.advance)) : Math.max(0.25, median(advances) * 1.4 || 0.4));
  const ascent = Math.min(1.5, Math.max(0.5, ascentOf(all) || 0.75));
  /** Heading needs this many free ruled lines above its baseline line (unless at page top). */
  const headingLinesAbove = Math.max(0, Math.ceil(ascent * headingScaleRel - 1e-6) - 1);

  const missing = new Map<string, number>();
  const usableWidth = paper.width - paper.marginLeft - paper.marginRight;

  // ---- Phase 1: parse paragraphs and wrap. ----
  const normalized = String(text ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' '.repeat(TAB_SPACES));
  const lines: WrappedLine[] = [];
  let pendingGap = 0;
  for (const raw of normalized.split('\n')) {
    const headingMatch = /^# +/.exec(raw);
    const heading = headingMatch !== null;
    const body = heading ? raw.slice(headingMatch![0].length).trimEnd() : raw.trimEnd();
    if (body.trim() === '') {
      if (!heading) pendingGap++;
      continue;
    }
    const scale = heading ? headingScale : bodyScale;
    const maxW = usableWidth / (paper.pitch * scale);
    const tokens = tokenize(body, index, rng, missing);
    const wrapped = wrapParagraph(tokens, maxW, letterSpacing, wordSpacing, heading, pendingGap);
    pendingGap = 0;
    lines.push(...wrapped);
  }

  // ---- Phase 2: assign ruled lines / pages and emit strokes. ----
  const pages: PageContent[] = [];
  let page: PageContent | null = null;
  let nextLine = 0;
  const stats: LayoutStats = {
    pages: 0,
    textLines: 0,
    headings: 0,
    glyphsPlaced: 0,
    strokes: 0,
    missingOccurrences: 0,
  };
  const r3 = (v: number) => Math.round(v * 1000) / 1000;

  for (const line of lines) {
    let target = nextLine;
    if (page && nextLine > 0) {
      target += line.gapBefore;
      if (line.heading) target += headingLinesAbove; // room for tall heading glyphs
    }
    if (!page || target >= paper.lineCount) {
      page = { strokes: [] };
      pages.push(page);
      target = 0;
    }
    nextLine = target + 1;
    stats.textLines++;
    if (line.heading) stats.headings++;

    if (opts.measureOnly) {
      for (const { unit } of line.placed) {
        if (unit.glyph) stats.glyphsPlaced++;
        else stats.missingOccurrences++;
      }
      continue;
    }
    const scale = line.heading ? headingScale : bodyScale;
    const unitPx = paper.pitch * scale; // canvas units per glyph unit
    const width = line.heading ? headingWidth : bodyWidth;
    const baseY = paper.firstLineY + target * paper.pitch;
    const lineOffset = rng.soft() * jitter.lineDrift * unitPx;
    const lineSlope = (rng.soft() * jitter.lineDrift * unitPx) / Math.max(1, usableWidth);
    let spacingAcc = 0;

    for (const { unit, x } of line.placed) {
      spacingAcc += rng.soft() * jitter.spacing;
      const dy = rng.soft() * jitter.baseline;
      const ds = 1 + rng.soft() * jitter.scale;
      const rot = (rng.soft() * jitter.rotationDeg * Math.PI) / 180;
      if (!unit.glyph) {
        stats.missingOccurrences++;
        continue;
      }
      const g = unit.glyph;
      const originX = paper.marginLeft + (x + spacingAcc) * unitPx;
      // Rotate/scale around the glyph's horizontal centre on the baseline, so it stays on the line.
      const cx = g.advance / 2;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const localY = baseY + lineOffset + lineSlope * (originX - paper.marginLeft) + dy * unitPx;
      const placed: PageStroke[] = [];
      let finite = true;
      for (const s of g.strokes) {
        if (!Array.isArray(s) || s.length === 0) continue;
        const pts: { x: number; y: number }[] = [];
        for (const p of s) {
          const lx = (p.x - cx) * ds;
          const ly = p.y * ds;
          const rx = lx * cos - ly * sin;
          const ry = lx * sin + ly * cos;
          const px = r3(originX + (cx + rx) * unitPx);
          const py = r3(localY + ry * unitPx);
          if (!Number.isFinite(px) || !Number.isFinite(py)) finite = false;
          pts.push({ x: px, y: py });
        }
        placed.push({ points: pts, width, color: { ...color } });
      }
      if (!finite) {
        // Overflow (absurd coordinates): treat like a missing character rather than writing NaN/Infinity.
        stats.missingOccurrences++;
        missing.set(g.char, (missing.get(g.char) ?? 0) + 1);
        continue;
      }
      for (const ps of placed) page.strokes.push(ps);
      stats.strokes += placed.length;
      const placedAny = placed.length > 0;
      if (placedAny || g.strokes.length === 0) stats.glyphsPlaced++;
    }
  }

  stats.pages = pages.length;
  return { doc: { pages }, missing: [...missing.keys()], stats };
}
