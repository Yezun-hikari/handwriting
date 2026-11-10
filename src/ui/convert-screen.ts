import { allGlyphs, describeStoreError, ensureLoaded } from '../store/index.ts';
import { clampPenMm, loadSettings, PEN_MAX_MM, PEN_MIN_MM, saveSettings } from '../store/settings.ts';
import type { DocumentContent } from '../types.ts';
import { progressFraction, progressText, type BuildProgress } from './convert-build.ts';
import { convertDeps, type ConvertDeps, type ConvertOptions } from './convert-deps.ts';
import { button, h, toast } from './dom.ts';
import type { Screen } from './router.ts';

export const MAX_FILE_BYTES = 512 * 1024;
/** ≈ 15–20 handwritten A4 pages; writing the file takes roughly half a second per page. */
export const MAX_TEXT_CHARS = 60_000;
/** The live preview lays out at most this much text (≈ 3 pages); longer texts are only measured. */
export const PREVIEW_CHARS = 9_000;
const DRAFT_KEY = 'handwriting-convert-draft';
const TOO_LONG_MSG = `Der Text ist auf ${MAX_TEXT_CHARS.toLocaleString('de-DE')} Zeichen begrenzt (etwa 15–20 Seiten). Längere Texte bitte auf mehrere Dateien aufteilen.`;

/** At most `max` chars of `text`, cut after the last line break (else space) so the preview never splits a word. */
export function previewPrefix(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = text.slice(0, max);
  const cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '));
  return { text: cut > max / 2 ? head.slice(0, cut) : head, truncated: true };
}

