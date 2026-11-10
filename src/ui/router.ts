/**
 * Hash router: `#/<id>?key=value`. Unknown ids fall back to 'start' (path '').
 * A screen's `mount` may return a cleanup function.
 */
export interface Screen {
  title: string;
  mount(root: HTMLElement, params: URLSearchParams): void | (() => void);
}

const screens = new Map<string, Screen>();
let outlet: HTMLElement | null = null;
let currentId = '';
let cleanup: void | (() => void);
const APP = 'Handschrift';

export function registerScreen(id: string, screen: Screen): void {
  screens.set(id, screen);
  if (outlet && id === currentId) render();
}

export function navigate(id: string, params?: Record<string, string>): void {
  const q = params ? '?' + new URLSearchParams(params) : '';
  location.hash = `#/${id}${q}`;
}

/** Update the query of the current route without re-rendering. */
export function replaceParams(params: Record<string, string>): void {
  const url = `#/${currentId}?${new URLSearchParams(params)}`;
  history.replaceState(history.state, '', url);
}

export const currentRoute = (): string => currentId;

/** Re-mount the current screen (e.g. after settings arrived from the account). */
export function refreshScreen(): void {
  render();
}

function render(): void {
  if (!outlet) return;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  currentId = screens.has(path) ? path : '';
  const screen = screens.get(currentId);
  if (!screen) return;
  cleanup?.();
  cleanup = undefined;
  outlet.replaceChildren();
  document.title = currentId === '' ? APP : `${screen.title} · ${APP}`;
  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((a) => {
    if (a.dataset.nav === currentId) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  cleanup = screen.mount(outlet, new URLSearchParams(query));
  outlet.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

export function startRouter(el: HTMLElement): void {
  outlet = el;
  window.addEventListener('hashchange', render);
  render();
}
