/**
 * A tiny synthetic single-line "handwriting" glyph set in glyph space (unit = ruled line pitch,
 * baseline y = 0, y down; x-height 0.45, cap height 0.75, descender 0.3). Used by tests and as
 * a demo fallback when the user has not captured any glyphs yet.
 */
import type { Glyph, Stroke } from '../types.ts';

type Shape = number[][]; // list of polylines, each a flat [x0, y0, x1, y1, ...]

const L = (...xy: number[]): number[] => xy;

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, steps = 16): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return out;
}
const ell = (cx: number, cy: number, rx: number, ry: number) => arc(cx, cy, rx, ry, -30, -390, 20);
const dot = (x: number, y: number) => L(x, y, x + 0.008, y + 0.004);

const lowerO = ell(0.15, -0.225, 0.15, 0.225);
const archH = L(0, -0.3, 0.1, -0.43, 0.2, -0.45, 0.28, -0.38, 0.3, -0.3, 0.3, 0);

const SHAPES: Record<string, Shape> = {
  a: [lowerO, L(0.3, -0.45, 0.3, 0)],
  b: [L(0, -0.75, 0, 0), ell(0.15, -0.225, 0.15, 0.225)],
  c: [arc(0.15, -0.225, 0.15, 0.225, -40, -320)],
  d: [lowerO, L(0.3, -0.75, 0.3, 0)],
  e: [L(0, -0.225, 0.3, -0.225), arc(0.15, -0.225, 0.15, 0.225, 0, -320)],
  f: [L(0.25, -0.72, 0.12, -0.74, 0.08, -0.6, 0.08, 0), L(0, -0.45, 0.22, -0.45)],
  g: [lowerO, L(0.3, -0.45, 0.3, 0.2), arc(0.15, 0.2, 0.15, 0.1, 0, 160)],
  h: [L(0, -0.75, 0, 0), archH],
  i: [L(0, -0.45, 0, 0), dot(0, -0.62)],
  j: [L(0.1, -0.45, 0.1, 0.2, 0.05, 0.3, -0.05, 0.25), dot(0.1, -0.62)],
  k: [L(0, -0.75, 0, 0), L(0.28, -0.45, 0, -0.18, 0.3, 0)],
  l: [L(0, -0.75, 0, 0)],
  m: [
    L(0, -0.45, 0, 0),
    L(0, -0.3, 0.08, -0.43, 0.15, -0.43, 0.2, -0.35, 0.2, 0),
    L(0.2, -0.35, 0.25, -0.43, 0.33, -0.43, 0.4, -0.3, 0.4, 0),
  ],
  n: [L(0, -0.45, 0, 0), archH],
  o: [lowerO],
  p: [L(0, -0.45, 0, 0.3), ell(0.15, -0.225, 0.15, 0.225)],
  q: [lowerO, L(0.3, -0.45, 0.3, 0.3)],
  r: [L(0, -0.45, 0, 0), L(0, -0.3, 0.08, -0.42, 0.2, -0.45)],
  s: [L(0.25, -0.42, 0.15, -0.45, 0.04, -0.4, 0.04, -0.3, 0.15, -0.24, 0.26, -0.17, 0.26, -0.05, 0.15, 0, 0.02, -0.04)],
  t: [L(0.1, -0.68, 0.1, -0.05, 0.15, 0, 0.22, -0.02), L(0, -0.45, 0.22, -0.45)],
  u: [L(0, -0.45, 0, -0.1, 0.05, -0.01, 0.15, 0, 0.25, -0.05, 0.3, -0.15), L(0.3, -0.45, 0.3, 0)],
  v: [L(0, -0.45, 0.15, 0, 0.3, -0.45)],
  w: [L(0, -0.45, 0.1, 0, 0.2, -0.35, 0.3, 0, 0.4, -0.45)],
  x: [L(0, -0.45, 0.3, 0), L(0.3, -0.45, 0, 0)],
  y: [L(0, -0.45, 0.15, 0), L(0.3, -0.45, 0.1, 0.2, 0, 0.3)],
  z: [L(0, -0.45, 0.3, -0.45, 0, 0, 0.3, 0)],
  ß: [L(0, 0.2, 0, -0.6, 0.08, -0.73, 0.2, -0.75, 0.3, -0.67, 0.3, -0.55, 0.18, -0.45, 0.32, -0.32, 0.33, -0.12, 0.22, 0, 0.1, -0.02)],

  A: [L(0, 0, 0.22, -0.75, 0.44, 0), L(0.08, -0.27, 0.36, -0.27)],
  B: [L(0, 0, 0, -0.75, 0.2, -0.75, 0.3, -0.65, 0.3, -0.48, 0.2, -0.4, 0, -0.4), L(0.2, -0.4, 0.33, -0.3, 0.33, -0.1, 0.22, 0, 0, 0)],
  C: [arc(0.25, -0.375, 0.25, 0.375, -40, -320)],
  D: [L(0, 0, 0, -0.75, 0.15, -0.75), arc(0.15, -0.375, 0.2, 0.375, -90, 90), L(0.15, 0, 0, 0)],
  E: [L(0.32, -0.75, 0, -0.75, 0, 0, 0.32, 0), L(0, -0.38, 0.25, -0.38)],
  F: [L(0.32, -0.75, 0, -0.75, 0, 0), L(0, -0.38, 0.25, -0.38)],
  G: [arc(0.25, -0.375, 0.25, 0.375, -40, -340), L(0.3, -0.3, 0.48, -0.3, 0.48, -0.1)],
  H: [L(0, -0.75, 0, 0), L(0.38, -0.75, 0.38, 0), L(0, -0.38, 0.38, -0.38)],
  I: [L(0, -0.75, 0, 0)],
  J: [L(0.25, -0.75, 0.25, -0.1, 0.15, 0, 0.05, -0.02, 0, -0.1)],
  K: [L(0, -0.75, 0, 0), L(0.32, -0.75, 0, -0.3), L(0.08, -0.38, 0.34, 0)],
  L: [L(0, -0.75, 0, 0, 0.3, 0)],
  M: [L(0, 0, 0.03, -0.75, 0.25, -0.25, 0.47, -0.75, 0.5, 0)],
  N: [L(0, 0, 0, -0.75, 0.38, 0, 0.38, -0.75)],
  O: [ell(0.27, -0.375, 0.27, 0.375)],
  P: [L(0, 0, 0, -0.75, 0.2, -0.75, 0.3, -0.65, 0.3, -0.45, 0.2, -0.37, 0, -0.37)],
  Q: [ell(0.27, -0.375, 0.27, 0.375), L(0.3, -0.12, 0.5, 0.05)],
  R: [L(0, 0, 0, -0.75, 0.2, -0.75, 0.3, -0.65, 0.3, -0.45, 0.2, -0.37, 0, -0.37), L(0.12, -0.37, 0.34, 0)],
  S: [L(0.32, -0.68, 0.2, -0.75, 0.06, -0.72, 0.02, -0.6, 0.08, -0.45, 0.26, -0.32, 0.34, -0.18, 0.3, -0.05, 0.18, 0, 0.03, -0.05)],
  T: [L(0, -0.75, 0.4, -0.75), L(0.2, -0.75, 0.2, 0)],
  U: [L(0, -0.75, 0, -0.15, 0.06, -0.03, 0.18, 0, 0.3, -0.03, 0.36, -0.15, 0.36, -0.75)],
  V: [L(0, -0.75, 0.2, 0, 0.4, -0.75)],
  W: [L(0, -0.75, 0.12, 0, 0.27, -0.55, 0.42, 0, 0.54, -0.75)],
  X: [L(0, -0.75, 0.38, 0), L(0.38, -0.75, 0, 0)],
  Y: [L(0, -0.75, 0.2, -0.38, 0.4, -0.75), L(0.2, -0.38, 0.2, 0)],
  Z: [L(0, -0.75, 0.38, -0.75, 0, 0, 0.38, 0)],

  '0': [ell(0.18, -0.375, 0.18, 0.375)],
  '1': [L(0, -0.6, 0.15, -0.75, 0.15, 0)],
  '2': [L(0, -0.6, 0.08, -0.72, 0.2, -0.75, 0.3, -0.68, 0.3, -0.52, 0, 0, 0.32, 0)],
  '3': [L(0, -0.7, 0.12, -0.75, 0.25, -0.72, 0.3, -0.6, 0.25, -0.45, 0.12, -0.4, 0.28, -0.33, 0.32, -0.18, 0.25, -0.04, 0.12, 0, 0, -0.05)],
  '4': [L(0.25, 0, 0.25, -0.75, 0, -0.25, 0.35, -0.25)],
  '5': [L(0.3, -0.75, 0.03, -0.75, 0, -0.42, 0.15, -0.47, 0.28, -0.4, 0.32, -0.22, 0.25, -0.05, 0.12, 0, 0, -0.05)],
  '6': [L(0.28, -0.72, 0.15, -0.73, 0.05, -0.6, 0, -0.35, 0, -0.15), ell(0.16, -0.2, 0.16, 0.2)],
  '7': [L(0, -0.75, 0.32, -0.75, 0.1, 0)],
  '8': [ell(0.16, -0.57, 0.13, 0.18), ell(0.16, -0.2, 0.16, 0.2)],
  '9': [ell(0.15, -0.55, 0.15, 0.2), L(0.3, -0.55, 0.28, -0.2, 0.2, 0)],

  '.': [dot(0, 0)],
  ',': [L(0.03, -0.03, 0, 0.12)],
  '!': [L(0, -0.75, 0, -0.2), dot(0, 0)],
  '?': [L(0, -0.62, 0.08, -0.72, 0.18, -0.75, 0.28, -0.68, 0.28, -0.52, 0.14, -0.38, 0.14, -0.22), dot(0.14, 0)],
  '-': [L(0, -0.25, 0.22, -0.25)],
  ':': [dot(0, -0.35), dot(0, 0)],
  ';': [dot(0.03, -0.35), L(0.03, -0.03, 0, 0.12)],
  "'": [L(0, -0.75, 0, -0.6)],
  '"': [L(0, -0.75, 0, -0.6), L(0.08, -0.75, 0.08, -0.6)],
  '(': [arc(0.25, -0.3, 0.25, 0.5, -125, -235)],
  ')': [arc(-0.1, -0.3, 0.25, 0.5, -55, 55)],
};