/** Debounce for the live preview: longer for long texts, so typing stays smooth. */
export const previewDelay = (chars: number): number => (chars <= PREVIEW_CHARS ? 350 : 900);

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
      text.value = draft.slice(0, MAX_TEXT_CHARS);
      const file = h('input', { type: 'file', accept: '.txt,text/plain', id: 'file', class: 'sr-only' });
      const fileBtn = h('label', { for: 'file', class: 'btn' }, '.txt-Datei laden');

      const numInput = (id: string, v: number): HTMLInputElement =>
        h('input', { type: 'number', id, min: PEN_MIN_MM, max: PEN_MAX_MM, step: 0.05, value: v, inputmode: 'decimal' });
      const headW = numInput('head-w', s.headingWidthMm);
      const bodyW = numInput('body-w', s.bodyWidthMm);

      const msg = h('p', { class: 'msg', role: 'status' });
      const limitMsg = h('p', { class: 'missing limit-msg' });
      const missingEl = h('p', { class: 'missing' });
      const preview = h('div', { class: 'preview', 'aria-label': 'Vorschau' });
      const pageLabel = h('span', { class: 'muted' });
      const prev = button('←', () => showPage(page - 1), { 'aria-label': 'Vorherige Seite', class: 'btn icon' });
      const next = button('→', () => showPage(page + 1), { 'aria-label': 'Nächste Seite', class: 'btn icon' });
      const download = button('Goodnotes-Datei herunterladen', () => void doDownload(), { class: 'btn primary big' });
      const buildFill = h('div', { class: 'progress-fill' });
      const buildBar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Fortschritt' }, buildFill);
      const buildText = h('p', { class: 'muted small', 'aria-live': 'polite' });
      const buildBox = h('div', { class: 'build-progress', hidden: true }, buildText, buildBar);

      root.append(
        h(
          'section',
          { class: 'convert' },
          h('h1', { tabindex: '-1', text: 'Text umwandeln' }),
          h('p', { class: 'muted', text: 'Zeilen, die mit # beginnen, werden als Überschrift geschrieben.' }),
          h('label', { for: 'text', class: 'label', text: 'Text' }),
          text,
          limitMsg,
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
          h('div', { class: 'menu' }, download, buildBox),
        ),
      );

      /** Previewed pages (all pages for short texts, the first ones for long texts). */
      let doc: DocumentContent | null = null;
      /** Pages of the whole text. */
      let totalPages = 0;
      let page = 0;
      let timer = 0;
      let blobUrl = '';
      let building: AbortController | null = null;

      function setMsg(t: string, err = false): void {
        msg.textContent = t;
        msg.classList.toggle('error', err);
      }

      const widths = (): ConvertOptions => {
        const o = { headingWidthMm: clampPenMm(headW.value, s.headingWidthMm), bodyWidthMm: clampPenMm(bodyW.value, s.bodyWidthMm) };
        return o;
      };

      function checkLength(): void {
        limitMsg.textContent = text.value.length >= MAX_TEXT_CHARS ? TOO_LONG_MSG : '';
      }

      function run(): void {
        clearTimeout(timer);
        timer = 0;
        const t = text.value;
        checkLength();
        try {
          localStorage.setItem(DRAFT_KEY, t.slice(0, 20000));
        } catch {
          /* ignore */
        }
        const glyphs = allGlyphs();
        if (!glyphs.length) {
          doc = null;
          totalPages = 0;
          setMsg('Noch keine Schrift erfasst – zuerst unter „Schrift erfassen“ schreiben.', true);
          renderPreview();
          return;
        }
        if (!t.trim()) {
          doc = null;
          totalPages = 0;
          setMsg('Gib einen Text ein.');
          renderPreview();
          return;
        }
        try {
          const opts = widths();
          const head = previewPrefix(t, PREVIEW_CHARS);
          const r = deps.layout(head.text, glyphs, opts);
          let pages = r.doc.pages;
          let missing = r.missing;
          totalPages = pages.length;
          if (head.truncated) {
            if (pages.length > 1) pages = pages.slice(0, -1); // the last previewed page may be cut off mid-page
            const m = deps.measure(t, glyphs, opts);
            totalPages = m.pages;
            missing = m.missing;
          }
          doc = { pages };
          page = Math.min(page, Math.max(0, pages.length - 1));
          const label = `${totalPages} ${totalPages === 1 ? 'Seite' : 'Seiten'}`;
          setMsg(
            pages.length >= totalPages
              ? label
              : `${label} – die Vorschau zeigt ${pages.length === 1 ? 'nur die erste' : `die ersten ${pages.length}`}.`,
          );
          missingEl.textContent = missing.length ? `Nicht erfasste Zeichen (werden ausgelassen): ${missing.join(' ')}` : '';
        } catch (e) {
          doc = null;
          totalPages = 0;
          setMsg(`Umwandeln fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, true);
        }
        renderPreview();
      }

      const schedule = (): void => {
        clearTimeout(timer);
        checkLength();
        timer = window.setTimeout(run, previewDelay(text.value.length));
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
        pageLabel.textContent = n ? `Seite ${page + 1} von ${n < totalPages ? `${totalPages} (Vorschau)` : n}` : '';
        prev.disabled = !n || page <= 0;
        next.disabled = !n || page >= n - 1;
        download.disabled = !totalPages || !!building;
        if (!doc || !n) return;
        const out = deps.preview(doc, page);
        if (typeof out === 'string') {
          // Shown as <img>: SVG in an image context cannot run scripts or touch the DOM.
          blobUrl = URL.createObjectURL(new Blob([out], { type: 'image/svg+xml' }));
          preview.append(h('img', { src: blobUrl, alt: `Vorschau Seite ${page + 1}` }));
        } else preview.append(out);
      }

      function showProgress(p: BuildProgress | null): void {
        buildBox.hidden = !p;
        if (!p) return;
        const pct = Math.round(progressFraction(p) * 100);
        buildText.textContent = progressText(p);
        buildFill.style.width = `${pct}%`;
        buildBar.setAttribute('aria-valuenow', String(pct));
      }

      let templateBytes: Promise<Uint8Array> | null = null;
      const template = (): Promise<Uint8Array> =>
        (templateBytes ??= fetch(deps.templateUrl)
          .then(async (res) => {
            if (!res.ok) throw new Error(`Vorlage nicht gefunden (${res.status})`);
            return new Uint8Array(await res.arrayBuffer());
          })
          .catch((e: unknown) => {
            templateBytes = null;
            throw e;
          }));

      async function doDownload(): Promise<void> {
        if (building) return;
        run(); // cancels a pending preview update: the file is built from exactly what is on screen now
        if (!totalPages) return;
        const ac = new AbortController();
        building = ac;
        download.disabled = true;
        const t = text.value;
        const req = { text: t, glyphs: allGlyphs(), ...widths() };
        showProgress({ stage: 'layout' });
        try {
          const blob = await deps.build({ ...req, template: await template() }, (p) => !ac.signal.aborted && showProgress(p), ac.signal);
          if (ac.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          const a = h('a', { href: url, download: fileName(t) });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
          setMsg('Datei erzeugt.');
          toast('Download gestartet.');
        } catch (e) {
          if (ac.signal.aborted) return;
          setMsg(`Datei konnte nicht erzeugt werden: ${e instanceof Error ? e.message : String(e)}`, true);
        } finally {
          if (building === ac) building = null;
          if (root.isConnected) {
            showProgress(null);
            download.disabled = !totalPages;
          }
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
          const full = String(reader.result ?? '').replace(/\r\n?/g, '\n');
          text.value = full.slice(0, MAX_TEXT_CHARS);
          run();
          if (full.length > MAX_TEXT_CHARS) limitMsg.textContent = `${TOO_LONG_MSG} Der Rest der Datei wurde abgeschnitten.`;
        };
        reader.onerror = () => setMsg('Datei konnte nicht gelesen werden.', true);
        reader.readAsText(f, 'utf-8');
      });
      text.addEventListener('input', schedule);
      for (const inp of [headW, bodyW])
        inp.addEventListener('change', () => {
          const o = widths();
          headW.value = String(o.headingWidthMm);
          bodyW.value = String(o.bodyWidthMm);
          saveSettings(o);
          run();
        });

      ensureLoaded()
        .catch((e: unknown) => setMsg(`Gespeicherte Schrift konnte nicht geladen werden. ${describeStoreError(e)}`, true))
        .finally(() => root.isConnected && run());

      return () => {
        clearTimeout(timer);
        building?.abort();
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
