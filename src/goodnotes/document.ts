/**
 * Goodnotes 6 document writer/reader on top of a template `.goodnotes` file (a ZIP).
 *
 * Template layout: index.events.pb (op log) · index.notes.pb (notes id → notes/<id>) ·
 * notes/<notesId> (stroke records) · index.search.pb + search/* · index.attachments.pb +
 * attachments/<pdf> (paper) · thumbnail.jpg · schema.pb · document.info.pb.
 * The notes id of a page is its page id + 1 (as a 128-bit integer).
 */
import type { DocumentContent, PageStroke } from '../types.ts';
import { newUuid, randomU32, uuidAdd } from './bytes.ts';
import {
  cloneEvent,
  compareKeys,
  encodeEvents,
  maxLamport,
  orderKeysAfter,
  pageOrderKey,
  pagePaperId,
  parseEvents,
  T_NOTES,
  T_PAGE,
  T_PAPER,
  type EventRecord,
} from './events.ts';
import * as pb from './protobuf.ts';
import {
  decodeNotesFile,
  decodeStrokeRecord,
  encodeNotesFile,
  geometryToPolyline,
  polylineToGeometry,
  splitNotesFile,
  strokeToRaw,
  type RawRecordPair,
  type StrokeRecord,
} from './stroke.ts';
import { entryData, makeEntry, readZip, replaceEntryData, writeZip, type ZipArchive, type ZipEntry } from './zip.ts';

export const EVENTS = 'index.events.pb';
export const NOTES_INDEX = 'index.notes.pb';
export const notesPath = (notesId: string) => 'notes/' + notesId;

/** Observed constants of stroke headers. */
const DEFAULT_F14 = 5381;
const DEFAULT_SCHEMA = 24;
/** Version stamp counter of freshly drawn, never edited strokes in the sample. */
const NEW_STROKE_COUNTER = 2;

export interface GoodnotesPage {
  pageId: string;
  notesId: string;
  paperId: string;
  orderKey: string;
  /** All stroke records of the page, including deleted ones (tombstones), in file order. */
  strokes: StrokeRecord[];
}

export interface GoodnotesFile {
  documentId: string | undefined;
  pages: GoodnotesPage[];
  zip: ZipArchive;
  events: EventRecord[];
}

function findEntry(zip: ZipArchive, name: string): ZipEntry | undefined {
  return zip.entries.find((e) => e.name === name);
}
function requireEntry(zip: ZipArchive, name: string): ZipEntry {
  const e = findEntry(zip, name);
  if (!e) throw new Error('goodnotes: missing ' + name);
  return e;
}

function sortedPages(events: EventRecord[]): EventRecord[] {
  return events.filter((r) => r.type === T_PAGE).sort((a, b) => compareKeys(pageOrderKey(a), pageOrderKey(b)));
}

/** Decodes a `.goodnotes` file: pages in display order with their stroke records. */
export function readGoodnotes(file: Uint8Array): GoodnotesFile {
  const zip = readZip(file);
  const events = parseEvents(entryData(requireEntry(zip, EVENTS)));
  const pages = sortedPages(events).map((p): GoodnotesPage => {
    const notesId = uuidAdd(p.id, 1);
    const e = findEntry(zip, notesPath(notesId));
    return {
      pageId: p.id,
      notesId,
      paperId: pagePaperId(p),
      orderKey: pageOrderKey(p),
      strokes: e ? decodeNotesFile(entryData(e)) : [],
    };
  });
  return { documentId: events.find((r) => r.type === 30)?.id, pages, zip, events };
}

/** Decodes a `.goodnotes` file to the writer's input model (live strokes in z order). */
export function decodeGoodnotes(file: Uint8Array): DocumentContent {
  return {
    pages: readGoodnotes(file).pages.map((p) => ({
      strokes: p.strokes
        .filter((s) => !s.deleted && s.geometry.starts.length === 1)
        .sort((a, b) => a.z.index - b.z.index)
        .map(
          (s): PageStroke => ({
            points: geometryToPolyline(s.geometry),
            width: s.geometry.width,
            color: { r: s.color[0], g: s.color[1], b: s.color[2], a: s.color[3] },
          }),
        ),
    })),
  };
}

interface StrokeContext {
  device: bigint;
  f14: number;
  schema: number;
  seq: number;
}

function newStrokeRecords(strokes: readonly PageStroke[], ctx: StrokeContext, zStart: number): RawRecordPair[] {
  let z = zStart;
  return strokes
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const uuid = newUuid();
      const rand = randomU32();
      const rec: StrokeRecord = {
        uuid,
        clock: { counter: NEW_STROKE_COUNTER, rand },
        deleted: false,
        device: ctx.device,
        seq: ++ctx.seq,
        f14: ctx.f14,
        schema: ctx.schema,
        color: [s.color.r, s.color.g, s.color.b, s.color.a],
        z: { index: z++, rand: randomU32() },
        geometry: polylineToGeometry(s.points, s.width),
      };
      return strokeToRaw(rec);
    });
}

