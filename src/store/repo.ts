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
/**
 * Writes (glyph, or null = removed) made since the cache was last replaced from the store. A load that started before
 * them returns data without them, so they are re-applied on top of its result ("newer local write wins").
 */
let writes = new Map<string, Glyph | null>();
/** Incremented on every store switch; screens compare it to know their fields show another store's data. */
let generation = 0;
const listeners = new Set<() => void>();
const switchHooks = new Set<() => void>();

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

/**
 * Runs synchronously right before the store is switched, while the old store is still active: screens flush pending
 * (debounced) saves there. saveGlyph()/removeGlyph() pick their store synchronously, so those writes reach the OLD
 * store even though they complete after the switch.
 */
export function onBeforeStoreSwitch(fn: () => void): () => void {
  switchHooks.add(fn);
  return () => switchHooks.delete(fn);
}

/** Changes whenever setGlyphStore() switched (or reloaded) the store. */
export const glyphStoreGeneration = (): number => generation;

export function setGlyphStore(s: GlyphStore): Promise<void> {
  switchHooks.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a screen's flush must not block the switch */
    }
  });
  store = s;
  cache = new Map();
  writes = new Map();
  loaded = null;
  generation++;
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
        if (st !== store) return ensureLoaded(); // store switched meanwhile: ignore stale data, follow the new load
        const next = new Map(gs.map((g) => [glyphKey(g.char, g.variant), g]));
        // Saves / removals issued while the load was in flight are newer than its result.
        for (const [k, g] of writes) {
          if (g) next.set(k, g);
          else next.delete(k);
        }
        writes = new Map();
        cache = next;
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
  const st = activeStore(); // chosen now: a store switch while saving must not redirect this write
  const k = glyphKey(g.char, g.variant);
  cache.set(k, g);
  writes.set(k, g);
  emit();
  await st.save(g);
}

export async function removeGlyph(char: string, variant: number): Promise<void> {
  const st = activeStore();
  const k = glyphKey(char, variant);
  writes.set(k, null);
  if (cache.delete(k)) emit();
  await st.remove(char, variant);
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
