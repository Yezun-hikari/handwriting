import type { DocumentContent, Rgba } from '../types.ts';
import type { PaperGeometry } from './layout.ts';

const PAPER_RGB = { r: 0.973, g: 0.969, b: 0.914 };
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
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${rgb(PAPER_RGB)}"/>`);
  const count = Math.max(0, Math.min(1000, Math.floor(Number(paper.lineCount) || 0)));
  for (let i = 0; i < count; i++) {
    const y = paper.firstLineY + i * paper.pitch;
    out.push(`<rect x="0" y="${n(y - RULE_THICKNESS / 2)}" width="${W}" height="${n(RULE_THICKNESS, 4)}" fill="${rgb(RULE_RGB)}"/>`);
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