function shift(shape: Shape, dx: number): Shape {
  return shape.map((pl) => pl.map((v, i) => (i % 2 === 0 ? v + dx : v)));
}
function width(shape: Shape): number {
  let max = -Infinity;
  let min = Infinity;
  for (const pl of shape) for (let i = 0; i < pl.length; i += 2) (max = Math.max(max, pl[i])), (min = Math.min(min, pl[i]));
  return max - min;
}
function concat(...shapes: Shape[]): Shape {
  const out: Shape = [];
  let x = 0;
  for (const s of shapes) {
    out.push(...shift(s, x));
    x += width(s) + 0.06;
  }
  return out;
}

// Umlauts and ligatures.
const dots = (x: number, y: number): Shape => [dot(x, y), dot(x + 0.14, y)];
SHAPES['ä'] = [...SHAPES.a, ...dots(0.08, -0.6)];
SHAPES['ö'] = [...SHAPES.o, ...dots(0.08, -0.6)];
SHAPES['ü'] = [...SHAPES.u, ...dots(0.08, -0.6)];
SHAPES['Ä'] = [...SHAPES.A, ...dots(0.15, -0.9)];
SHAPES['Ö'] = [...SHAPES.O, ...dots(0.2, -0.9)];
SHAPES['Ü'] = [...SHAPES.U, ...dots(0.11, -0.9)];
SHAPES.ch = concat(SHAPES.c, SHAPES.h);
SHAPES.sch = concat(SHAPES.s, SHAPES.c, SHAPES.h);

