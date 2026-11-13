/**
 * Wiring of the shared yezun.de account (`@yezun/konto`) into the app: top bar chip, storage hints,
 * store selection (see src/account/controller.ts), upload dialog and error notices.
 * No own login form: the chip links to the account page, which returns here after signing in.
 */
import { accountUrl, currentUser, getClient, isConfigured, loginUrl, onAuthChange, ready, type AuthUser } from '@yezun/konto';
import { AccountController, chipLabel, storageHintText, type AccountState, type MergeDecision } from '../account/controller.ts';
import { LocalGlyphStore } from '../store/local.ts';
import type { MergePlan } from '../store/merge.ts';
import { holdGlyphStore, setGlyphStore } from '../store/repo.ts';
import { applyRoaming, loadSettings, roamingOf, setRoamingSink } from '../store/settings.ts';
import { append, button, h, toast } from './dom.ts';

export type { AccountState };

let controller: AccountController | null = null;
const HINT_ATTR = 'data-storage-hint';

export const getAccountState = (): AccountState => controller?.current ?? { status: 'unconfigured' };

/** A paragraph with the storage hint that updates itself on sign-in / sign-out (plus login link when useful). */
export function storageHintEl(): HTMLElement {
  const el = h('p', { class: 'muted small storage-hint', [HINT_ATTR]: '' });
  fillHint(el, getAccountState());
  return el;
}

function fillHint(el: HTMLElement, s: AccountState): void {
  el.replaceChildren(storageHintText(s));
  el.dataset.status = s.status;
  if (s.status === 'guest' || s.status === 'signedOut') {
    el.append(' ', h('a', { href: loginUrl(), text: s.status === 'guest' ? 'Jetzt registrieren' : 'Anmelden oder registrieren' }));
  }
}

function renderChip(s: AccountState): void {
  const chip = document.querySelector<HTMLAnchorElement>('#auth-status');
  if (!chip) return;
  chip.textContent = chipLabel(s);
  chip.dataset.status = s.status;
  chip.dataset.signedIn = String(s.status === 'registered');
  if (s.status === 'unconfigured') {
    chip.removeAttribute('href');
    chip.title = 'Konten sind in dieser Version nicht eingerichtet – Speicherung nur in diesem Browser.';
  } else if (s.status === 'registered') {
    chip.href = accountUrl();
    chip.title = `Angemeldet als ${s.username} – Konto verwalten`;
  } else {
    chip.href = loginUrl();
    chip.title = s.status === 'guest' ? 'Gast-Sitzung – registrieren, um die Schrift im Konto zu speichern' : 'Anmelden oder registrieren';
  }
}

function onState(s: AccountState): void {
  renderChip(s);
  document.querySelectorAll<HTMLElement>(`[${HINT_ATTR}]`).forEach((el) => fillHint(el, s));
}

// ---------- notices ----------
function notice(msg: string, kind: 'info' | 'error'): void {
  if (kind === 'info') {
    toast(msg);
    return;
  }
  let box = document.getElementById('account-notice');
  if (!box) {
    box = h('div', { id: 'account-notice', class: 'account-notice', role: 'alert' });
    document.querySelector('.topbar')?.after(box);
  }
  let list = box.querySelector('ul');
  if (!list) {
    list = h('ul', { class: 'notice-list' });
    box.replaceChildren(list, button('Schließen', () => box!.remove(), { class: 'btn small-btn' }));
  }
  if ([...list.children].some((li) => li.textContent === msg)) return;
  list.append(h('li', { text: msg }));
  while (list.children.length > 3) list.firstElementChild!.remove();
}

