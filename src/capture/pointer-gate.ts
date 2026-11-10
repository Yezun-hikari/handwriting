import { initialPolicy, isActivePointer, onDown, onEnd, type InputMode, type PolicyState } from './input-policy.ts';

/**
 * Shared palm-rejection state for all capture fields on a screen (a palm may rest on a
 * neighbouring field). Wraps the pure policy in input-policy.ts.
 */
export class PointerGate {
  private state: PolicyState;
  private cancelOwner: (() => void) | null = null;

  constructor(mode: InputMode = 'auto') {
    this.state = initialPolicy(mode);
  }

  get mode(): InputMode {
    return this.state.mode;
  }
  set mode(m: InputMode) {
    this.state = { ...this.state, mode: m };
  }
  get penSeen(): boolean {
    return this.state.penSeen;
  }

  /** Returns true if the pointer may start a stroke. `cancel` aborts that stroke if a pen takes over. */
  down(e: PointerEvent, cancel: () => void): boolean {
    const r = onDown(this.state, e);
    this.state = r.state;
    if (r.decision.action !== 'start') return false;
    if (r.decision.cancelActive) this.cancelOwner?.();
    this.cancelOwner = cancel;
    return true;
  }

  owns(e: PointerEvent): boolean {
    return isActivePointer(this.state, e.pointerId);
  }

  end(e: PointerEvent): void {
    const wasActive = isActivePointer(this.state, e.pointerId);
    this.state = onEnd(this.state, e);
    if (wasActive) this.cancelOwner = null;
  }
}
