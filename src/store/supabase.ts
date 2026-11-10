import type { Glyph } from '../types.ts';
import type { GlyphStore } from './types.ts';
import { toGlyph } from './validate.ts';

/*
 * Supabase-backed store. No supabase dependency here: pass the shared client (supabase-js v2)
 * from the yezun.de auth module; it satisfies `SupabaseClientLike` structurally (cast if the
 * generics get in the way: `client as unknown as SupabaseClientLike`).
 *
 * Expected table (SQL for the integration migration):
 *
 *   create table public.handwriting_glyphs (
 *     user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 *     char text not null check (char_length(char) between 1 and 16),
 *     variant smallint not null check (variant between 0 and 99),
 *     strokes jsonb not null,
 *     advance real not null,
 *     updated_at timestamptz not null default now(),
 *     primary key (user_id, char, variant)
 *   );
 *   alter table public.handwriting_glyphs enable row level security;
 *   create policy "own glyphs" on public.handwriting_glyphs for all
 *     using (auth.uid() = user_id) with check (auth.uid() = user_id);
 */

export interface PgError {
  message: string;
}
export interface PgResult<T> {
  data: T | null;
  error: PgError | null;
}
export interface FilterLike<T> extends PromiseLike<PgResult<T>> {
  eq(column: string, value: unknown): FilterLike<T>;
}
export interface TableLike {
  select(columns: string): FilterLike<unknown[]>;
  upsert(row: Record<string, unknown>, options?: { onConflict?: string }): PromiseLike<PgResult<unknown>>;
  delete(): FilterLike<unknown>;
}
export interface SupabaseClientLike {
  from(table: string): TableLike;
}

export const GLYPH_TABLE = 'handwriting_glyphs';

export class SupabaseGlyphStore implements GlyphStore {
  constructor(
    private readonly client: SupabaseClientLike,
    private readonly userId: string,
    private readonly table = GLYPH_TABLE,
  ) {}

  async load(): Promise<Glyph[]> {
    const { data, error } = await this.client
      .from(this.table)
      .select('char,variant,strokes,advance')
      .eq('user_id', this.userId);
    if (error) throw new Error(error.message);
    const out: Glyph[] = [];
    for (const row of data ?? []) {
      const g = toGlyph(row);
      if (g) out.push(g);
    }
    return out;
  }

  async save(g: Glyph): Promise<void> {
    const { error } = await this.client.from(this.table).upsert(
      {
        user_id: this.userId,
        char: g.char.normalize('NFC'),
        variant: g.variant,
        strokes: g.strokes,
        advance: g.advance,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,char,variant' },
    );
    if (error) throw new Error(error.message);
  }

  async remove(char: string, variant: number): Promise<void> {
    const { error } = await this.client
      .from(this.table)
      .delete()
      .eq('user_id', this.userId)
      .eq('char', char.normalize('NFC'))
      .eq('variant', variant);
    if (error) throw new Error(error.message);
  }
}
