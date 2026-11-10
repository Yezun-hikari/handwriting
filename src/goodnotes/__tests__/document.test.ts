import { describe, expect, it } from 'vitest';
import type { DocumentContent, PageStroke } from '../../types.ts';
import { mmToCanvas } from '../../types.ts';
import { bytesEqual } from '../bytes.ts';
import { decodeGoodnotes, readGoodnotes, writeGoodnotes } from '../document.ts';
import { T_NOTES, T_PAGE, T_PAPER, parseEvents, encodeEvent } from '../events.ts';
import * as pb from '../protobuf.ts';
import { encodeStrokeHeader, encodeStrokeBody, splitNotesFile, decodeStrokeRecord } from '../stroke.ts';
import { entryData, readZip, writeZip } from '../zip.ts';
import { readBytes, sampleBytes, TEMPLATE_URL } from './fs.ts';

const template = readBytes(TEMPLATE_URL);
const sample = sampleBytes();
const black = { r: 0, g: 0, b: 0, a: 1 };

function stroke(points: [number, number][], widthMm = 0.25): PageStroke {
  return { points: points.map(([x, y]) => ({ x, y })), width: mmToCanvas(widthMm), color: black };
}

function expectSameDoc(actual: DocumentContent, expected: DocumentContent) {
  expect(actual.pages.length).toBe(expected.pages.length);
  actual.pages.forEach((p, i) => {
    const e = expected.pages[i].strokes.filter((s) => s.points.length);
    expect(p.strokes.length).toBe(e.length);
    p.strokes.forEach((s, j) => {
      expect(s.width).toBeCloseTo(e[j].width, 5);
      expect(s.color).toEqual(e[j].color);
      expect(s.points.length).toBe(e[j].points.length);
      s.points.forEach((pt, k) => {
        expect(pt.x).toBe(Math.fround(e[j].points[k].x));
        expect(pt.y).toBe(Math.fround(e[j].points[k].y));
      });
    });
  });
}

describe('template', () => {
  it('is a blank single page (only tombstones, no search data)', () => {
    const f = readGoodnotes(template);
    expect(f.pages).toHaveLength(1);
    expect(f.pages[0].strokes.every((s) => s.deleted)).toBe(true);
    expect(decodeGoodnotes(template).pages[0].strokes).toHaveLength(0);
    expect(f.zip.entries.some((e) => e.name === 'search/' + f.pages[0].notesId)).toBe(false);
  });
  it('zip re-writes byte-identically', () => {
    expect(bytesEqual(writeZip(readZip(template)), template)).toBe(true);
  });
  it('events and stroke records re-encode byte-identically', () => {
    const z = readZip(template);
    const ev = entryData(z.entries.find((e) => e.name === 'index.events.pb')!);
    const recs = pb.parseStream(ev);
    parseEvents(ev).forEach((r, i) => expect(bytesEqual(encodeEvent(r), recs[i])).toBe(true));
  });
});