// ---------- upload dialog ----------
/** Asks whether this browser's glyphs should go into the account. Text only via textContent. */
export function askMerge(plan: MergePlan, username: string): Promise<MergeDecision> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'merge-dialog', 'aria-labelledby': 'merge-title' });
    const overwrite = h('input', { type: 'checkbox', id: 'merge-overwrite' });
    const uploadBtn = button('', () => done(overwrite.checked ? 'overwrite' : 'upload'), { class: 'btn primary' });
    const label = (): void => {
      const n = plan.add.length + (overwrite.checked ? plan.conflicts.length : 0);
      uploadBtn.textContent = `${n} Zeichen übernehmen`;
      uploadBtn.disabled = n === 0;
    };
    overwrite.addEventListener('change', label);
    label();

    const facts = h('ul', { class: 'merge-facts' });
    facts.append(h('li', { text: `${plan.add.length} Zeichen sind neu und fehlen in deinem Konto.` }));
    if (plan.conflicts.length)
      facts.append(h('li', { text: `${plan.conflicts.length} Zeichen gibt es im Konto bereits in anderer Form – sie bleiben, außer du wählst unten „überschreiben“.` }));
    if (plan.same) facts.append(h('li', { text: `${plan.same} Zeichen sind schon identisch im Konto.` }));
    if (plan.unsupported) facts.append(h('li', { text: `${plan.unsupported} Zeichen können nicht im Konto gespeichert werden und bleiben nur hier.` }));
    facts.append(h('li', { text: `Im Konto sind bisher ${plan.remoteCount} Zeichen gespeichert.` }));

    append(
      dlg,
      h('h2', { id: 'merge-title', text: 'Schrift aus diesem Browser übernehmen?' }),
      h('p', { text: `Du bist jetzt als „${username}“ angemeldet. In diesem Browser ist noch Schrift gespeichert, die nicht in deinem Konto ist.` }),
      facts,
      plan.conflicts.length
        ? h('label', { class: 'check', for: 'merge-overwrite' }, overwrite, ` Auch die ${plan.conflicts.length} abweichenden Zeichen im Konto überschreiben`)
        : null,
      h('p', { class: 'muted small', text: 'Die Kopie in diesem Browser bleibt erhalten.' }),
      h(
        'div',
        { class: 'toolbar' },
        button('Später', () => done('later')),
        button('Nicht übernehmen', () => done('skip')),
        uploadBtn,
      ),
    );
    let settled = false;
    const done = (d: MergeDecision): void => {
      if (settled) return;
      settled = true;
      dlg.close();
      dlg.remove();
      resolve(d);
    };
    dlg.addEventListener('cancel', () => done('later'));
    document.body.append(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    uploadBtn.focus();
  });
}

// ---------- start ----------
/** Same mapping as the SDK's currentUser(), but read fresh from the stored session. */
function toUser(session: { user?: { id: string; is_anonymous?: boolean; email?: string } } | null): AuthUser | null {
  const u = session?.user;
  if (!u) return null;
  const isGuest = u.is_anonymous === true || !u.email;
  return { id: u.id, isGuest, username: isGuest ? null : (u.email ?? '').split('@')[0] };
}

async function readUser(): Promise<AuthUser | null> {
  await ready;
  const { data } = await getClient().auth.getSession();
  return toUser(data.session) ?? (data.session ? currentUser() : null);
}

/** Starts the account integration. Without VITE_SUPABASE_* the app runs in local-only mode. */
export function startAccount(opts: { onSettingsApplied: () => void }): AccountController {
  let configured = false;
  try {
    configured = isConfigured();
  } catch {
    configured = false;
  }
  if (configured) holdGlyphStore(); // screens wait until the account check decided where the glyphs live
  const c = new AccountController({
    configured,
    readUser,
    onAuthChange,
    getClient,
    setGlyphStore,
    localStore: new LocalGlyphStore(),
    settings: { current: () => roamingOf(loadSettings()), apply: applyRoaming, setSink: setRoamingSink },
    askMerge: (plan) => askMerge(plan, c.current.username ?? ''),
    memory: localStorage,
    onState,
    onSettingsApplied: opts.onSettingsApplied,
    notify: notice,
  });
  controller = c;
  onState(c.current);
  void c.start();
  if (configured) {
    // Coming back from the account page (bfcache), another tab signing in/out, or the tab becoming visible again.
    window.addEventListener('pageshow', (e) => e.persisted && void c.refresh());
    window.addEventListener('storage', (e) => (e.key === null || e.key.startsWith('yezun-games-auth')) && void c.refresh());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void c.refresh());
  }
  return c;
}
