/**
 * Login hook (integration point). Today: always "nicht angemeldet" → glyphs live in this
 * browser's localStorage. Integration with the shared yezun.de auth:
 *   1. replace `getAuthState` / `onAuthStateChange` with the real auth module,
 *   2. on sign-in call `setGlyphStore(new SupabaseGlyphStore(client, user.id))` (src/store),
 *      on sign-out `setGlyphStore(new LocalGlyphStore())`,
 *   3. optionally offer to upload local glyphs once after the first sign-in.
 */
export interface AuthState {
  signedIn: boolean;
  /** Short German status text for the top bar. */
  label: string;
  userId?: string;
}

const NOT_SIGNED_IN: AuthState = { signedIn: false, label: 'nicht angemeldet' };

export function getAuthState(): AuthState {
  return NOT_SIGNED_IN;
}

export function onAuthStateChange(_fn: (s: AuthState) => void): () => void {
  return () => {};
}

/** Text shown where the storage location matters. */
export function storageHint(s: AuthState = getAuthState()): string {
  return s.signedIn
    ? 'Deine Schrift wird in deinem Konto gespeichert.'
    : 'Nicht angemeldet: deine Schrift wird nur in diesem Browser gespeichert.';
}
