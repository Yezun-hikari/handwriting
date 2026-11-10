# Handschrift – eigene Handschrift für Goodnotes

Web-App unter <https://yezun.de/handwriting/>: Du schreibst jedes Zeichen ein paar Mal mit dem Apple Pencil,
danach verwandelt die App beliebigen Text in eine **`.goodnotes`-Datei auf liniertem A4-Papier** – in deiner
eigenen Schrift und als **echte Stiftstriche** (nicht als Bild oder PDF). In Goodnotes lassen sich die Striche
wie selbst geschriebene bearbeiten, radieren, umfärben und per Lasso verschieben.

## Benutzung (iPad + Apple Pencil)

1. **Schrift erfassen** (`#/schrift`): Für jedes Zeichen gibt es drei Felder mit Hilfslinien (Grundlinie,
   x-Höhe, Ober-/Unterlänge). Jedes Zeichen 3× schreiben – leicht unterschiedliche Varianten machen das Ergebnis
   natürlicher. Gespeichert wird automatisch kurz nach dem Absetzen. Erfasst werden Klein- und Großbuchstaben,
   Umlaute & ß, Ziffern, Satzzeichen und Ligaturen (Standard: `ch ck sch ei ie tt ll ss st`, in den
   Einstellungen änderbar).
   - **Eingabe:** *Automatisch* (Finger/Maus gehen, bis der Stift benutzt wird – danach wird die Hand ignoriert),
     *Nur Apple Pencil* oder *Stift, Finger & Maus*. Die Handballen-Erkennung gilt immer.
   - Pfeiltasten ←/→ wechseln das Zeichen, ⌘Z macht den letzten Strich rückgängig.
2. **Text umwandeln** (`#/umwandeln`): Text einfügen oder eine `.txt`-Datei laden. Zeilen mit `# ` am Anfang
   werden Überschriften (größer, dickerer Stift). Die Vorschau zeigt die Seiten; fehlende Zeichen werden
   aufgelistet und als Lücke gesetzt.
3. **Herunterladen** und die Datei in Goodnotes öffnen („Teilen → In Goodnotes öffnen“ bzw. Importieren).

Am Mac/PC funktioniert alles auch mit Maus oder Trackpad (Eingabemodus „Stift, Finger & Maus“).

## Konto & Speicherung