describe('writeGoodnotes', () => {
  const doc: DocumentContent = {
    pages: [
      {
        strokes: [
          stroke([
            [100, 91.667],
            [150, 60],
            [200, 91.667],
          ]),
          stroke([[300, 91.667]]),
          { points: [], width: 1, color: black },
        ],
      },
      { strokes: [stroke([[100, 200], [500, 200.5]], 0.7)] },
      { strokes: [] },
      { strokes: [stroke([[10, 10], [20, 20], [30, 15], [40, 30]])] },
    ],
  };

  it('decodes back to the same strokes (float32 precision)', async () => {
    const out = await writeGoodnotes(template, doc);
    expectSameDoc(decodeGoodnotes(out), doc);
  });

  it('creates N pages with ascending order keys, fresh ids and consistent indexes', async () => {
    const out = await writeGoodnotes(template, doc);
    const f = readGoodnotes(out);
    const tpl = readGoodnotes(template);
    expect(f.pages).toHaveLength(4);
    expect(f.pages[0].pageId).toBe(tpl.pages[0].pageId);
    const keys = f.pages.map((p) => p.orderKey);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(4);
    expect(new Set(f.pages.map((p) => p.paperId)).size).toBe(4);
    // events: 2 per new page + notes event for pages with strokes; old records untouched
    const evs = f.events;
    expect(evs.filter((r) => r.type === T_PAGE)).toHaveLength(4);
    expect(evs.filter((r) => r.type === T_PAPER)).toHaveLength(4);
    expect(evs.filter((r) => r.type === T_NOTES).map((r) => r.id).sort()).toEqual(
      [f.pages[0], f.pages[1], f.pages[3]].map((p) => p.notesId).sort(),
    );
    tpl.events.forEach((r, i) => expect(bytesEqual(encodeEvent(evs[i]), encodeEvent(r))).toBe(true));
    // Lamport counters strictly increase over the appended records
    const lam = evs.slice(tpl.events.length).map((r) => r.body.find((x) => x.wt === 0 && x.v > 10n ** 12n && x.v < 10n ** 14n)!.v);
    lam.forEach((v, i) => i && expect(v > lam[i - 1]).toBe(true));
    // wall clock / event ids are fresh
    const eids = evs.map((r) => pb.getString(r.body, 11));
    expect(new Set(eids).size).toBe(eids.length);
    // notes index lists every notes file
    const z = readZip(out);
    const idx = pb.parseStream(entryData(z.entries.find((e) => e.name === 'index.notes.pb')!)).map((r) =>
      pb.getString(pb.parse(r), 2),
    );
    const notesFiles = z.entries.filter((e) => e.name.startsWith('notes/')).map((e) => e.name);
    expect(idx.sort()).toEqual(notesFiles.sort());
    expect(notesFiles).toHaveLength(3); // empty page 3 has no notes file
    // all entries keep the export's zip settings
    for (const e of z.entries) {
      expect(e.flags).toBe(0x800);
      expect(e.method).toBe(8);
    }
  });

  it('continues sequence numbers and z-order, copies the device id', async () => {
    const out = await writeGoodnotes(template, doc);
    const tpl = readGoodnotes(template).pages[0].strokes;
    const f = readGoodnotes(out);
    const all = f.pages.flatMap((p) => p.strokes.filter((s) => !s.deleted));
    const maxSeq = Math.max(...tpl.map((s) => s.seq));
    const maxZ = Math.max(...tpl.map((s) => s.z.index));
    expect(all.map((s) => s.seq)).toEqual(all.map((_, i) => maxSeq + 1 + i));
    expect(f.pages[0].strokes.filter((s) => !s.deleted).map((s) => s.z.index)).toEqual([maxZ + 1, maxZ + 2]);
    expect(f.pages[1].strokes.map((s) => s.z.index)).toEqual([0]);
    for (const s of all) {
      expect(s.device).toBe(tpl[0].device);
      expect(s.clock.counter).toBe(2);
      expect(s.uuid).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
    }
    // unchanged entries are copied byte for byte
    const a = readZip(template);
    const b = readZip(out);
    for (const e of a.entries) {
      if (['index.events.pb', 'index.notes.pb'].includes(e.name) || e.name.startsWith('notes/')) continue;
      const o = b.entries.find((x) => x.name === e.name)!;
      expect(bytesEqual(o.raw, e.raw)).toBe(true);
      expect(bytesEqual(o.localHeader, e.localHeader)).toBe(true);
    }
  });

  it('single-page doc only touches the notes file', async () => {
    const out = await writeGoodnotes(template, { pages: [doc.pages[0]] });
    const a = readZip(template);
    const b = readZip(out);
    expect(b.entries.map((e) => e.name)).toEqual(a.entries.map((e) => e.name));
    const changed = b.entries.filter((e, i) => !bytesEqual(e.raw, a.entries[i].raw)).map((e) => e.name);
    expect(changed).toEqual([`notes/${readGoodnotes(template).pages[0].notesId}`]);
  });
});

describe.skipIf(!sample)('private sample (local only)', () => {
  it('every stroke record and event re-encodes byte-identically', () => {
    const z = readZip(sample!);
    expect(bytesEqual(writeZip(z), sample!)).toBe(true);
    const notes = z.entries.find((e) => e.name.startsWith('notes/'))!;
    const pairs = splitNotesFile(entryData(notes));
    expect(pairs.length).toBeGreaterThan(10);
    for (const p of pairs) {
      const s = decodeStrokeRecord(p.header, p.body);
      expect(bytesEqual(encodeStrokeHeader(s), p.header)).toBe(true);
      // geometry is re-compressed by our LZ4 encoder, so compare decoded content instead
      expect(decodeStrokeRecord(p.header, encodeStrokeBody(s))).toEqual(s);
    }
    const ev = entryData(z.entries.find((e) => e.name === 'index.events.pb')!);
    const recs = pb.parseStream(ev);
    parseEvents(ev).forEach((r, i) => expect(bytesEqual(encodeEvent(r), recs[i])).toBe(true));
  });
  it('the template differs from the sample only in the expected entries', () => {
    const a = readZip(sample!);
    const b = readZip(template);
    const changed = a.entries
      .filter((e) => {
        const o = b.entries.find((x) => x.name === e.name);
        return !o || !bytesEqual(o.raw, e.raw);
      })
      .map((e) => e.name.replace(/\/.*/, '/*'));
    expect(changed.sort()).toEqual(['index.events.pb', 'index.search.pb', 'notes/*', 'search/*', 'thumbnail.jpg']);
  });
});
