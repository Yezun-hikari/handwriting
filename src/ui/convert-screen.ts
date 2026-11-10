import { allGlyphs, describeStoreError, ensureLoaded } from '../store/index.ts';
import { loadSettings, saveSettings } from '../store/settings.ts';
import type { DocumentContent } from '../types.ts';
import { convertDeps, type ConvertDeps } from './convert-deps.ts';
import { button, h, toast } from './dom.ts';
import type { Screen } from './router.ts';

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_TEXT_CHARS = 200_000;
const DRAFT_KEY = 'handwriting-convert-draft';

/** Convert screen; `deps` injectable for tests / integration. */
export function createConvertScreen(deps: ConvertDeps = convertDeps): Screen {
  return {
    title: 'Text umwandeln',
    mount(root) {
      const s = loadSettings();
      let draft = '';
      try {
        draft = localStorage.getItem(DRAFT_KEY) ?? '';
      } catch {
        /* ignore */
      }

      const text = h('textarea', {
        id: 'text',
        rows: 10,
        maxlength: MAX_TEXT_CHARS,
        placeholder: '# Überschrift\nHier deinen Text einfügen …',
        spellcheck: 'false',
      });
      text.value = draft;
      const file = h('input', { type: 'file', accept: '.txt,text/plain', id: 'file', class: 'sr-only' });
      const fileBtn = h('label', { for: 'file', class: 'btn' }, '.txt-Datei laden');

      const numInput = (id: string, v: number): HTMLInputElement =>
        h('input', { type: 'number', id, min: 0.1, max: 2, step: 0.05, value: v, inputmode: 'decimal' });
      const headW = numInput('head-w', s.headingWidthMm);
      const bodyW = numInput('body-w', s.bodyWidthMm);

      const msg = h('p', { class: 'msg', role: 'status' });
      const missingEl = h('p', { class: 'missing' });
      const preview = h('div', { class: 'preview', 'aria-label': 'Vorschau' });
      const pageLabel = h('span', { class: 'muted' });
      const prev = button('←', () => showPage(page - 1), { 'aria-label': 'Vorherige Seite', class: 'btn icon' });
      const next = button('→', () => showPage(page + 1), { 'aria-label': 'Nächste Seite', class: 'btn icon' });
      const download = button('Goodnotes-Datei herunterladen', () => void doDownload(), { class: 'btn primary big' });

      root.append(
        h(
          'section',
          { class: 'convert' },
          h('h1', { tabindex: '-1', text: 'Text umwandeln' }),
          h('p', { class: 'muted', text: 'Zeilen, die mit # beginnen, werden als Überschrift geschrieben.' }),
          h('label', { for: 'text', class: 'label', text: 'Text' }),
          text,
          h('div', { class: 'row' }, fileBtn, file, h('span', { class: 'muted small', text: `max. ${MAX_FILE_BYTES / 1024} KB, UTF-8` })),
          h(
            'div',
            { class: 'options' },
            h('label', { for: 'head-w' }, 'Stiftbreite Überschrift (mm)', headW),
            h('label', { for: 'body-w' }, 'Stiftbreite Text (mm)', bodyW),
          ),
          msg,
          missingEl,
          h('div', { class: 'pager' }, prev, pageLabel, next),
          preview,
          h('div', { class: 'menu' }, download),
        ),
      );

      let doc: DocumentContent | null = null;
      let page = 0;
      let timer = 0;
      let blobUrl = '';

      function setMsg(t: string, err = false): void {
        msg.textContent = t;
        msg.classList.toggle('error', err);
      }

      function run(): void {
        const t = text.value;
        try {
          localStorage.setItem(DRAFT_KEY, t.slice(0, 20000));
        } catch {
          /* ignore */
        }
        const glyphs = allGlyphs();
        if (!glyphs.length) {
          doc = null;
          setMsg('Noch keine Schrift erfasst – zuerst unter „Schrift erfassen“ schreiben.', true);
          renderPreview();
          return;
        }
        if (!t.trim()) {
          doc = null;
          setMsg('Gib einen Text ein.');
          renderPreview();
          return;
        }
        try {
          const r = deps.layout(t, glyphs, { headingWidthMm: Number(headW.value) || 0.7, bodyWidthMm: Number(bodyW.value) || 0.35 });
          doc = r.doc;
          page = Math.min(page, Math.max(0, doc.pages.length - 1));
          setMsg(`${doc.pages.length} ${doc.pages.length === 1 ? 'Seite' : 'Seiten'}`);
          missingEl.textContent = r.missing.length
            ? `Nicht erfasste Zeichen (werden ausgelassen): ${r.missing.join(' ')}`
            : '';
        } catch (e) {
          doc = null;
          setMsg(`Umwandeln fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, true);
        }
        renderPreview();
      }

      const schedule = (): void => {
        clearTimeout(timer);
        timer = window.setTimeout(run, 350);
      };

      function showPage(p: number): void {
        if (!doc) return;
        page = Math.max(0, Math.min(doc.pages.length - 1, p));
        renderPreview();
      }

      function renderPreview(): void {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        blobUrl = '';
        preview.replaceChildren();
        const n = doc?.pages.length ?? 0;
        pageLabel.textContent = n ? `Seite ${page + 1} von ${n}` : '';
        prev.disabled = !n || page <= 0;
        next.disabled = !n || page >= n - 1;
        download.disabled = !n;
        if (!doc || !n) return;
        const out = deps.preview(doc, page);
        if (typeof out === 'string') {
          // Shown as <img>: SVG in an image context cannot run scripts or touch the DOM.
          blobUrl = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml' }));
          preview.append(h('img', { src: blobUrl, alt: `Vorschau Seite ${page + 1}` }));
        } else preview.append(out);
      }

      async function doDownload(): Promise<void> {
        if (!doc) return;
        download.disabled = true;
        setMsg('Erzeuge Datei …');
        try {
          const res = await fetch(deps.templateUrl);
          if (!res.ok) throw new Error(`Vorlage nicht gefunden (${res.status})`);
          const template = new Uint8Array(await res.arrayBuffer());
          const blob = await deps.write(template, doc);
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: fileName(text.value) });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
          setMsg('Datei erzeugt.');
          toast('Download gestartet.');
        } catch (e) {
          setMsg(`Datei konnte nicht erzeugt werden: ${e instanceof Error ? e.message : String(e)}`, true);
        } finally {
          download.disabled = !doc;
        }
      }

      file.addEventListener('change', () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        if (f.size > MAX_FILE_BYTES) {
          setMsg(`Datei zu groß (max. ${MAX_FILE_BYTES / 1024} KB).`, true);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const t = String(reader.result ?? '').replace(/\r\n?/g, '\n').slice(0, MAX_TEXT_CHARS);
          text.value = t;
          run();
        };
        reader.onerror = () => setMsg('Datei konnte nicht gelesen werden.', true);
        reader.readAsText(f, 'utf-8');
      });
      text.addEventListener('input', schedule);
      for (const inp of [headW, bodyW])
        inp.addEventListener('change', () => {
          saveSettings({ headingWidthMm: Number(headW.value) || 0.7, bodyWidthMm: Number(bodyW.value) || 0.35 });
          run();
        });

      ensureLoaded()
        .catch((e: unknown) => setMsg(`Gespeicherte Schrift konnte nicht geladen werden. ${describeStoreError(e)}`, true))
        .finally(() => root.isConnected && run());

      return () => {
        clearTimeout(timer);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      };
    },
  };
}

function fileName(text: string): string {
  const first = text.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') ?? '';
  const base = first.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 40) || 'Handschrift';
  return `${base}.goodnotes`;
}
