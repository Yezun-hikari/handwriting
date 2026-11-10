import { describeChar, groupsWith, parseLigatures, VARIANTS, type CharGroup } from '../capture/charset.ts';
import { CaptureField } from '../capture/field.ts';
import { pitchForWidth } from '../capture/geometry.ts';
import type { InputMode } from '../capture/input-policy.ts';
import { buildGlyph } from '../capture/normalize.ts';
import { PointerGate } from '../capture/pointer-gate.ts';
import {
  countCaptured,
  describeStoreError,
  ensureLoaded,
  getGlyph,
  glyphStoreGeneration,
  onBeforeStoreSwitch,
  onGlyphsChange,
  removeGlyph,
  saveGlyph,
} from '../store/index.ts';
import { loadSettings, saveSettings, type Settings } from '../store/settings.ts';
import { storageHintEl } from './auth-hook.ts';
import { button, h, toast } from './dom.ts';
import { glyphSvg } from './glyph-svg.ts';
import { replaceParams, type Screen } from './router.ts';

const SAVE_DELAY = 700;

type Status = 'empty' | 'dirty' | 'saved' | 'error';
const STATUS_TEXT: Record<Status, string> = {
  empty: 'leer',
  dirty: 'wird gespeichert …',
  saved: 'gespeichert',
  error: 'Speichern fehlgeschlagen',
};

interface Slot {
  field: CaptureField;
  variant: number;
  wrap: HTMLElement;
  status: HTMLElement;
  timer: number;
}

