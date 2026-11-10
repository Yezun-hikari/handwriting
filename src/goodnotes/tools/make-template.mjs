#!/usr/bin/env node
// Derives the blank template public/template/a4-ruled-yellow.goodnotes from a Goodnotes export
// of a single "a4_1_1 - Yellow" page.
//
// usage: node src/goodnotes/tools/make-template.mjs <sample.goodnotes> [out.goodnotes] [--thumbnail blank.jpg]
//
// - notes/<id>: keeps only deleted stroke records (tombstones, no ink) so the page has no ink but
//   still carries the device id / sequence / z-order maxima the writer continues from
// - removes search/<notesId> and its index.search.pb entry (handwriting recognition text)
// - document title (document record 30, field 2.1) -> "Handschrift"
// - thumbnail.jpg -> blank paper rendered with Playwright Chromium (or the --thumbnail file)
// Requires Node >= 22.18 (imports the TypeScript library via type stripping).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uuidAdd } from '../bytes.ts';
import { compareKeys, encodeEvents, pageOrderKey, parseEvents, T_DOCUMENT, T_PAGE } from '../events.ts';
import * as pb from '../protobuf.ts';
import { decodeStrokeRecord, encodeNotesFile, splitNotesFile } from '../stroke.ts';
import { entryData, readZip, replaceEntryData, writeZip } from '../zip.ts';

const TITLE = 'Handschrift';
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const thumbIdx = args.indexOf('--thumbnail');
const thumbPath = thumbIdx >= 0 ? args.splice(thumbIdx, 2)[1] : undefined;
const [src, outArg] = args;
if (!src) {
  console.error('usage: make-template.mjs <sample.goodnotes> [out.goodnotes] [--thumbnail blank.jpg]');
  process.exit(2);
}
const out = outArg ?? resolve(here, '../../../public/template/a4-ruled-yellow.goodnotes');

const zip = readZip(new Uint8Array(readFileSync(src)));
const byName = (n) => zip.entries.find((e) => e.name === n);

// ---- events: neutral title -----------------------------------------------------------------
const evEntry = byName('index.events.pb');
const events = parseEvents(entryData(evEntry));
const pages = events.filter((r) => r.type === T_PAGE).sort((a, b) => compareKeys(pageOrderKey(a), pageOrderKey(b)));
if (pages.length !== 1) throw new Error(`expected a single-page sample, got ${pages.length} pages`);
const notesId = uuidAdd(pages[0].id, 1);
let titled = false;
for (const r of events) {
  if (r.type !== T_DOCUMENT) continue;
  const t = pb.getMessage(r.body, 2);
  if (!t || !pb.getString(t, 1)) continue;
  r.body = pb.setField(r.body, pb.msg(2, pb.setField(t, pb.str(1, TITLE))));
  titled = true;
}
console.log(titled ? `title -> ${TITLE}` : 'title field not found, left unchanged');

// ---- notes: tombstones only ----------------------------------------------------------------
const notesEntry = byName('notes/' + notesId);
if (!notesEntry) throw new Error('notes entry for page not found');
const pairs = splitNotesFile(entryData(notesEntry));
const kept = pairs.filter((p) => decodeStrokeRecord(p.header, p.body).deleted);
console.log(`notes: ${pairs.length} records -> ${kept.length} tombstones`);

// ---- search: drop the page's recognition data ------------------------------------------------
const searchIdx = byName('index.search.pb');
const searchRecs = pb.parseStream(entryData(searchIdx));
const keptSearch = searchRecs.filter((r) => pb.getString(pb.parse(r), 1) !== notesId);
console.log(`search index: ${searchRecs.length} -> ${keptSearch.length} entries`);

// ---- thumbnail -----------------------------------------------------------------------------
async function renderThumbnail() {
  if (thumbPath) return readFileSync(thumbPath);
  const require = createRequire(import.meta.url);
  let playwright;
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try {
      playwright = require(p);
      break;
    } catch {
      /* next */
    }
  }
  if (!playwright) throw new Error('playwright not found; pass --thumbnail blank.jpg');
  // paper PDF (595.28 x 841.89 pt): background #f8f7e9, 45 rules 0.5 pt #d0d2d3, first rule 50 pt from top
  const W = 353;
  const H = 499;
  const s = W / 595.28;
  const html = `<html><body style="margin:0"><canvas id=c width=${W} height=${H}></canvas><script>
    const g = document.getElementById('c').getContext('2d');
    g.fillStyle = 'rgb(248,247,233)'; g.fillRect(0, 0, ${W}, ${H});
    g.fillStyle = 'rgb(208,210,211)';
    for (let k = 0; k < 45; k++) g.fillRect(0, (50 + 17.5 * k - 0.5) * ${s}, ${W}, 0.5 * ${s});
  </script></body></html>`;
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(html);
    return await page.locator('#c').screenshot({ type: 'jpeg', quality: 90 });
  } finally {
    await browser.close();
  }
}
const thumb = new Uint8Array(await renderThumbnail());

// ---- assemble ------------------------------------------------------------------------------
const entries = [];
for (const e of zip.entries) {
  if (e.name === 'search/' + notesId) continue;
  if (e === evEntry) entries.push(replaceEntryData(e, encodeEvents(events)));
  else if (e === notesEntry) entries.push(replaceEntryData(e, encodeNotesFile(kept)));
  else if (e === searchIdx) entries.push(replaceEntryData(e, pb.encodeStream(keptSearch)));
  else if (e.name === 'thumbnail.jpg') entries.push(replaceEntryData(e, thumb));
  else entries.push(e);
}
writeFileSync(out, writeZip({ entries, comment: zip.comment }));
console.log('wrote', out);
