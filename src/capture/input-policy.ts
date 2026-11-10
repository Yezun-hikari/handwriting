/**
 * Palm rejection / input-type policy for the capture canvases (pure, unit-tested).
 *
 * - 'auto' (default): the Apple Pencil is always accepted. Finger and mouse work until a pen has
 *   been used; from then on touch is ignored (the palm rests on the screen while writing).
 *   Mouse stays allowed (no palms with a mouse).
 * - 'pen': only the pen.
 * - 'any': pen, touch and mouse (fallback toggle, e.g. writing with a finger) — but touch is still
 *   ignored while a pen stroke is in progress and shortly after it.
 * Independent of the mode: only one pointer draws at a time, and a pen going down cancels an
 * in-progress touch stroke (the palm usually lands first).
 */
export type InputMode = 'auto' | 'pen' | 'any';
export type PointerKind = 'pen' | 'touch' | 'mouse' | string;

export interface PolicyState {
  mode: InputMode;
  /** A pen has been seen in this session. */
  penSeen: boolean;
  /** Time of the last pen event (ms, event timestamp clock). */
  lastPenAt: number;
  /** Pointer currently drawing, if any. */
  active: { id: number; kind: PointerKind } | null;
}

/** Touch arriving within this many ms after pen activity is treated as palm, even in 'any'. */
export const PEN_GRACE_MS = 600;

export const initialPolicy = (mode: InputMode = 'auto'): PolicyState => ({
  mode,
  penSeen: false,
  lastPenAt: -Infinity,
  active: null,
});

export type DownDecision =
  /** Start a new stroke with this pointer. */
  | { action: 'start'; cancelActive: boolean }
  /** Ignore this pointer completely. */
  | { action: 'ignore'; reason: 'mode' | 'palm' | 'busy' };

/** Is this pointer type allowed at all in the current state (ignores the 'busy' check)? */
export function kindAllowed(s: PolicyState, kind: PointerKind, now: number): boolean {
  if (kind === 'pen') return true;
  if (s.mode === 'pen') return false;
  if (kind === 'touch') {
    if (s.active?.kind === 'pen' || now - s.lastPenAt < PEN_GRACE_MS) return false;
    if (s.mode === 'auto' && s.penSeen) return false;
    return true;
  }
  // mouse (or unknown types)
  return true;
}

/** Decide what to do on pointerdown. Pure: returns the decision and the next state. */
export function onDown(
  s: PolicyState,
  e: { pointerId: number; pointerType: PointerKind; timeStamp: number },
): { decision: DownDecision; state: PolicyState } {
  const kind = e.pointerType || 'mouse';
  const isPen = kind === 'pen';
  const base: PolicyState = isPen ? { ...s, penSeen: true, lastPenAt: e.timeStamp } : s;
  if (!kindAllowed(s, kind, e.timeStamp)) {
    return { decision: { action: 'ignore', reason: kind === 'touch' && s.mode !== 'pen' ? 'palm' : 'mode' }, state: base };
  }
  if (s.active) {
    // Pen beats an in-progress touch (that touch was most likely the palm).
    if (isPen && s.active.kind === 'touch') {
      return { decision: { action: 'start', cancelActive: true }, state: { ...base, active: { id: e.pointerId, kind } } };
    }
    return { decision: { action: 'ignore', reason: 'busy' }, state: base };
  }
  return { decision: { action: 'start', cancelActive: false }, state: { ...base, active: { id: e.pointerId, kind } } };
}

/** Should a move/up event of this pointer be processed? */
export const isActivePointer = (s: PolicyState, pointerId: number): boolean => s.active?.id === pointerId;

/** pointerup / pointercancel of the active pointer. */
export function onEnd(s: PolicyState, e: { pointerId: number; pointerType: PointerKind; timeStamp: number }): PolicyState {
  const pen = e.pointerType === 'pen' ? { lastPenAt: e.timeStamp } : {};
  if (s.active?.id !== e.pointerId) return { ...s, ...pen };
  return { ...s, ...pen, active: null };
}
