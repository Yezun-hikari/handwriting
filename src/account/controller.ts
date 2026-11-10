/**
 * Account integration logic (framework-free, all side effects injected → unit-tested in controller.test.ts).
 *
 * - Registered user → glyphs in SupabaseGlyphStore, roaming settings in handwriting_settings.
 * - Guest (anonymous session) / signed out / backend not configured → LocalGlyphStore (this browser only).
 * - After a registered sign-in with local glyphs: offer to upload them (never overwriting account glyphs silently).
 */
import type { AuthUser } from '@yezun/konto';
import { describeStoreError } from '../store/errors.ts';
import { glyphsToUpload, localFingerprint, needsDecision, planMerge, type MergePlan } from '../store/merge.ts';
import type { RoamingSettings } from '../store/settings.ts';
import { SupabaseSettingsStore, type RemoteSettingsStore } from '../store/supabase-settings.ts';
import { SupabaseGlyphStore, type DbClient } from '../store/supabase.ts';
import type { GlyphStore } from '../store/types.ts';
import type { KeyValueStorage } from '../store/local.ts';
import type { Glyph } from '../types.ts';

export type AccountStatus = 'unconfigured' | 'signedOut' | 'guest' | 'registered';

export interface AccountState {
  status: AccountStatus;
  userId?: string;
  username?: string;
}

export function stateFor(user: AuthUser | null, configured: boolean): AccountState {
  if (!configured) return { status: 'unconfigured' };
  if (!user) return { status: 'signedOut' };
  if (user.isGuest || !user.username) return { status: 'guest', userId: user.id };
  return { status: 'registered', userId: user.id, username: user.username };
}

const sameState = (a: AccountState | null, b: AccountState): boolean =>
  !!a && a.status === b.status && a.userId === b.userId && a.username === b.username;

/** Short German label for the top bar chip. */
export function chipLabel(s: AccountState): string {
  switch (s.status) {
    case 'registered':
      return s.username!;
    case 'guest':
      return 'Gast';
    default:
      return 'nicht angemeldet';
  }
}

/** Where the glyphs are kept, as a German sentence. */
export function storageHintText(s: AccountState): string {
  switch (s.status) {
    case 'registered':
      return `Deine Schrift wird in deinem Konto „${s.username}“ gespeichert und ist auf allen Geräten verfügbar.`;
    case 'guest':
      return 'Nur registrierte Konten können die Schrift im Konto speichern. Als Gast bleibt sie nur in diesem Browser – registriere dich über „Gast“ oben rechts.';
    case 'signedOut':
      return 'Nicht angemeldet: Nur registrierte Konten können die Schrift im Konto speichern. Bis dahin bleibt sie nur in diesem Browser.';
    default:
      return 'Deine Schrift wird nur in diesem Browser gespeichert.';
  }
}

/** Answer of the upload dialog. `later` asks again next time; `skip` remembers the decision for this local set. */
export type MergeDecision = 'upload' | 'overwrite' | 'skip' | 'later';

export interface UploadStore extends GlyphStore {
  saveMany(glyphs: readonly Glyph[], onProgress?: (done: number) => void): Promise<void>;
}

export interface AccountDeps {
  configured: boolean;
  /** Current user, read fresh from the stored session. */
  readUser(): Promise<AuthUser | null>;
  /** Subscribe to SDK auth changes; returns unsubscribe. */
  onAuthChange(cb: (u: AuthUser | null) => void): () => void;
  getClient(): DbClient;
  setGlyphStore(s: GlyphStore): Promise<void>;
  localStore: GlyphStore;
  /** Factories (overridable in tests). */
  remoteGlyphs?(client: DbClient, userId: string): UploadStore;
  remoteSettings?(client: DbClient, userId: string): RemoteSettingsStore;
  settings: {
    current(): RoamingSettings;
    /** Apply account settings locally; true if something changed. */
    apply(s: Partial<RoamingSettings>): boolean;
    setSink(fn: ((s: RoamingSettings) => void) | null): void;
  };
  askMerge(plan: MergePlan): Promise<MergeDecision>;
  /** Remembers merge decisions per account (localStorage). */
  memory: KeyValueStorage;
  onState(s: AccountState): void;
  onSettingsApplied(): void;
  notify(msg: string, kind: 'info' | 'error'): void;
  /** Delay for pushing settings changes (ms). */
  settingsDebounceMs?: number;
}

export const mergeMemoryKey = (userId: string): string => `handwriting-merge-${userId}`;

export class AccountController {
  private state: AccountState | null = null;
  private gen = 0;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  private off: (() => void) | null = null;
  /** Resolves when the work for the latest state change (store switch, settings, merge offer) is done. */
  idle: Promise<void> = Promise.resolve();

  constructor(private readonly d: AccountDeps) {}

