import type { Glyph } from '../types.ts';
import { StoreError } from './errors.ts';
import { LocalGlyphStore, type KeyValueStorage } from './local.ts';
import type { GlyphStore } from './types.ts';

/** localStorage key of the offline copy of an account's glyphs. */
export const accountCacheKey = (userId: string): string => `handwriting-glyphs-account-${userId}`;

/** A glyph store that can also upload many glyphs at once (the account). */
export interface AccountGlyphStore extends GlyphStore {
  saveMany(glyphs: readonly Glyph[], onProgress?: (done: number) => void): Promise<void>;
}

const isOffline = (e: unknown): boolean => (e instanceof StoreError && e.kind === 'offline') || e instanceof TypeError;

/**
 * Account store with an offline copy in this browser: every successful load / write updates the copy, and a load
 * that fails for lack of network returns the copy instead (`fromCache` is then true). Writes are not queued: offline
 * they fail as before.
 */
export class CachedGlyphStore implements AccountGlyphStore {
  private readonly cache: LocalGlyphStore;
  fromCache = false;

  constructor(
    private readonly remote: AccountGlyphStore,
    storage: KeyValueStorage,
    readonly userId: string,
  ) {
    this.cache = new LocalGlyphStore(storage, accountCacheKey(userId));
  }

  /** Cache writes are best effort: a full localStorage must not fail a successful account write. */
  private keep(fn: () => Promise<void>): Promise<void> {
    return fn().catch(() => {});
  }

  async load(): Promise<Glyph[]> {
    try {
      const gs = await this.remote.load();
      this.fromCache = false;
      await this.keep(() => this.cache.replaceAll(gs));
      return gs;
    } catch (e) {
      const copy = isOffline(e) ? await this.cache.load() : [];
      if (!copy.length) throw e;
      this.fromCache = true;
      return copy;
    }
  }

  async save(g: Glyph): Promise<void> {
    await this.remote.save(g);
    await this.keep(() => this.cache.save(g));
  }

  async remove(char: string, variant: number): Promise<void> {
    await this.remote.remove(char, variant);
    await this.keep(() => this.cache.remove(char, variant));
  }

  async saveMany(glyphs: readonly Glyph[], onProgress?: (done: number) => void): Promise<void> {
    await this.remote.saveMany(glyphs, onProgress);
    await this.keep(async () => {
      for (const g of glyphs) await this.cache.save(g);
    });
  }
}