/** Characters/ligatures available in the synthetic set. */
export const SYNTHETIC_KEYS = Object.keys(SHAPES);

/**
 * Build the synthetic glyph set. Each variant is slightly sheared/stretched so variants differ.
 * `only` restricts the set to the given keys.
 */
export function makeSyntheticGlyphs(variants = 2, only?: string[]): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const key of only ?? SYNTHETIC_KEYS) {
    const shape = SHAPES[key];
    if (!shape) continue;
    for (let v = 0; v < variants; v++) {
      const shear = 0.12 + 0.04 * v; // slight right slant, more per variant
      const sx = 1 + 0.03 * v;
      const strokes: Stroke[] = shape.map((pl) => {
        const s: Stroke = [];
        for (let i = 0; i < pl.length; i += 2) s.push({ x: pl[i] * sx - pl[i + 1] * shear, y: pl[i + 1] });
        return s;
      });
      let minX = Infinity;
      let maxX = -Infinity;
      for (const s of strokes) for (const p of s) (minX = Math.min(minX, p.x)), (maxX = Math.max(maxX, p.x));
      for (const s of strokes) for (const p of s) p.x -= minX;
      glyphs.push({ char: key, variant: v, strokes, advance: maxX - minX + 0.1 });
    }
  }
  return glyphs;
}
