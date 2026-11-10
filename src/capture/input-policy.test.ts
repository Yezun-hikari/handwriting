import { describe, expect, it } from 'vitest';
import { initialPolicy, onDown, onEnd, PEN_GRACE_MS, type PolicyState } from './input-policy.ts';

const ev = (pointerId: number, pointerType: string, timeStamp: number) => ({ pointerId, pointerType, timeStamp });

function seq(s: PolicyState, ...events: [string, ReturnType<typeof ev>][]) {
  const decisions: string[] = [];
  for (const [kind, e] of events) {
    if (kind === 'down') {
      const r = onDown(s, e);
      s = r.state;
      decisions.push(r.decision.action === 'start' ? (r.decision.cancelActive ? 'start+cancel' : 'start') : `ignore:${r.decision.reason}`);
    } else s = onEnd(s, e);
  }
  return { s, decisions };
}

describe('input policy (palm rejection)', () => {
  it('auto: touch works until a pen is seen, then touch is ignored', () => {
    const { decisions } = seq(
      initialPolicy('auto'),
      ['down', ev(1, 'touch', 0)],
      ['up', ev(1, 'touch', 10)],
      ['down', ev(2, 'pen', 100)],
      ['up', ev(2, 'pen', 200)],
      ['down', ev(3, 'touch', 10_000)],
    );
    expect(decisions).toEqual(['start', 'start', 'ignore:palm']);
  });

  it('auto: mouse stays allowed after pen use', () => {
    const { decisions } = seq(initialPolicy('auto'), ['down', ev(2, 'pen', 0)], ['up', ev(2, 'pen', 5)], ['down', ev(9, 'mouse', 5000)]);
    expect(decisions).toEqual(['start', 'start']);
  });

  it('pen-only mode ignores touch and mouse', () => {
    const { decisions } = seq(initialPolicy('pen'), ['down', ev(1, 'touch', 0)], ['down', ev(2, 'mouse', 0)], ['down', ev(3, 'pen', 0)]);
    expect(decisions).toEqual(['ignore:mode', 'ignore:mode', 'start']);
  });

  it('any mode: touch allowed, but not during or right after a pen stroke', () => {
    const { decisions } = seq(
      initialPolicy('any'),
      ['down', ev(1, 'pen', 0)],
      ['down', ev(2, 'touch', 50)],
      ['up', ev(1, 'pen', 300)],
      ['down', ev(3, 'touch', 300 + PEN_GRACE_MS / 2)],
      ['down', ev(4, 'touch', 300 + PEN_GRACE_MS + 1)],
    );
    expect(decisions).toEqual(['start', 'ignore:palm', 'ignore:palm', 'start']);
  });

  it('a pen landing during a touch stroke cancels the touch (palm first)', () => {
    const { s, decisions } = seq(initialPolicy('any'), ['down', ev(1, 'touch', 0)], ['down', ev(2, 'pen', 20)]);
    expect(decisions).toEqual(['start', 'start+cancel']);
    expect(s.active).toEqual({ id: 2, kind: 'pen' });
  });

  it('only one pointer draws at a time', () => {
    const { s, decisions } = seq(initialPolicy('auto'), ['down', ev(1, 'pen', 0)], ['down', ev(2, 'pen', 1)], ['down', ev(3, 'mouse', 2)]);
    expect(decisions).toEqual(['start', 'ignore:busy', 'ignore:busy']);
    expect(s.active?.id).toBe(1);
  });

  it('ending a non-active pointer keeps the active one', () => {
    const { s } = seq(initialPolicy('auto'), ['down', ev(1, 'pen', 0)], ['up', ev(7, 'touch', 3)]);
    expect(s.active?.id).toBe(1);
    expect(onEnd(s, ev(1, 'pen', 9)).active).toBeNull();
  });
});
