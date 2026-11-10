import { describe, expect, it } from 'vitest';
import { frameFor } from './geometry.ts';
import { buildGlyph, denormalizeStrokes, normalizeStrokes } from './normalize.ts';

const frame = frameFor(100); // 100 px per pitch, baseline at 130 px

describe('normalizeStrokes', () => {
  it('maps baseline to y=0, pitch to 1 and shifts x to the left ink edge', () => {
    const r = normalizeStrokes(
      [
        [
          { x: 50, y: frame.baselinePx - 45 },
          { x: 50, y: frame.baselinePx },
        ],
        [
          { x: 90, y: frame.baselinePx - 45 },
          { x: 90, y: frame.baselinePx + 40 },
        ],
      ],
      frame,
      { rightGap: 0.1 },
    )!;
    expect(r.strokes[0]).toEqual([
      { x: 0, y: -0.45 },
      { x: 0, y: 0 },
    ]);
    expect(r.strokes[1]).toEqual([
      { x: 0.4, y: -0.45 },
      { x: 0.4, y: 0.4 },
    ]);
    expect(r.advance).toBeCloseTo(0.5, 6);
  });

  it('keeps pressure (rounded) and simplifies dense input', () => {
    const raw = Array.from({ length: 200 }, (_, i) => ({ x: 10 + i, y: frame.baselinePx, p: 0.33333 }));
    const r = normalizeStrokes([raw], frame)!;
    expect(r.strokes[0].length).toBe(2);
    expect(r.strokes[0][0].p).toBe(0.33);
    expect(r.strokes[0][1]).toEqual({ x: 1.99, y: 0, p: 0.33 });
  });

  it('turns a tap into a tiny visible segment', () => {
    const r = normalizeStrokes([[{ x: 30, y: frame.baselinePx - 70 }]], frame, { rightGap: 0 })!;
    expect(r.strokes[0]).toHaveLength(2);
    expect(r.strokes[0][0]).toEqual({ x: 0, y: -0.7 });
    expect(r.strokes[0][1].x).toBeGreaterThan(0);
    expect(r.advance).toBeGreaterThan(0);
  });

  it('returns null without ink', () => {
    expect(normalizeStrokes([], frame)).toBeNull();
    expect(normalizeStrokes([[]], frame)).toBeNull();
  });

  it('round-trips through denormalize (edit an existing glyph)', () => {
    const raw = [
      [
        { x: 20, y: 60 },
        { x: 70, y: 150 },
        { x: 120, y: 80 },
      ],
    ];
    const g = buildGlyph('a', 0, raw, frame)!;
    const back = denormalizeStrokes(g, frame);
    const again = buildGlyph('a', 0, back, frame)!;
    expect(again).toEqual(g);
  });

  it('NFC-normalises the char', () => {
    const g = buildGlyph('ä', 1, [[{ x: 0, y: 0 }, { x: 10, y: 10 }]], frame)!;
    expect(g.char).toBe('ä');
    expect(g.variant).toBe(1);
  });
});