export const captureScreen: Screen = {
  title: 'Schrift erfassen',
  mount(root, params) {
    let settings: Settings = loadSettings();
    let groups: CharGroup[] = groupsWith(settings.ligatures);
    let order: string[] = groups.flatMap((g) => g.chars);
    const gate = new PointerGate(settings.inputMode);

    const initial = params.get('c')?.normalize('NFC');
    let char = initial && order.includes(initial) ? initial : order[0];
    let active = Math.min(VARIANTS - 1, Math.max(0, Number(params.get('v')) || 0));
    let slots: Slot[] = [];
    /** Store generation the fields were filled from (see onBeforeStoreSwitch below). */
    let shownGen = glyphStoreGeneration();

    // ---------- skeleton ----------
    const bigChar = h('div', { class: 'cap-char', 'aria-hidden': 'true' });
    const title = h('h1', { tabindex: '-1' });
    const progressText = h('p', { class: 'muted cap-progress-text' });
    const bar = h('div', { class: 'progress-fill' });
    const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0 }, bar);
    const fieldsEl = h('div', { class: 'fields' });

    const prevBtn = button('← Zurück', () => step(-1), { 'aria-keyshortcuts': 'ArrowLeft' });
    const undoBtn = button('Rückgängig', () => activeSlot()?.field.undo(), { 'aria-keyshortcuts': 'Meta+Z' });
    const clearBtn = button('Löschen', () => activeSlot()?.field.clear());
    const nextBtn = button('Weiter →', () => step(1), { class: 'btn primary', 'aria-keyshortcuts': 'ArrowRight' });
    const nextEmptyBtn = button('Nächstes leeres Feld', () => jumpNextEmpty(), { class: 'btn ghost-btn' });
    const toolbar = h('div', { class: 'toolbar' }, prevBtn, undoBtn, clearBtn, nextBtn);

    const overview = h('div', { class: 'overview' });
    const settingsEl = buildSettings();

    root.append(
      h(
        'section',
        { class: 'capture' },
        h('div', { class: 'cap-head' }, bigChar, h('div', { class: 'cap-head-text' }, title, progressText, progress)),
        fieldsEl,
        toolbar,
        h('div', { class: 'toolbar secondary' }, nextEmptyBtn, storageHintEl()),
        settingsEl,
        h('h2', { class: 'section-title', text: 'Übersicht' }),
        overview,
      ),
    );

    // ---------- fields ----------
    const activeSlot = (): Slot | undefined => slots[active];

    function setStatus(slot: Slot, s: Status): void {
      slot.status.textContent = STATUS_TEXT[s];
      slot.wrap.dataset.status = s;
    }

    function persist(slot: Slot): Promise<void> {
      clearTimeout(slot.timer);
      slot.timer = 0;
      const g = buildGlyph(char, slot.variant, slot.field.strokes, slot.field.frame, { rightGap: settings.rightGap });
      const gen = glyphStoreGeneration();
      const p = g ? saveGlyph(g) : removeGlyph(char, slot.variant);
      return p.then(
        () => {
          if (gen === glyphStoreGeneration()) setStatus(slot, g ? 'saved' : 'empty');
        },
        (err: unknown) => {
          if (gen === glyphStoreGeneration()) setStatus(slot, 'error');
          toast(`Speichern fehlgeschlagen. ${describeStoreError(err)}`);
        },
      );
    }

    function flush(): Promise<unknown> {
      return Promise.all(slots.filter((s) => s.timer).map(persist));
    }

    function buildFields(): void {
      slots.forEach((s) => {
        clearTimeout(s.timer);
        s.field.destroy();
      });
      fieldsEl.replaceChildren();
      const isLig = [...char].length > 1;
      const units = isLig ? 3.6 : 2.6;
      const cols = getComputedStyle(fieldsEl).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      const gap = 12;
      const cellW = Math.floor((fieldsEl.clientWidth - gap * (cols - 1)) / cols) - 2; // minus border
      const pitch = pitchForWidth(cellW, units);
      slots = [];
      for (let v = 0; v < VARIANTS; v++) {
        const status = h('span', { class: 'field-status' });
        const label = `Variante ${v + 1} von ${describeChar(char)}`;
        const wrap = h('div', { class: 'field' });
        const slot: Slot = { field: null as unknown as CaptureField, variant: v, wrap, status, timer: 0 };
        slot.field = new CaptureField({
          widthPx: Math.max(120, cellW),
          pitchPx: pitch,
          gate,
          label,
          onActivate: () => setActive(v),
          onChange: () => {
            setStatus(slot, 'dirty');
            clearTimeout(slot.timer);
            slot.timer = window.setTimeout(() => void persist(slot), SAVE_DELAY);
          },
        });
        const head = h(
          'div',
          { class: 'field-head' },
          h('span', { class: 'field-label', text: `Variante ${v + 1}` }),
          status,
        );
        wrap.append(head, slot.field.canvas);
        fieldsEl.append(wrap);
        slot.field.setGlyph(getGlyph(char, v));
        setStatus(slot, getGlyph(char, v) ? 'saved' : 'empty');
        slots.push(slot);
      }
      slots.forEach((s) => s.field.redraw()); // now connected: picks up theme colours
      shownGen = glyphStoreGeneration();
      setActive(active);
    }

    /** While another store loads, the fields show nothing editable, so no stale drawing can be saved into it. */
    function setLoading(on: boolean): void {
      fieldsEl.toggleAttribute('inert', on);
      fieldsEl.setAttribute('aria-busy', String(on));
      fieldsEl.classList.toggle('loading', on);
    }

    /** Re-reads every non-dirty field from the (new) store's cache. */
    function reloadFields(): void {
      shownGen = glyphStoreGeneration();
      for (const s of slots) {
        if (s.timer) continue; // unsaved edits of this store: keep
        const g = getGlyph(char, s.variant);
        s.field.setGlyph(g);
        setStatus(s, g ? 'saved' : 'empty');
      }
    }

    function setActive(v: number): void {
      active = v;
      slots.forEach((s, i) => s.wrap.classList.toggle('active', i === v));
      replaceParams({ c: char, v: String(v) });
    }

    function showChar(c: string, v = 0): void {
      void flush();
      char = c;
      active = v;
      bigChar.textContent = c;
      title.textContent = describeChar(c);
      buildFields();
      updateProgress();
      markOverview();
    }

    function step(dir: 1 | -1): void {
      let v = active + dir;
      let i = order.indexOf(char);
      if (v >= VARIANTS) {
        v = 0;
        i++;
      } else if (v < 0) {
        v = VARIANTS - 1;
        i--;
      }
      if (i < 0 || i >= order.length) return;
      if (order[i] === char) setActive(v);
      else showChar(order[i], v);
    }

    function jumpNextEmpty(): void {
      const start = order.indexOf(char) * VARIANTS + active;
      const total = order.length * VARIANTS;
      for (let k = 1; k <= total; k++) {
        const idx = (start + k) % total;
        const c = order[Math.floor(idx / VARIANTS)];
        const v = idx % VARIANTS;
        const slot = c === char ? slots[v] : undefined;
        if (slot ? slot.field.isEmpty : !getGlyph(c, v)) {
          if (c === char) setActive(v);
          else showChar(c, v);
          return;
        }
      }
      toast('Alle Felder sind ausgefüllt.');
    }

    // ---------- progress & overview ----------
    function updateProgress(): void {
      const total = order.length * VARIANTS;
      const done = countCaptured(order, VARIANTS);
      const pos = order.indexOf(char) + 1;
      progressText.textContent = `Zeichen ${pos} von ${order.length} · ${done} von ${total} Feldern erfasst`;
      bar.style.width = `${(done / total) * 100}%`;
      progress.setAttribute('aria-valuemax', String(total));
      progress.setAttribute('aria-valuenow', String(done));
      progress.setAttribute('aria-label', `${done} von ${total} Feldern erfasst`);
    }

    const tiles = new Map<string, HTMLButtonElement>();
    function buildOverview(): void {
      overview.replaceChildren();
      tiles.clear();
      for (const g of groups) {
        const grid = h('div', { class: 'tiles' });
        for (const c of g.chars) {
          const t = h('button', { type: 'button', class: 'tile' });
          t.addEventListener('click', () => {
            showChar(c);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
          tiles.set(c, t);
          fillTile(c);
          grid.append(t);
        }
        overview.append(h('h3', { class: 'group-title', text: g.label }), grid);
      }
      markOverview();
    }

    function fillTile(c: string): void {
      const t = tiles.get(c);
      if (!t) return;
      const previews = h('span', { class: 'tile-previews' });
      let n = 0;
      for (let v = 0; v < VARIANTS; v++) {
        const g = getGlyph(c, v);
        if (g) {
          n++;
          previews.append(glyphSvg(g, 30));
        } else previews.append(h('span', { class: 'tile-empty' }));
      }
      t.replaceChildren(h('span', { class: 'tile-char', text: c }), previews);
      t.dataset.done = n === VARIANTS ? 'all' : n ? 'some' : 'none';
      t.setAttribute('aria-label', `${describeChar(c)}: ${n} von ${VARIANTS} erfasst`);
    }

    function markOverview(): void {
      tiles.forEach((t, c) => (c === char ? t.setAttribute('aria-current', 'true') : t.removeAttribute('aria-current')));
    }

    const offGlyphs = onGlyphsChange(() => {
      updateProgress();
      if (tiles.size) tiles.forEach((_, c) => fillTile(c));
      if (slots.length && shownGen !== glyphStoreGeneration()) {
        // Store switched (sign-in / sign-out): drop the old store's drawings and wait for the new store's glyphs.
        const gen = glyphStoreGeneration();
        shownGen = gen;
        for (const s of slots) {
          clearTimeout(s.timer);
          s.timer = 0;
          s.field.setGlyph(undefined);
          setStatus(s, 'empty');
        }
        setLoading(true);
        ensureLoaded()
          .catch((e: unknown) => toast(`Gespeicherte Schrift konnte nicht geladen werden. ${describeStoreError(e)}`))
          .finally(() => {
            if (!root.isConnected || gen !== glyphStoreGeneration()) return; // superseded by another switch
            setLoading(false);
            reloadFields();
          });
      }
    });
    // Before the store changes, pending saves go to the store they were drawn for (never into the next one).
    const offSwitch = onBeforeStoreSwitch(() => void flush());

    // ---------- settings ----------
    function buildSettings(): HTMLElement {
      const modes: [InputMode, string, string][] = [
        ['auto', 'Automatisch', 'Finger/Maus gehen, bis der Stift benutzt wird – danach wird die Hand ignoriert.'],
        ['pen', 'Nur Apple Pencil', 'Berührungen mit Finger und Hand werden immer ignoriert.'],
        ['any', 'Stift, Finger & Maus', 'Zum Schreiben ohne Stift. Während der Stift schreibt, wird die Hand trotzdem ignoriert.'],
      ];
      const fs = h('fieldset', { class: 'modes' }, h('legend', { text: 'Eingabe' }));
      for (const [m, label, hint] of modes) {
        const input = h('input', { type: 'radio', name: 'input-mode', value: m, checked: settings.inputMode === m });
        input.addEventListener('change', () => {
          gate.mode = m;
          settings = saveSettings({ inputMode: m });
        });
        fs.append(h('label', { class: 'radio' }, input, h('span', {}, h('strong', { text: label }), h('small', { text: hint }))));
      }

      const gapOut = h('output', { text: settings.rightGap.toFixed(2) });
      const gap = h('input', { type: 'range', min: 0, max: 0.4, step: 0.01, value: settings.rightGap, id: 'gap' });
      gap.addEventListener('input', () => (gapOut.textContent = Number(gap.value).toFixed(2)));
      gap.addEventListener('change', () => {
        settings = saveSettings({ rightGap: Number(gap.value) });
        toast('Gilt für neu gespeicherte Zeichen.');
      });

      const lig = h('input', { type: 'text', id: 'ligs', value: settings.ligatures.join(' '), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
      const ligSave = button('Übernehmen', () => {
        const list = parseLigatures(lig.value);
        settings = saveSettings({ ligatures: list });
        lig.value = list.join(' ');
        groups = groupsWith(list);
        order = groups.flatMap((g) => g.chars);
        buildOverview();
        if (!order.includes(char)) showChar(order[0]);
        else updateProgress();
        toast('Ligaturen gespeichert.');
      });

      return h(
        'details',
        { class: 'cap-settings' },
        h('summary', { text: 'Einstellungen' }),
        fs,
        h(
          'div',
          { class: 'setting' },
          h('label', { for: 'gap', text: 'Abstand rechts nach jedem Zeichen (in Linienabständen) ' }),
          h('div', { class: 'row' }, gap, gapOut),
        ),
        h(
          'div',
          { class: 'setting' },
          h('label', { for: 'ligs', text: 'Ligaturen (durch Leerzeichen getrennt, 2–4 Zeichen)' }),
          h('div', { class: 'row' }, lig, ligSave),
        ),
      );
    }

    // ---------- keyboard ----------
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        activeSlot()?.field.undo();
      } else return;
    };
    window.addEventListener('keydown', onKey);

    // Re-layout fields on orientation change (strokes are saved first, then re-loaded).
    let lastW = 0;
    const ro = new ResizeObserver(() => {
      const w = fieldsEl.clientWidth;
      if (!lastW) {
        lastW = w;
        return;
      }
      if (Math.abs(w - lastW) < 24) return;
      lastW = w;
      void flush().then(() => buildFields());
    });

    const onHide = (): void => void flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);

    // ---------- start ----------
    bigChar.textContent = char;
    title.textContent = describeChar(char);
    ensureLoaded()
      .catch((e: unknown) => toast(`Gespeicherte Schrift konnte nicht geladen werden. ${describeStoreError(e)}`))
      .finally(() => {
        if (!root.isConnected) return;
        buildFields();
        buildOverview();
        updateProgress();
        ro.observe(fieldsEl);
      });

    return () => {
      void flush();
      slots.forEach((s) => s.field.destroy());
      offGlyphs();
      offSwitch();
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  },
};