  get current(): AccountState {
    return this.state ?? stateFor(null, this.d.configured);
  }

  async start(): Promise<void> {
    if (!this.d.configured) {
      this.apply(null);
      return this.idle;
    }
    let user: AuthUser | null = null;
    try {
      user = await this.d.readUser();
    } catch {
      user = null;
    }
    this.apply(user);
    this.off = this.d.onAuthChange((u) => this.apply(u));
    return this.idle;
  }

  /** Re-read the stored session (e.g. after returning from the account page via bfcache, or another tab). */
  async refresh(): Promise<void> {
    if (!this.d.configured) return;
    try {
      this.apply(await this.d.readUser());
    } catch {
      /* keep current state */
    }
    return this.idle;
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.d.settings.setSink(null);
  }

  /** Switch to the state of `user`; no-op if unchanged. */
  apply(user: AuthUser | null): void {
    const next = stateFor(user, this.d.configured);
    if (sameState(this.state, next)) return;
    this.state = next;
    const gen = ++this.gen;
    this.d.onState(next);
    this.idle = (next.status === 'registered' ? this.enterAccount(next.userId!, gen) : this.enterLocal()).catch((e) =>
      this.d.notify(describeStoreError(e), 'error'),
    );
  }

  private stale = (gen: number): boolean => gen !== this.gen;

  private async enterLocal(): Promise<void> {
    this.d.settings.setSink(null);
    this.clearSettingsTimer();
    await this.d.setGlyphStore(this.d.localStore);
  }

  private async enterAccount(userId: string, gen: number): Promise<void> {
    const client = this.d.getClient();
    const glyphs = (this.d.remoteGlyphs ?? ((c, id) => new SupabaseGlyphStore(c, id)))(client, userId);
    const settings = (this.d.remoteSettings ?? ((c, id) => new SupabaseSettingsStore(c, id)))(client, userId);

    let loaded = true;
    try {
      await this.d.setGlyphStore(glyphs);
    } catch (e) {
      loaded = false;
      this.d.notify(`Schrift aus dem Konto konnte nicht geladen werden. ${describeStoreError(e)}`, 'error');
    }
    if (this.stale(gen)) return;

    await this.syncSettings(settings, gen);
    if (this.stale(gen) || !loaded) return;
    await this.offerUpload(userId, glyphs, gen);
  }

  private clearSettingsTimer(): void {
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
  }

  private async syncSettings(store: RemoteSettingsStore, gen: number): Promise<void> {
    try {
      const remote = await store.load();
      if (this.stale(gen)) return;
      if (remote && Object.keys(remote).length) {
        if (this.d.settings.apply(remote)) this.d.onSettingsApplied();
      } else {
        await store.save(this.d.settings.current()); // first sign-in: the account takes this device's settings
      }
    } catch (e) {
      if (!this.stale(gen)) this.d.notify(`Einstellungen aus dem Konto nicht verfügbar. ${describeStoreError(e)}`, 'error');
    }
    if (this.stale(gen)) return;
    this.d.settings.setSink((s) => {
      this.clearSettingsTimer();
      this.settingsTimer = setTimeout(() => {
        this.settingsTimer = null;
        if (this.stale(gen)) return;
        store.save(s).catch((e) => this.d.notify(`Einstellungen nicht im Konto gespeichert. ${describeStoreError(e)}`, 'error'));
      }, this.d.settingsDebounceMs ?? 800);
    });
  }

  private remember(userId: string, fp: string): void {
    try {
      this.d.memory.setItem(mergeMemoryKey(userId), fp);
    } catch {
      /* ignore */
    }
  }

  private async offerUpload(userId: string, account: UploadStore, gen: number): Promise<void> {
    const local = await this.d.localStore.load();
    if (!local.length) return;
    const fp = localFingerprint(local);
    let seen: string | null = null;
    try {
      seen = this.d.memory.getItem(mergeMemoryKey(userId));
    } catch {
      /* ignore */
    }
    if (seen === fp) return;

    const remote = await account.load();
    if (this.stale(gen)) return;
    const plan = planMerge(local, remote);
    if (!needsDecision(plan)) {
      this.remember(userId, fp);
      return;
    }
    const decision = await this.d.askMerge(plan);
    if (this.stale(gen) || decision === 'later') return;
    if (decision === 'skip') {
      this.remember(userId, fp);
      return;
    }
    const list = glyphsToUpload(plan, decision === 'overwrite');
    try {
      await account.saveMany(list);
    } catch (e) {
      this.d.notify(`Hochladen fehlgeschlagen. ${describeStoreError(e)}`, 'error');
      return;
    }
    this.remember(userId, fp);
    if (this.stale(gen)) return;
    await this.d.setGlyphStore(account); // reload the cache with the merged set
    this.d.notify(`${list.length} Zeichen ins Konto übernommen.`, 'info');
  }
}
