import { BOX_BOTTOM, BOX_TOP } from '../capture/geometry.ts';
import type { Glyph } from '../types.ts';
import { svg } from './dom.ts';

/** Small preview of a glyph (glyph space viewBox), drawn with currentColor. */
export function glyphSvg(g: Glyph, heightPx = 40): SVGSVGElement {
  const pad = 0.1;
  const w = Math.max(g.advance, 0.3) + 2 * pad;
  const hgt = BOX_BOTTOM - BOX_TOP;
  const el = svg('svg', {
    viewBox: `${-pad} ${BOX_TOP} ${w} ${hgt}`,
    width: Math.round((w / hgt) * heightPx),
    height: heightPx,
    class: 'glyph-svg',
    'aria-hidden': 'true',
  });
  el.append(svg('line', { x1: -pad, x2: w, y1: 0, y2: 0, class: 'glyph-base' }));
  for (const s of g.strokes) {
    if (!s.length) continue;
    const d = s.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join('');
    el.append(svg('path', { d, class: 'glyph-ink' }));
  }
  return el;
}
