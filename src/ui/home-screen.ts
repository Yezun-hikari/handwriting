import { BASE_GROUPS, VARIANTS } from '../capture/charset.ts';
import { allGlyphs, countCaptured, describeStoreError, ensureLoaded, onGlyphsChange } from '../store/index.ts';
import { loadSettings } from '../store/settings.ts';
import { storageHintEl } from './auth-hook.ts';
import { h } from './dom.ts';
import type { Screen } from './router.ts';

export const homeScreen: Screen = {
  title: 'Start',
  mount(root) {
    const status = h('p', { class: 'status-figure', text: 'Lädt …' });
    const statusSub = h('p', { class: 'muted' });
    const bar = h('div', { class: 'progress-fill' });
    const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0 }, bar);

    root.append(
      h(
        'section',
        { class: 'home' },
        h(
          'div',
          { class: 'home-intro' },
          h('h1', { tabindex: '-1', text: 'Deine Handschrift für Goodnotes' }),
          h('p', {
            class: 'lede',
            text:
              'Schreib jedes Zeichen ein paar Mal mit dem Apple Pencil. Danach verwandelt die App beliebigen Text in eine Goodnotes-Datei auf liniertem A4-Papier – in deiner eigenen Schrift, als echte Stiftstriche.',
          }),
          h(
            'p',
            { class: 'actions' },
            h('a', { class: 'btn primary', href: '#/schrift' }, 'Schrift erfassen'),
            h('a', { class: 'btn', href: '#/umwandeln' }, 'Text umwandeln'),
          ),
        ),
        h(
          'div',
          { class: 'home-status' },
          h('h2', { class: 'eyebrow', text: 'Stand deiner Schrift' }),
          status,
          progress,
          statusSub,
          storageHintEl(),
        ),
        h(
          'div',
          { class: 'home-steps' },
          h('h2', { class: 'eyebrow', text: 'So geht es' }),
          h(
            'ol',
            { class: 'steps' },
            h('li', {}, h('strong', { text: 'Schrift erfassen.' }), ' Buchstaben, Ziffern, Satzzeichen und Ligaturen je dreimal auf die Hilfslinien schreiben.'),
            h('li', {}, h('strong', { text: 'Text umwandeln.' }), ' Text einfügen oder als .txt hochladen, Vorschau ansehen.'),
            h('li', {}, h('strong', { text: 'Herunterladen.' }), ' Die .goodnotes-Datei in Goodnotes öffnen oder importieren.'),
          ),
        ),
      ),
    );

    function update(): void {
      const chars = BASE_GROUPS.flatMap((g) => g.chars);
      const ligs = loadSettings().ligatures;
      const total = chars.length * VARIANTS;
      const done = countCaptured(chars, VARIANTS);
      const ligDone = countCaptured(ligs, VARIANTS);
      status.textContent = `${done} von ${total} Feldern`;
      bar.style.width = `${(done / total) * 100}%`;
      progress.setAttribute('aria-valuemax', String(total));
      progress.setAttribute('aria-valuenow', String(done));
      progress.setAttribute('aria-label', status.textContent);
      const distinct = new Set(allGlyphs().map((g) => g.char)).size;
      statusSub.textContent =
        `Ligaturen: ${ligDone} von ${ligs.length * VARIANTS} · ${distinct} verschiedene Zeichen erfasst` +
        (done === 0 ? ' – leg los.' : done < total ? '' : ' – vollständig.');
    }

    const off = onGlyphsChange(update);
    ensureLoaded()
      .then(update)
      .catch((e: unknown) => {
        status.textContent = 'Konnte nicht geladen werden';
        statusSub.textContent = describeStoreError(e);
      });
    return off;
  },
};