Die Anmeldung läuft über das gemeinsame yezun.de-Konto ([`konto`](https://github.com/Yezun-hikari/konto),
SDK `@yezun/konto`). Die App hat kein eigenes Login-Formular: Der Chip oben rechts zeigt den Status
(Benutzername, „Gast“ oder „nicht angemeldet“) und verlinkt auf die Konto-Seite, die danach hierher zurückleitet.

| Status | Schrift (Glyphen) | Einstellungen |
|---|---|---|
| **Registriert** | Tabelle `handwriting_glyphs` im Konto – auf allen Geräten | Ligaturen, Abstand rechts, Strichbreiten in `handwriting_settings`; der Eingabemodus bleibt pro Gerät |
| **Gast / nicht angemeldet** | nur in diesem Browser (`localStorage`) | nur in diesem Browser |
| **Ohne Konfiguration** (`VITE_SUPABASE_*` fehlt) | nur in diesem Browser | nur in diesem Browser |

- **Nur registrierte Konten** können im Konto speichern (RLS: eigene Zeilen, keine anonymen Nutzer). Gäste
  sehen einen Hinweis mit Link zum Registrieren.
- **Nach dem Anmelden** mit vorhandener Schrift im Browser fragt die App, ob sie ins Konto übernommen werden soll,
  und zeigt die Anzahl neuer, abweichender und identischer Zeichen. Zeichen, die es im Konto schon gibt, werden nur
  überschrieben, wenn man das ausdrücklich ankreuzt. „Später“ fragt beim nächsten Mal wieder, „Nicht übernehmen“
  erst, wenn sich die lokale Schrift ändert. Die Kopie im Browser bleibt erhalten.
- Beim ersten Anmelden übernimmt das Konto die Einstellungen dieses Geräts; danach gelten die Einstellungen aus dem
  Konto.
- Fehler (offline, abgelaufene Sitzung, fehlende Berechtigung) erscheinen als deutsche Meldung oben auf der Seite.
- An- und Abmelden auf der Konto-Seite oder in einem anderen Tab wird beim Zurückkehren erkannt.

## Entwicklung

```sh
npm ci
cp .env.example .env.local   # optional: Projekt-URL + anon key (öffentliche Werte); ohne läuft alles lokal
npm run dev                  # http://localhost:5173/handwriting/
npm test                     # vitest
npx tsc --noEmit             # Typprüfung
npm run build                # Typprüfung + Build nach dist/
```

Das Konto-SDK ist eine Git-Abhängigkeit (`"@yezun/konto": "github:Yezun-hikari/konto#<commit>"`); es bringt
`@supabase/supabase-js` mit. Für ein neues SDK-Release die Referenz in `package.json` ändern und `npm install`
ausführen, damit `package-lock.json` passt.

Zum Testen der Konto-Funktionen lokal: Konto-Seite aus dem `konto`-Repo ebenfalls lokal starten oder direkt gegen
das Projekt arbeiten (gleicher `localStorage`-Key `yezun-games-auth` – nur auf demselben Origin geteilt).

## Deployment

GitHub Pages über `.github/workflows/deploy.yml` bei jedem Push auf `main` (oder manuell):
`npm ci` → `npm test` → `npm run build` → `dist/` hochladen.

Einmalig im Repo: Settings → Pages → Source **GitHub Actions**; Settings → Secrets and variables → Actions →
**Variables** `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` (öffentliche Werte, keine Secrets). Vite-`base`
ist `/handwriting/`, die Seite liegt also unter `https://yezun.de/handwriting/` – derselbe Origin wie die
Konto-Seite, daher ist die Anmeldung sofort geteilt. Die Tabellen kommen aus der Migration
`supabase/migrations/20261110010000_handwriting.sql` im `konto`-Repo.

## Architektur

Vanilla TypeScript + Vite, keine UI-Bibliothek. Gemeinsame Datentypen in `src/types.ts`.

| Modul | Aufgabe |
|---|---|
| `src/capture/` | Erfassung: Zeichensatz & Ligaturen, Schreibfeld mit Hilfslinien, Pointer-Filter (Handballen-Erkennung), Glättung/Vereinfachung, Normalisierung in den Glyph-Raum (1.0 = Linienabstand, y = 0 Grundlinie) |
| `src/layout/` | Layout: Text → Glyphen (Ligaturen bevorzugt, Varianten im Wechsel), Zeilenumbruch, Überschriften, leichte Zufallsabweichungen (Grundlinie, Größe, Drehung, Abstand), Seitenumbruch; SVG-Vorschau |
| `src/goodnotes/` | Goodnotes-6-Writer/-Reader auf Basis einer leeren Vorlage (`public/template/a4-ruled-yellow.goodnotes`) |
| `src/store/` | Speicherung: `GlyphStore`-Schnittstelle mit `LocalGlyphStore` (Browser) und `SupabaseGlyphStore` (Konto), Einstellungen (`settings.ts`, lokal + Konto), Merge-Logik (`merge.ts`), deutsche Fehlermeldungen (`errors.ts`), gemeinsamer Cache (`repo.ts`) |
| `src/account/` | Konto-Logik ohne DOM: welcher Store aktiv ist, Einstellungs-Sync, Upload-Angebot nach dem Anmelden |
| `src/ui/` | Bildschirme (Start, Schrift, Umwandeln), Hash-Router, DOM-Helfer; `auth-hook.ts` verbindet `@yezun/konto` mit der Oberfläche (Chip, Hinweise, Dialog) |

Sicherheit: Nutzerdaten werden nie per `innerHTML` eingefügt (alle Seiten auf yezun.de teilen das Sitzungs-Token).

## Das Goodnotes-Format (Kurzfassung)

Reverse-engineered aus Goodnotes-6-Exporten; Details in den Kommentaren unter `src/goodnotes/`.

- Eine `.goodnotes`-Datei ist ein **ZIP**. Unveränderte Einträge werden Byte für Byte übernommen, neue/geänderte mit
  denselben Einstellungen wie der Goodnotes-Export geschrieben (Deflate, UTF-8-Namen, ohne Extra-Felder).
- `index.events.pb` ist ein **Operations-Log** (längen-präfixierte Protobuf-Records `{1: Objekt-ID, <Typ>: Body}`):
  Dokument (30), Anhang (6), Papier (2, verweist auf das PDF des Hintergrunds), Seite (54, mit Reihenfolge-Schlüssel),
  Notizen-/Suchstatus (102/104/105). Bodies tragen Uhrzeit, Event-UUID, einen Lamport-artigen Zähler und
  Versionsstempel `{Zähler, Zufall}`.
- Pro Seite gibt es eine Notizdatei `notes/<id>` (ID = Seiten-ID + 1 als 128-Bit-Zahl) mit **Strich-Records**
  (Header + Body): UUID, Versionsstempel, Geräte-ID und Sequenznummer, Farbe (RGBA als f32), z-Reihenfolge und die
  **Geometrie** als LZ4-komprimierter Blob in Apples „bv41“-Rahmen.
- Die Geometrie ist ein „tpl\0“-Paket (typisiertes, gepacktes Little-Endian-Layout mit Signatur-String): Version,
  Strichbreite, Knotentypen (moveTo / quadTo), Punkte und quadratische Segmente – für einen Stift mit gleichmäßiger
  Breite ohne Breiten pro Knoten.
- Koordinaten: Canvas-Einheiten = PDF-Punkte × 11/6, Ursprung oben links. Papier „a4_1_1 – Yellow“: Linienabstand
  17,5 pt, erste Linie 50 pt von oben, 45 Linien.
- Die Vorlage wird mit `src/goodnotes/tools/make-template.mjs` aus einem Export einer leeren Seite erzeugt
  (Striche als gelöschte Einträge, Suchindex entfernt, Titel „Handschrift“, leere Vorschau).
- Der Protobuf-Codec ist schema-los und verlustfrei, damit unbekannte Felder unverändert erhalten bleiben.

## Datenschutz

- Ohne Anmeldung bleibt alles im Browser (`localStorage`); es wird nichts übertragen. Die Umwandlung in die
  Goodnotes-Datei passiert vollständig im Browser – der eingegebene Text verlässt das Gerät nie.
- Mit registriertem Konto werden nur die Schriftproben (Strich-Koordinaten pro Zeichen) und die genannten
  Einstellungen in der Datenbank des yezun.de-Kontos gespeichert, nur für dich lesbar (Row Level Security).
  Gast-Sitzungen speichern nichts auf dem Server.
- Beim Löschen des Kontos (Konto-Seite) werden alle Schriftdaten mitgelöscht. Lokale Daten lassen sich über die
  Website-Daten des Browsers entfernen.
- Keine Tracker, keine Analyse, keine Drittanbieter-Skripte.
