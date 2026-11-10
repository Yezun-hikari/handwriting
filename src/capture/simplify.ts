import type { Point } from '../types.ts';

/** Perpendicular distance of p from the segment a–b (falls back to point distance for a == b). */
function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer–Douglas–Peucker simplification. Keeps first and last point; drops points closer than
 * `epsilon` to the simplified polyline. Iterative (no recursion depth issues on long strokes).
 * Retained points keep all their fields (incl. pressure).
 */
export function simplifyRdp<T extends Point>(points: readonly T[], epsilon: number): T[] {
  const n = points.length;
  if (n <= 2 || epsilon <= 0) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: T[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Drops consecutive points closer than `minDist` (cheap pre-filter for very dense input). */
export function dedupeClose<T extends Point>(points: readonly T[], minDist: number): T[] {
  if (points.length <= 1) return points.slice();
  const out: T[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) out.push(points[i]);
  }
  // Always keep the true end point so the stroke does not get shorter.
  const end = points[points.length - 1];
  if (out[out.length - 1] !== end) {
    if (out.length > 1) out[out.length - 1] = end;
    else out.push(end);
  }
  return out;
}
