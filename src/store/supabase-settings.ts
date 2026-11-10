import { toStoreError } from './errors.ts';
import { parseRoaming, type RoamingSettings } from './settings.ts';
import type { DbClient } from './supabase.ts';

export const SETTINGS_TABLE = 'handwriting_settings';

/** Settings that follow the account (table handwriting_settings, one jsonb object per user, same RLS as glyphs). */
export interface RemoteSettingsStore {
  /** null when the account has no settings row yet. */
  load(): Promise<Partial<RoamingSettings> | null>;
  save(s: RoamingSettings): Promise<void>;
}

export class SupabaseSettingsStore implements RemoteSettingsStore {
  constructor(
    private readonly client: DbClient,
    readonly userId: string,
    private readonly table = SETTINGS_TABLE,
  ) {}

  async load(): Promise<Partial<RoamingSettings> | null> {
    const { data, error, status } = await this.client
      .from(this.table)
      .select('settings')
      .eq('user_id', this.userId)
      .maybeSingle();
    if (error) throw toStoreError(error, status);
    if (!data) return null;
    return parseRoaming((data as { settings?: unknown }).settings);
  }

  async save(s: RoamingSettings): Promise<void> {
    const { error, status } = await this.client
      .from(this.table)
      .upsert({ user_id: this.userId, settings: s }, { onConflict: 'user_id' });
    if (error) throw toStoreError(error, status);
  }
}
