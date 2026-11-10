import type { Glyph } from '../types.ts';
import { LocalGlyphStore } from './local.ts';
import { glyphKey, type GlyphStore } from './types.ts';

/**
 * In-memory cache over the active GlyphStore, shared by all screens.
 * Integration: call `setGlyphStore(new SupabaseGlyphStore(client, userId))` after login
 * (see src/ui/auth-hook.ts); listeners re-render.
 */
let store: GlyphStore | null = null;
let cache = new Map<string, Glyph>();
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach((l) => l());

function activeStore(): GlyphStore {
  return (store ??= new LocalGlyphStore());
}

let gate: Promise<void> = Promise.resolve();
let openGate: (() => void) | null = null;

/**
 * Delays loading until the store is chosen (the account check at startup is async), so screens never show this
 * browser's glyphs first and then jump to the account's. Released by the next setGlyphStore() or after `maxMs`.
 */
export function holdGlyphStore(maxMs = 5000): void {
  if (openGate) return;
  gate = new Promise<void>((resolve) => {
    const t = setTimeout(release, maxMs);
    function release(): void {
      clearTimeout(t);
      openGate = null;
      resolve();
    }
    openGate = release;
  });
}

export function setGlyphStore(s: GlyphStore): Promise<void> {
  store = s;
  cache = new Map();
  loaded = null;
  openGate?.();
  emit();
  return ensureLoaded();
}

export function ensureLoaded(): Promise<void> {
  if (loaded) return loaded;
  const p: Promise<void> = gate
    .then(() => {
      if (loaded !== p) return ensureLoaded(); // superseded by setGlyphStore() while waiting: follow the new load
      const st = activeStore();
      return st.load().then((gs) => {
        if (st !== store) return; // store switched meanwhile: ignore stale data
        cache = new Map(gs.map((g) => [glyphKey(g.char, g.variant), g]));
        emit();
      });
    })
    .catch((e: unknown) => {
      if (loaded === p) loaded = null;
      throw e;
    });
  loaded = p;
  return p;
}

export const allGlyphs = (): Glyph[] => [...cache.values()];
export const getGlyph = (char: string, variant: number): Glyph | undefined => cache.get(glyphKey(char, variant));

export async function saveGlyph(g: Glyph): Promise<void> {
  cache.set(glyphKey(g.char, g.variant), g);
  emit();
  await activeStore().save(g);
}

export async function removeGlyph(char: string, variant: number): Promise<void> {
  if (cache.delete(glyphKey(char, variant))) emit();
  await activeStore().remove(char, variant);
}

export function onGlyphsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Count captured fields among the given chars × variants. */
export function countCaptured(chars: readonly string[], variants: number): number {
  let n = 0;
  for (const c of chars) for (let v = 0; v < variants; v++) if (cache.has(glyphKey(c, v))) n++;
  return n;
}
