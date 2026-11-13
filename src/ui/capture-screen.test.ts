// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameFor } from '../capture/geometry.ts';
import type { FieldOptions } from '../capture/field.ts';
import { setGlyphStore } from '../store/repo.ts';
import type { GlyphStore } from '../store/types.ts';
import type { Glyph, Point } from '../types.ts';

// The real field draws on a 2D canvas, which happy-dom does not provide. The screen only needs its strokes and onChange.
const fields: FakeField[] = [];
class FakeField {
  readonly canvas = document.createElement('canvas');
  readonly frame = frameFor(40);
  strokes: Point[][] = [];
  constructor(readonly opts: FieldOptions) {
    fields.push(this);
  }
  get isEmpty(): boolean {
    return !this.strokes.length;
  }
  setGlyph(g: Glyph | undefined): void {
    if (!g) this.strokes = [];
  }
  draw(): void {
    this.strokes.push([
      { x: 10, y: 30 },
      { x: 30, y: 50 },
    ]);
    this.opts.onChange(this as never);
  }
  redraw(): void {}
  destroy(): void {}
  undo(): void {}
  clear(): void {}
}
vi.mock('../capture/field.ts', () => ({ CaptureField: FakeField }));

const { captureScreen } = await import('./capture-screen.ts');

type TestStore = GlyphStore & { saved: string[] };
const store = (): TestStore => ({
  saved: [],
  load: async () => [],
  async save(g) {
    this.saved.push(`${g.char}${g.variant}`);
  },
  remove: async () => {},
});
const tick = () => new Promise((r) => setTimeout(r, 0));

let unmount: void | (() => void);
afterEach(() => {
  if (typeof unmount === 'function') unmount();
  fields.length = 0;
  document.body.replaceChildren();
});

describe('capture screen: pending saves on store switch', () => {
  it('a stroke drawn just before sign-in is saved into the store it was drawn for, not the account', async () => {
    const local = store();
    await setGlyphStore(local);
    const root = document.createElement('div');
    document.body.append(root);
    unmount = captureScreen.mount(root, new URLSearchParams('c=a'));
    await tick();
    expect(fields).toHaveLength(3);

    fields[0].draw(); // debounced save (700 ms) is pending
    expect(local.saved).toEqual([]);
    const account = store();
    await setGlyphStore(account); // sign-in before the debounce fired
    await tick();

    expect(local.saved).toEqual(['a0']);
    expect(account.saved).toEqual([]);
    expect(fields[0].isEmpty).toBe(true); // the old store's drawing is no longer shown
  });
});
