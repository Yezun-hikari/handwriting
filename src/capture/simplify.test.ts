import { describe, expect, it } from 'vitest';
import { dedupeClose, simplifyRdp } from './simplify.ts';

describe('simplifyRdp', () => {
  it('collapses collinear points to the end points', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 2 * i, p: i / 50 }));
    const r = simplifyRdp(pts, 0.01);
    expect(r).toEqual([pts[0], pts[49]]);
  });
  it('keeps corners and their pressure', () => {
    const pts = [
      { x: 0, y: 0, p: 0.1 },
      { x: 5, y: 0.001 },
      { x: 10, y: 0, p: 0.9 },
      { x: 10, y: 5 },
      { x: 10, y: 10, p: 0.3 },
    ];
    const r = simplifyRdp(pts, 0.1);
    expect(r).toEqual([pts[0], pts[2], pts[4]]);
  });
  it('keeps points of a circle within tolerance', () => {
    const pts = Array.from({ length: 400 }, (_, i) => {
      const a = (i / 399) * Math.PI * 2;
      return { x: Math.cos(a), y: Math.sin(a) };
    });
    const eps = 0.005;
    const r = simplifyRdp(pts, eps);
    expect(r.length).toBeLessThan(60);
    expect(r.length).toBeGreaterThan(10);
    // every dropped point is within eps of the polyline (sampled check via radius error)
    for (let i = 1; i < r.length; i++) {
      const mx = (r[i].x + r[i - 1].x) / 2;
      const my = (r[i].y + r[i - 1].y) / 2;
      expect(1 - Math.hypot(mx, my)).toBeLessThan(eps * 1.01);
    }
  });
  it('handles tiny input', () => {
    expect(simplifyRdp([], 1)).toEqual([]);
    expect(simplifyRdp([{ x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }]);
  });
});

describe('dedupeClose', () => {
  it('drops near duplicates but keeps the end point', () => {
    const r = dedupeClose(
      [
        { x: 0, y: 0 },
        { x: 0.01, y: 0 },
        { x: 1, y: 0 },
        { x: 1.01, y: 0 },
      ],
      0.1,
    );
    expect(r).toEqual([
      { x: 0, y: 0 },
      { x: 1.01, y: 0 },
    ]);
  });
});
