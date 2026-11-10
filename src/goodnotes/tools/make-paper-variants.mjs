#!/usr/bin/env node
// Derives the other paper templates (public/template/a4-<rule>-<colour>.goodnotes) from the blank
// public/template/a4-ruled-yellow.goodnotes and a Goodnotes export that has one page of each paper.
//
// usage: node src/goodnotes/tools/make-paper-variants.mjs <sample.goodnotes> <thumbs-dir>
//
// For each variant: the base template's paper PDF is swapped for the sample's (attachment id taken
// from the sample, so every paper has its own id), the attachment record gets the new size, the paper
// record the sample's template name, and thumbnail.jpg becomes <thumbs-dir>/<variant>.jpg (blank paper).
// Requires Node >= 22.18 (imports the TypeScript library via type stripping).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { latin1 } from '../bytes.ts';
import { compareKeys, encodeEvents, pageOrderKey, pagePaperId, parseEvents, T_PAGE, T_PAPER } from '../events.ts';
import * as pb from '../protobuf.ts';
import { entryData, makeEntry, readZip, replaceEntryData, writeZip } from '../zip.ts';

const T_ATTACHMENT = 6;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../public/template');
const [samplePath, thumbs] = process.argv.slice(2);
if (!samplePath || !thumbs) {
  console.error('usage: make-paper-variants.mjs <sample.goodnotes> <thumbs-dir>');
  process.exit(2);
}

// Goodnotes template families (paper record field 9: "<family>_a4_1_<1 yellow|2 white> - <Colour>").
const FAMILY = { narrow: '238EE861-EE9A-51BD-B010-832CD3C50D2C', wide: 'AA273C17-F440-5125-B34E-F9C3C62F89E2', grid: '9FE8F365-4BEE-5057-8573-1A56C77CAC19' };
const VARIANTS = [
  ['narrow', 'white', 'a4-ruled-white'],
  ['wide', 'yellow', 'a4-wide-yellow'],
  ['wide', 'white', 'a4-wide-white'],
  ['grid', 'yellow', 'a4-grid-yellow'],
  ['grid', 'white', 'a4-grid-white'],
];

const sample = readZip(new Uint8Array(readFileSync(samplePath)));
const sampleEvents = parseEvents(entryData(sample.entries.find((e) => e.name === 'index.events.pb')));
const samplePapers = sampleEvents
  .filter((r) => r.type === T_PAGE)
  .sort((a, b) => compareKeys(pageOrderKey(a), pageOrderKey(b)))
  .map((p) => sampleEvents.filter((r) => r.type === T_PAPER && r.id === pagePaperId(p)).at(-1));

const baseBytes = new Uint8Array(readFileSync(join(outDir, 'a4-ruled-yellow.goodnotes')));

/** Replaces every occurrence of an ASCII string by another of the same length. */
function swapId(buf, from, to) {
  const a = latin1(from);
  const b = latin1(to);
  const out = buf.slice();
  for (let i = 0; i + a.length <= out.length; i++) if (a.every((x, k) => out[i + k] === x)) out.set(b, i);
  return out;
}

for (const [rule, colour, file] of VARIANTS) {
  const name = `${FAMILY[rule]}_a4_1_${colour === 'yellow' ? 1 : 2} - ${colour === 'yellow' ? 'Yellow' : 'White'}`;
  const paper = samplePapers.find((r) => pb.getString(r.body, 9) === name);
  if (!paper) throw new Error(`sample has no page with paper ${name}`);
  const newId = pb.getString(paper.body, 4);
  const pdf = entryData(sample.entries.find((e) => e.name === 'attachments/' + newId));

  const zip = readZip(baseBytes);
  const evEntry = zip.entries.find((e) => e.name === 'index.events.pb');
  const oldId = parseEvents(entryData(evEntry)).find((r) => r.type === T_ATTACHMENT).id;
  const events = parseEvents(swapId(entryData(evEntry), oldId, newId));
  for (const r of events) {
    if (r.type === T_ATTACHMENT && r.id === newId) r.body = pb.setField(r.body, pb.varint(5, pdf.length));
    if (r.type === T_PAPER) r.body = pb.setField(r.body, pb.str(9, name));
  }
  const entries = zip.entries.map((e) => {
    if (e === evEntry) return replaceEntryData(e, encodeEvents(events));
    if (e.name === 'index.search.pb' || e.name === 'index.attachments.pb') return replaceEntryData(e, swapId(entryData(e), oldId, newId));
    if (e.name === 'attachments/' + oldId) return makeEntry('attachments/' + newId, pdf);
    if (e.name === 'search/' + oldId) return makeEntry('search/' + newId, entryData(e));
    if (e.name === 'thumbnail.jpg') return replaceEntryData(e, new Uint8Array(readFileSync(join(thumbs, `${rule === 'narrow' ? 'narrow' : rule}-${colour}.jpg`))));
    return e;
  });
  const out = join(outDir, `${file}.goodnotes`);
  writeFileSync(out, writeZip({ entries, comment: zip.comment }));
  console.log('wrote', out, `(${name})`);
}
