import { describe, expect, it } from 'vitest';
import { PAPER_A4_RULED as P, mmToCanvas } from '../types.ts';
import type { Glyph, PageStroke } from '../types.ts';
import { layoutText, renderPreviewSvg, makeSyntheticGlyphs } from './index.ts';
import type { LayoutOptions } from './index.ts';

const NO_JITTER: LayoutOptions['jitter'] = { baseline: 0, scale: 0, rotationDeg: 0, spacing: 0, lineDrift: 0 };
const glyphs = makeSyntheticGlyphs(2);
const flat = (opts: LayoutOptions = {}): LayoutOptions => ({ jitter: NO_JITTER, ...opts });

function bbox(strokes: PageStroke[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of strokes)
    for (const p of s.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  return { minX, maxX, minY, maxY };
}

/** Ruled line index whose baseline is closest to the stroke's bottom (for glyphs without descenders). */
const lineOf = (y: number) => Math.round((y - P.firstLineY) / P.pitch);

/** One single-stroke glyph per key whose point count encodes key + variant, for identification. */
function markerGlyphs(keys: string[], variants = 1): Glyph[] {
  const out: Glyph[] = [];
  keys.forEach((k, ki) =>
    Array.from({ length: variants }, (_, v) => {
      const n = 2 + ki * 10 + v;
      out.push({
        char: k,
        variant: v,
        strokes: [Array.from({ length: n }, (_, i) => ({ x: (0.3 * i) / (n - 1), y: -0.45 * (i % 2) }))],
        advance: 0.4,
      });
    }),
  );
  return out;
}
const markerKey = (s: PageStroke, keys: string[]) => keys[Math.floor((s.points.length - 2) / 10)];
const markerVariant = (s: PageStroke) => (s.points.length - 2) % 10;

describe('layoutText basics', () => {
  it('places strokes on the first ruled line with body width and ink colour', () => {
    const { doc, missing, stats } = layoutText('l', glyphs, flat());
    expect(missing).toEqual([]);
    expect(doc.pages).toHaveLength(1);
    const s = doc.pages[0].strokes;
    expect(s).toHaveLength(1);
    expect(s[0].width).toBeCloseTo(mmToCanvas(0.25), 6);
    expect(s[0].color).toEqual({ r: 30 / 255, g: 27 / 255, b: 27 / 255, a: 1 });
    const b = bbox(s);
    expect(b.maxY).toBeCloseTo(P.firstLineY, 2); // sits on the baseline
    expect(b.minX).toBeCloseTo(P.marginLeft, 2);
    expect(stats.glyphsPlaced).toBe(1);
  });

  it('keeps glyphs near their ruled line even with default jitter', () => {
    const { doc } = layoutText('lll lll lll\nlll', glyphs, { seed: 7 });
    for (const s of doc.pages[0].strokes) {
      const b = bbox([s]);
      const line = lineOf(b.maxY);
      expect(Math.abs(b.maxY - (P.firstLineY + line * P.pitch))).toBeLessThan(0.08 * P.pitch);
    }
  });

  it('handles empty / whitespace input', () => {
    expect(layoutText('', glyphs).doc.pages).toEqual([]);
    expect(layoutText('  \n\t\n', glyphs).doc.pages).toEqual([]);
    expect(layoutText('abc', []).missing).toEqual(['a', 'b', 'c']);
  });
});

describe('wrapping', () => {
  const text = Array.from({ length: 120 }, (_, i) => ['hallo', 'welt', 'dies', 'ist', 'ein', 'test'][i % 6]).join(' ');

  it('wraps words within the margins onto consecutive lines', () => {
    const { doc, stats } = layoutText(text, glyphs, flat());
    expect(stats.textLines).toBeGreaterThan(3);
    const b = bbox(doc.pages[0].strokes);
    expect(b.minX).toBeGreaterThanOrEqual(P.marginLeft - 0.01);
    expect(b.maxX).toBeLessThanOrEqual(P.width - P.marginRight + 0.01);
    const onLine = doc.pages[0].strokes
      .map((s) => bbox([s]).maxY)
      .filter((y) => Math.abs(y - (P.firstLineY + lineOf(y) * P.pitch)) < 0.01);
    const lines = new Set(onLine.map(lineOf));
    expect([...lines].sort((a, b) => a - b)).toEqual(Array.from({ length: stats.textLines }, (_, i) => i));
  });

  it('stays within margins (with tolerance) under jitter', () => {
    const { doc } = layoutText(text, glyphs, { seed: 3 });
    const b = bbox(doc.pages[0].strokes);
    expect(b.maxX).toBeLessThanOrEqual(P.width - P.marginRight + 0.15 * P.pitch);
  });

  it('breaks words longer than a line', () => {
    const { doc, stats } = layoutText('m'.repeat(200), glyphs, flat());
    expect(stats.textLines).toBeGreaterThan(1);
    expect(stats.glyphsPlaced).toBe(200);
    expect(bbox(doc.pages[0].strokes).maxX).toBeLessThanOrEqual(P.width - P.marginRight + 0.01);
  });

  it('respects explicit newlines and skips a ruled line per empty line', () => {
    const lines = (t: string) =>
      layoutText(t, glyphs, flat()).doc.pages[0].strokes.map((s) => lineOf(bbox([s]).maxY));
    expect(lines('l\nl')).toEqual([0, 1]);
    expect(lines('l\n\nl')).toEqual([0, 2]);
    expect(lines('l\r\n\r\n\r\nl')).toEqual([0, 3]);
    expect(lines('\n\nl')).toEqual([0]); // no gap at the top of a page
  });

  it('turns tabs into spaces and indents', () => {
    const a = layoutText('l', glyphs, flat()).doc.pages[0].strokes;
    const b = layoutText('\tl', glyphs, flat()).doc.pages[0].strokes;
    expect(bbox(b).minX).toBeGreaterThan(bbox(a).minX + 10);
  });
});

describe('page breaks', () => {
  it('starts a new page when ruled lines run out', () => {
    const text = Array.from({ length: 100 }, () => 'zeile').join('\n');
    const { doc, stats } = layoutText(text, glyphs, flat());
    expect(stats.textLines).toBe(100);
    expect(doc.pages).toHaveLength(Math.ceil(100 / P.lineCount));
    expect(stats.pages).toBe(doc.pages.length);
    for (const page of doc.pages) {
      const b = bbox(page.strokes);
      expect(b.maxY).toBeLessThanOrEqual(P.firstLineY + (P.lineCount - 1) * P.pitch + 0.4 * P.pitch);
      expect(b.minY).toBeGreaterThan(0);
    }
    // second page starts on the first ruled line
    const firstOnP2 = doc.pages[1].strokes[0];
    expect(lineOf(bbox([firstOnP2]).maxY)).toBe(0);
  });
});

describe('headings', () => {
  it('renders "# " lines bigger and thicker without the hash', () => {
    const { doc, missing, stats } = layoutText('# l\nl', glyphs, flat());
    expect(missing).toEqual([]);
    expect(stats.headings).toBe(1);
    const [h, body] = doc.pages[0].strokes;
    expect(h.width).toBeCloseTo(mmToCanvas(0.7), 6);
    expect(body.width).toBeCloseTo(mmToCanvas(0.25), 6);
    const hb = bbox([h]), bb = bbox([body]);
    expect((hb.maxY - hb.minY) / (bb.maxY - bb.minY)).toBeCloseTo(1.6, 3);
    expect(lineOf(hb.maxY)).toBe(0);
    expect(lineOf(bb.maxY)).toBe(1);
  });

  it('leaves room above a heading that follows body text', () => {
    const { doc } = layoutText('l\n# l', glyphs, flat());
    const [body, h] = doc.pages[0].strokes;
    const hb = bbox([h]);
    expect(lineOf(hb.maxY)).toBe(2); // 0.75 * 1.6 = 1.2 pitches tall → one free line above
    expect(hb.minY).toBeGreaterThan(bbox([body]).maxY);
  });

  it('honours headingScale', () => {
    const { doc } = layoutText('# l', glyphs, flat({ headingScale: 2 }));
    const b = bbox(doc.pages[0].strokes);
    expect(b.maxY - b.minY).toBeCloseTo(0.75 * 2 * P.pitch, 2);
  });
});

describe('ligatures', () => {
  const keys = ['s', 'c', 'h', 'ch', 'sch', 'a'];
  const g = markerGlyphs(keys);
  const used = (t: string) => layoutText(t, g, flat()).doc.pages[0].strokes.map((s) => markerKey(s, keys));

  it('greedily prefers the longest glyph key', () => {
    expect(used('schach')).toEqual(['sch', 'a', 'ch']);
    expect(used('sc')).toEqual(['s', 'c']);
    expect(used('ssch')).toEqual(['s', 'sch']);
  });

  it('does not match ligatures across word boundaries', () => {
    expect(used('s ch')).toEqual(['s', 'ch']);
    expect(used('c h')).toEqual(['c', 'h']);
  });

  it('normalises to NFC (decomposed umlaut matches the composed glyph)', () => {
    const r = layoutText('ä', makeSyntheticGlyphs(1, ['ä']), flat());
    expect(r.missing).toEqual([]);
    expect(r.stats.glyphsPlaced).toBe(1);
  });
});

describe('variants and determinism', () => {
  it('avoids the same variant twice in a row', () => {
    const keys = ['a'];
    const { doc } = layoutText('a'.repeat(50), markerGlyphs(keys, 3), flat({ seed: 11 }));
    const v = doc.pages[0].strokes.map(markerVariant);
    expect(v).toHaveLength(50);
    for (let i = 1; i < v.length; i++) expect(v[i]).not.toBe(v[i - 1]);
    expect(new Set(v).size).toBe(3);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const t = '# Titel\nDies ist ein Test, welchen ich schreibe.\n\nNoch ein Absatz.';
    const a = layoutText(t, glyphs, { seed: 42 });
    const b = layoutText(t, glyphs, { seed: 42 });
    const c = layoutText(t, glyphs, { seed: 43 });
    expect(a).toEqual(b);
    expect(JSON.stringify(a.doc)).not.toEqual(JSON.stringify(c.doc));
  });
});

describe('missing characters', () => {
  it('reports missing chars without substituting case and keeps their space', () => {
    const g = makeSyntheticGlyphs(1, ['A', 'l']);
    const r = layoutText('AÄ€l Ä', g, flat());
    expect(r.missing).toEqual(['Ä', '€']);
    expect(r.stats.missingOccurrences).toBe(3);
    expect(r.stats.glyphsPlaced).toBe(2);
    const ref = layoutText('Al', g, flat());
    const xL = bbox([r.doc.pages[0].strokes.at(-1)!]).minX;
    const xLref = bbox([ref.doc.pages[0].strokes.at(-1)!]).minX;
    expect(xL).toBeGreaterThan(xLref + 10);
  });
  it('treats glyphs with non-finite advance or points as missing', () => {
    const ok = makeSyntheticGlyphs(1, ['a']);
    const bad: Glyph[] = [
      { char: 'b', variant: 0, strokes: [[{ x: 0, y: 0 }, { x: 0.2, y: -0.5 }]], advance: NaN },
      { char: 'c', variant: 0, strokes: [[{ x: 0, y: 0 }, { x: Infinity, y: -0.5 }]], advance: 0.4 },
      { char: 'd', variant: 0, strokes: [[{ x: 0, y: 0 }, { x: 1e308, y: -1e308 }]], advance: 0.4 },
    ];
    const r = layoutText('abcd', [...ok, ...bad], flat());
    expect(r.missing).toEqual(['b', 'c', 'd']);
    expect(r.stats.glyphsPlaced).toBe(1);
    for (const st of r.doc.pages[0].strokes) for (const p of st.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
  it('uses a valid variant when another variant of the same char is broken', () => {
    const ok = makeSyntheticGlyphs(1, ['a']);
    const r = layoutText('aaaa', [...ok, { ...ok[0], variant: 1, advance: Infinity }], flat());
    expect(r.missing).toEqual([]);
    expect(r.stats.glyphsPlaced).toBe(4);
  });
});

describe('renderPreviewSvg', () => {
  it('renders paper, ruled lines and strokes using numbers only', () => {
    const { doc } = layoutText('<script>alert("x")</script> & "quotes"', glyphs, { seed: 1 });
    const svg = renderPreviewSvg(doc, 0, P);
    expect(svg).toContain('fill="rgb(248,247,233)"');
    expect(svg.match(/<rect /g)).toHaveLength(1 + P.lineCount);
    expect(svg.match(/<polyline /g)!.length).toBe(doc.pages[0].strokes.length);
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).not.toContain('script');
    expect(svg).not.toContain('alert');
    // strip the fixed markup vocabulary; only numbers/punctuation may remain
    const rest = svg.replace(
      /xmlns="http:\/\/www\.w3\.org\/2000\/svg"|svg|viewBox|width|height|rect|fill|none|rgb|polyline|points|stroke(-opacity|-width|-linecap|-linejoin)?|round|[xy]=/g,
      '',
    );
    expect(rest).toMatch(/^[\s<>/="0-9.,\-()e]*$/);
  });

  it('handles bad page indices and NaN values', () => {
    const svg = renderPreviewSvg({ pages: [{ strokes: [{ points: [{ x: NaN, y: 1 }], width: 1, color: { r: 2, g: -1, b: 0.5, a: 1 } }] }] }, 0, P);
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('rgb(255,0,128)');
    expect(renderPreviewSvg({ pages: [] }, 5, P)).toContain('</svg>');
  });
});
