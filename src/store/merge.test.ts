import { describe, expect, it } from 'vitest';
import { glyphsToUpload, localFingerprint, needsDecision, planMerge, sameGlyph } from './merge.ts';

const g = (char: string, variant: number, x = 0.2, advance = 0.3) => ({ char, variant, strokes: [[{ x: 0, y: 0 }, { x, y: -0.4, p: 0.5 }]], advance });

describe('planMerge', () => {
  it('splits into new, conflicting, identical and unsupported', () => {
    const local = [g('a', 0), g('a', 1), g('b', 0, 0.9), g('c', 0), g('x', 12)];
    const remote = [g('a', 0), g('b', 0), g('z', 0)];
    const plan = planMerge(local, remote);
    expect(plan.add.map((x) => `${x.char}${x.variant}`)).toEqual(['a1', 'c0']);
    expect(plan.conflicts.map((x) => x.char)).toEqual(['b']);
    expect(plan.same).toBe(1);
    expect(plan.unsupported).toBe(1);
    expect(plan.remoteCount).toBe(3);
    expect(needsDecision(plan)).toBe(true);
    expect(glyphsToUpload(plan, false)).toHaveLength(2); // account glyph "b" is kept
    expect(glyphsToUpload(plan, true)).toHaveLength(3);
  });
  it('nothing to ask when the account already has everything', () => {
    const plan = planMerge([g('a', 0)], [g('a', 0), g('b', 0)]);
    expect(needsDecision(plan)).toBe(false);
  });
  it('tolerates float4 rounding of advance and ignores pressure', () => {
    const a = g('a', 0, 0.2, 0.123456789);
    const b = { ...g('a', 0, 0.2, 0.12345679), strokes: [[{ x: 0, y: 0 }, { x: 0.2, y: -0.4 }]] };
    expect(sameGlyph(a, b)).toBe(true);
    expect(sameGlyph(a, g('a', 0, 0.3))).toBe(false);
  });
  it('fingerprint changes with the local set, not with order', () => {
    expect(localFingerprint([g('a', 0), g('b', 0)])).toBe(localFingerprint([g('b', 0), g('a', 0)]));
    expect(localFingerprint([g('a', 0)])).not.toBe(localFingerprint([g('a', 0), g('b', 0)]));
  });
});