/**
 * Writes `doc` into a copy of `template`: page 1 = the template's (last) page, further pages are
 * added as clones of it (new paper + page records with fresh ids, order keys sorting after it).
 * Strokes are appended after any records already present on the template page. Unchanged ZIP
 * entries are copied byte for byte.
 */
export async function writeGoodnotes(template: Uint8Array, doc: DocumentContent): Promise<Uint8Array> {
  const zip = readZip(template);
  const events = parseEvents(entryData(requireEntry(zip, EVENTS)));
  const pages = sortedPages(events);
  if (!pages.length) throw new Error('goodnotes: template has no page');
  const tplPage = pages[pages.length - 1];
  const tplPaperId = pagePaperId(tplPage);
  const tplPaper = events.find((r) => r.type === T_PAPER && r.id === tplPaperId);
  if (!tplPaper) throw new Error('goodnotes: paper record of template page not found');
  const tplNotesId = uuidAdd(tplPage.id, 1);
  const tplNotesEvent = events.find((r) => r.type === T_NOTES && r.id === tplNotesId);
  const tplNotesEntry = requireEntry(zip, notesPath(tplNotesId));
  const existing = splitNotesFile(entryData(tplNotesEntry));
  const existingDecoded = existing.map((r) => decodeStrokeRecord(r.header, r.body));

  const pageDevice = pb.getVarint(tplPage.body, 13);
  const ctx: StrokeContext = {
    device: existingDecoded[0]?.device ?? pageDevice ?? 0n,
    f14: existingDecoded[0]?.f14 ?? DEFAULT_F14,
    schema: existingDecoded[0]?.schema ?? DEFAULT_SCHEMA,
    seq: Math.max(0, ...existingDecoded.map((s) => s.seq)),
  };
  const zAfter = (recs: StrokeRecord[]) => (recs.length ? Math.max(...recs.map((s) => s.z.index)) + 1 : 0);

  const docPages = doc.pages.length ? doc.pages : [{ strokes: [] }];
  const replaced = new Map<string, Uint8Array>();
  const added: ZipEntry[] = [];
  const newEvents: EventRecord[] = [];
  const notesIndexAdds: Uint8Array[] = [];

  // page 1: template page
  const firstNew = newStrokeRecords(docPages[0].strokes, ctx, zAfter(existingDecoded));
  if (firstNew.length) replaced.set(tplNotesEntry.name, encodeNotesFile([...existing, ...firstNew]));

  // pages 2..N: clones
  const keys = orderKeysAfter(pageOrderKey(tplPage), docPages.length - 1);
  const lamport = { value: maxLamport(events) };
  let now = Date.now();
  for (let i = 1; i < docPages.length; i++) {
    const pageId = newUuid();
    const notesId = uuidAdd(pageId, 1);
    const ids = new Map([
      [tplPage.id, pageId],
      [tplPaperId, newUuid()],
      [tplNotesId, notesId],
    ]);
    newEvents.push(cloneEvent(tplPaper, { ids, lamport, now: now++ }));
    newEvents.push(cloneEvent(tplPage, { ids, lamport, now: now++, orderKey: keys[i - 1] }));
    const recs = newStrokeRecords(docPages[i].strokes, ctx, 0);
    if (recs.length) {
      if (tplNotesEvent) newEvents.push(cloneEvent(tplNotesEvent, { ids, lamport, now: now++ }));
      added.push(makeEntry(notesPath(notesId), encodeNotesFile(recs)));
      notesIndexAdds.push(pb.encode([pb.str(1, notesId), pb.str(2, notesPath(notesId))]));
    }
  }
  if (newEvents.length) replaced.set(EVENTS, encodeEvents([...events, ...newEvents]));
  if (notesIndexAdds.length) {
    const idx = findEntry(zip, NOTES_INDEX);
    const recs = idx ? pb.parseStream(entryData(idx)) : [];
    replaced.set(NOTES_INDEX, pb.encodeStream([...recs, ...notesIndexAdds]));
  }

  const entries: ZipEntry[] = [];
  for (const e of zip.entries) {
    const data = replaced.get(e.name);
    entries.push(data ? replaceEntryData(e, data) : e);
    if (e === tplNotesEntry) entries.push(...added);
  }
  if (!findEntry(zip, NOTES_INDEX) && notesIndexAdds.length) {
    entries.push(makeEntry(NOTES_INDEX, replaced.get(NOTES_INDEX)!));
  }
  return writeZip({ entries, comment: zip.comment });
}
