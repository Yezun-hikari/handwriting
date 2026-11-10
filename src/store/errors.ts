/**
 * Errors of the account-backed stores, with German, user-presentable messages.
 * PostgREST reports RLS violations as code 42501; an expired/invalid JWT as PGRST301/PGRST303 or HTTP 401.
 */
export type StoreErrorKind = 'offline' | 'forbidden' | 'session' | 'quota' | 'server';

export interface PgErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export const STORE_MSG: Record<StoreErrorKind, string> = {
  offline: 'Keine Verbindung zum Server. Bitte Internetverbindung prüfen und erneut versuchen.',
  forbidden:
    'Keine Berechtigung: Nur registrierte Konten können die Schrift im Konto speichern. Bitte anmelden oder registrieren.',
  session: 'Deine Anmeldung ist abgelaufen. Bitte neu anmelden.',
  quota: 'Der Speicher ist voll – die Schrift konnte nicht gespeichert werden.',
  server: 'Der Server hat die Anfrage abgelehnt. Bitte später erneut versuchen.',
};

export class StoreError extends Error {
  constructor(
    readonly kind: StoreErrorKind,
    readonly detail?: string,
  ) {
    super(STORE_MSG[kind]);
    this.name = 'StoreError';
  }
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Classifies a PostgREST error object (or a thrown fetch error). */
export function classifyPgError(e: PgErrorLike | null | undefined, status?: number): StoreErrorKind {
  const code = e?.code ?? '';
  const msg = (e?.message ?? '').toLowerCase();
  if (code === '42501' || msg.includes('row-level security') || status === 403) return 'forbidden';
  if (code === 'PGRST301' || code === 'PGRST303' || status === 401 || msg.includes('jwt')) return 'session';
  if (isOffline() || msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed') || (status === 0 && !code))
    return 'offline';
  return 'server';
}

export const toStoreError = (e: PgErrorLike | null | undefined, status?: number): StoreError =>
  new StoreError(classifyPgError(e, status), e?.message);

/** German text for any error thrown by a store (StoreError, QuotaExceededError, fetch TypeError, …). */
export function describeStoreError(e: unknown): string {
  if (e instanceof StoreError) return e.message;
  if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'QuotaExceededError') return STORE_MSG.quota;
  if (e instanceof TypeError || isOffline()) return STORE_MSG.offline;
  if (e instanceof Error && e.message) return STORE_MSG[classifyPgError({ message: e.message })];
  return STORE_MSG.server;
}
