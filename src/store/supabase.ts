import type { SupabaseClient } from '@supabase/supabase-js';
import type { Glyph } from '../types.ts';
import { toStoreError } from './errors.ts';
import type { GlyphStore } from './types.ts';
import { DB_LIMITS, toGlyph, validChar, validVariant } from './validate.ts';

/**
 * Account-backed store on the shared yezun.de Supabase project (client from `@yezun/konto`'s getClient()).
 * Table `handwriting_glyphs` (migration in the konto repo, supabase/migrations/*_handwriting.sql):
 *   pk (user_id, char, variant), char 1..8 code points, variant 0..9, strokes jsonb (≤ 64 KiB), advance real 0..10,
 *   updated_at set by a trigger. RLS: own rows only, registered (non-anonymous) users only.
 * Only the `from` method of the client is used, so tests can pass a small fake.
 */
export type DbClient = Pick<SupabaseClient, 'from'>;
/** @deprecated old name; the real supabase-js client is accepted directly now. */
export type SupabaseClientLike = DbClient;

export const GLYPH_TABLE = 'handwriting_glyphs';
const CONFLICT = 'user_id,char,variant';
/** Rows per upsert request when uploading many glyphs (keeps request bodies well below 1 MB). */
export const UPLOAD_CHUNK = 40;

/** Limits of the table's check constraints; glyphs outside them cannot be stored in the account. */
export function fitsAccount(g: Glyph): boolean {
  return (
    validChar(g.char) &&
    validVariant(g.variant) &&
    Number.isFinite(g.advance) &&
    g.advance >= DB_LIMITS.advanceMin &&
    g.advance <= DB_LIMITS.advanceMax &&
    JSON.stringify(g.strokes).length <= DB_LIMITS.strokesJsonMax
  );
}

export class SupabaseGlyphStore implements GlyphStore {
  constructor(
    private readonly client: DbClient,
    readonly userId: string,
    private readonly table = GLYPH_TABLE,
  ) {}

  private row(g: Glyph) {
    return { user_id: this.userId, char: g.char.normalize('NFC'), variant: g.variant, strokes: g.strokes, advance: g.advance };
  }

  async load(): Promise<Glyph[]> {
    const { data, error, status } = await this.client
      .from(this.table)
      .select('char,variant,strokes,advance')
      .eq('user_id', this.userId);
    if (error) throw toStoreError(error, status);
    const out: Glyph[] = [];
    for (const row of (data ?? []) as unknown[]) {
      const g = toGlyph(row);
      if (g) out.push(g);
    }
    return out;
  }

  async save(g: Glyph): Promise<void> {
    const { error, status } = await this.client.from(this.table).upsert(this.row(g), { onConflict: CONFLICT });
    if (error) throw toStoreError(error, status);
  }

  /** Upserts many glyphs in chunks; `onProgress(done)` after each chunk. Stops at the first failing chunk. */
  async saveMany(glyphs: readonly Glyph[], onProgress?: (done: number) => void): Promise<void> {
    for (let i = 0; i < glyphs.length; i += UPLOAD_CHUNK) {
      const chunk = glyphs.slice(i, i + UPLOAD_CHUNK).map((g) => this.row(g));
      const { error, status } = await this.client.from(this.table).upsert(chunk, { onConflict: CONFLICT });
      if (error) throw toStoreError(error, status);
      onProgress?.(Math.min(glyphs.length, i + chunk.length));
    }
  }

  async remove(char: string, variant: number): Promise<void> {
    const { error, status } = await this.client
      .from(this.table)
      .delete()
      .eq('user_id', this.userId)
      .eq('char', char.normalize('NFC'))
      .eq('variant', variant);
    if (error) throw toStoreError(error, status);
  }
}
