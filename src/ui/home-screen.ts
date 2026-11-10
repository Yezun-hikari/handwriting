import { BASE_GROUPS, VARIANTS } from '../capture/charset.ts';
import { allGlyphs, countCaptured, ensureLoaded, onGlyphsChange } from '../store/index.ts';
import { loadSettings } from '../store/settings.ts';
import { getAuthState, storageHint } from './auth-hook.ts';
import { h } from './dom.ts';
import type { Screen } from './router.ts';

export const homeScreen: Screen = {
  title: 'Start',
  mount(root) {
    const status = h('p', { class: 'status-big', text: 'Lädt …' });
    const statusSub = h('p', { class: 'muted' });
    const bar = h('div', { class: 'progress-fill' });
    const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0 }, bar);

    root.append(
      h(
        'section',
        { class: 'home' },
        h(
          'div',
          { class: 'hero' },
          h('h1', { tabindex: '-1', text: 'Deine Handschrift für Goodnotes' }),
          h('p', {
            class: 'tagline',
            text:
              'Schreib jedes Zeichen ein paar Mal mit dem Apple Pencil. Danach verwandelt die App beliebigen Text in eine Goodnotes-Datei auf liniertem A4-Papier – in deiner eigenen Schrift, als echte Stiftstriche.',
          }),
        ),
        h(
          'div',
          { class: 'card' },
          h('h2', { text: 'Stand deiner Schrift' }),
          status,
          progress,
          statusSub,
          h('p', { class: 'muted small', text: `${storageHint()} (${getAuthState().label})` }),
        ),
        h(
          'ol',
          { class: 'steps' },
          h('li', {}, h('strong', { text: 'Schrift erfassen: ' }), 'Buchstaben, Ziffern, Satzzeichen und Ligaturen je 3× auf die Hilfslinien schreiben.'),
          h('li', {}, h('strong', { text: 'Text umwandeln: ' }), 'Text einfügen oder als .txt hochladen, Vorschau ansehen.'),
          h('li', {}, h('strong', { text: 'Herunterladen: ' }), 'Die .goodnotes-Datei in Goodnotes öffnen oder importieren.'),
        ),
        h(
          'div',
          { class: 'menu' },
          h('a', { class: 'btn primary big', href: '#/schrift' }, 'Schrift erfassen'),
          h('a', { class: 'btn big', href: '#/umwandeln' }, 'Text umwandeln'),
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
        (done === 0 ? ' – leg los!' : done < total ? '' : ' – vollständig!');
    }

    const off = onGlyphsChange(update);
    ensureLoaded()
      .then(update)
      .catch(() => (status.textContent = 'Konnte nicht geladen werden'));
    return off;
  },
};
