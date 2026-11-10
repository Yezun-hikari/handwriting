/**
 * Tiny DOM helpers. All text goes through textContent; never innerHTML with dynamic data
 * (a yezun.de session token is shared across the subdomain apps).
 */
type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, ...children);
  return el;
}

export function append(el: Element, ...children: Child[]): void {
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  return el;
}

export function button(label: string, onClick: (e: MouseEvent) => void, attrs: Attrs = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'btn', ...attrs }, label);
  b.addEventListener('click', onClick);
  return b;
}

let toastTimer = 0;
/** Short status message (also announced to screen readers). */
export function toast(msg: string): void {
  const el = document.getElementById('toast');
  const live = document.getElementById('live');
  if (live) live.textContent = msg;
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}
