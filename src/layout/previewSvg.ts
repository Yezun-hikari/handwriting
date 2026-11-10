import type { DocumentContent, Rgba } from '../types.ts';
import type { PaperGeometry } from './layout.ts';

const PAPER_RGB = { r: 0.973, g: 0.969, b: 0.914 };
const WHITE_RGB = { r: 1, g: 1, b: 1 };
const RULE_RGB = { r: 0.816, g: 0.824, b: 0.827 };
/** 0.5 pt in canvas units (pt × 11/6). */
const RULE_THICKNESS = 0.5 * (11 / 6);

/** Format a number for SVG markup; anything non-finite becomes 0. Never emits user strings. */
function n(v: unknown, digits = 3): string {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return String(Math.round(x * 10 ** digits) / 10 ** digits);
}

function clamp01(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function rgb(c: { r: number; g: number; b: number }): string {
  return `rgb(${Math.round(clamp01(c.r) * 255)},${Math.round(clamp01(c.g) * 255)},${Math.round(clamp01(c.b) * 255)})`;
}

/**
 * Render one page as a standalone SVG string (paper colour, ruled lines, strokes as
 * round-capped polylines). All values are emitted as numbers, so the output is safe to inject.
 */
export function renderPreviewSvg(doc: DocumentContent, pageIndex: number, paper: PaperGeometry): string {
  const W = n(paper.width);
  const H = n(paper.height);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${rgb(paper.white ? WHITE_RGB : PAPER_RGB)}"/>`);
  const rule = (x: number, y: number, w: number | string, h: number | string): string =>
    `<rect x="${n(x)}" y="${n(y)}" width="${typeof w === 'string' ? w : n(w, 4)}" height="${typeof h === 'string' ? h : n(h, 4)}" fill="${rgb(RULE_RGB)}"/>`;
  if (paper.grid && paper.pitch > 1) {
    // Grid rules continue the text lines over the whole page (rule top edge = line y, as on the ruled papers).
    const off = paper.firstLineY % paper.pitch;
    for (let y = off; y < paper.height; y += paper.pitch) out.push(rule(0, y, W, RULE_THICKNESS));
    for (let x = off; x < paper.width; x += paper.pitch) out.push(rule(x, 0, RULE_THICKNESS, H));
  } else {
    const count = Math.max(0, Math.min(1000, Math.floor(Number(paper.lineCount) || 0)));
    for (let i = 0; i < count; i++) out.push(rule(0, paper.firstLineY + i * paper.pitch - RULE_THICKNESS / 2, W, RULE_THICKNESS));
  }
  const page = doc?.pages?.[pageIndex];
  if (page) {
    for (const s of page.strokes) {
      if (!s?.points?.length) continue;
      const pts = s.points.length === 1 ? [s.points[0], { x: s.points[0].x + 0.01, y: s.points[0].y }] : s.points;
      const c: Rgba = s.color ?? { r: 0, g: 0, b: 0, a: 1 };
      out.push(
        `<polyline points="${pts.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')}" fill="none" stroke="${rgb(c)}"` +
          ` stroke-opacity="${n(clamp01(c.a))}" stroke-width="${n(s.width, 4)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  }
  out.push('</svg>');
  return out.join('\n');
}
