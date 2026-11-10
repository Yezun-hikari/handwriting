import { describe, expect, it } from 'vitest';
import { decodeGoodnotes } from '../goodnotes/index.ts';
import { readBytes, TEMPLATE_URL } from '../goodnotes/__tests__/fs.ts';
import { layoutText, makeSyntheticGlyphs } from '../layout/index.ts';
import { buildGoodnotesFile, progressFraction, type BuildProgress, type WorkerReply, type WorkerRequest } from './convert-build.ts';
import { buildInline, buildInWorker } from './convert-deps.ts';
import { MAX_TEXT_CHARS, previewDelay, previewPrefix, PREVIEW_CHARS } from './convert-screen.ts';

const glyphs = makeSyntheticGlyphs(1);
const template = readBytes(TEMPLATE_URL);
const longText = (n: number) => 'Ein Satz mit einigen Wörtern für die Seite. '.repeat(Math.ceil(n / 44)).slice(0, n);
const req = (text: string) => ({ text, glyphs, headingWidthMm: 0.7, bodyWidthMm: 0.35, template });

describe('text limits and preview', () => {
  it('limits text to a sane size and previews only a prefix', () => {
    expect(MAX_TEXT_CHARS).toBeLessThanOrEqual(60_000);
    expect(previewPrefix('kurz', 10)).toEqual({ text: 'kurz', truncated: false });
    const p = previewPrefix('aaa bbb\nccc ddd eee', 12);
    expect(p).toEqual({ text: 'aaa bbb\nccc', truncated: true });
    expect(previewDelay(PREVIEW_CHARS + 1)).toBeGreaterThan(previewDelay(100));
  });
  it('measureOnly counts the same pages and missing chars without strokes', () => {
    const t = `${longText(9000)} Ω`;
    const full = layoutText(t, glyphs);
    const m = layoutText(t, glyphs, { measureOnly: true });
    expect(m.doc.pages.length).toBe(full.doc.pages.length);
    expect(m.doc.pages.length).toBeGreaterThan(2);
    expect(m.missing).toEqual(full.missing);
    expect(m.doc.pages.every((p) => p.strokes.length === 0)).toBe(true);
  });
});

describe('building the Goodnotes file', () => {
  it('sync fallback lays out the whole text, writes all pages and reports progress', async () => {
    const seen: BuildProgress[] = [];
    const r = await buildGoodnotesFile(req(longText(7000)), (p) => seen.push(p));
    const pages = layoutText(longText(7000), glyphs, { headingWidthMm: 0.7, bodyWidthMm: 0.35 }).doc.pages.length;
    expect(r.pages).toBe(pages);
    expect(decodeGoodnotes(r.bytes).pages).toHaveLength(pages);
    expect(seen[0]).toEqual({ stage: 'layout' });
    expect(seen.filter((p) => p.stage === 'pages')).toHaveLength(pages);
    expect(seen.at(-1)).toEqual({ stage: 'zip' });
    const f = seen.map(progressFraction);
    expect([...f].sort((a, b) => a - b)).toEqual(f);
  });
  it('buildInline honours an aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(buildInline(req('Hallo'), undefined, ac.signal)).rejects.toThrow();
  });
  it('buildInWorker talks to the worker protocol, keeps the template and terminates', async () => {
    let terminated = false;
    const fake = {
      onmessage: null as ((e: MessageEvent<WorkerReply>) => void) | null,
      onerror: null,
      terminate: () => void (terminated = true),
      postMessage(m: WorkerRequest, transfer: Transferable[]) {
        expect(transfer).toHaveLength(1);
        void buildGoodnotesFile(m.req, (progress) => this.onmessage!({ data: { id: m.id, kind: 'progress', progress } } as MessageEvent)).then(
          (result) => this.onmessage!({ data: { id: m.id, kind: 'done', result } } as MessageEvent),
        );
      },
    };
    const seen: BuildProgress[] = [];
    const before = template.length;
    const blob = await buildInWorker(req('Hallo Welt'), (p) => seen.push(p), undefined, () => fake as unknown as Worker);
    expect(blob.size).toBeGreaterThan(1000);
    expect(seen.length).toBeGreaterThan(1);
    expect(terminated).toBe(true);
    expect(template.length).toBe(before);
  });
  it('falls back to the main thread when no worker can be created', async () => {
    const blob = await buildInWorker(req('Hallo'), undefined, undefined, () => {
      throw new Error('no module workers');
    });
    expect(decodeGoodnotes(new Uint8Array(await blob.arrayBuffer())).pages).toHaveLength(1);
  });
  it('aborting terminates the worker and rejects', async () => {
    let terminated = false;
    const fake = { onmessage: null, onerror: null, terminate: () => void (terminated = true), postMessage() {} };
    const ac = new AbortController();
    const p = buildInWorker(req('Hallo'), undefined, ac.signal, () => fake as unknown as Worker);
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(terminated).toBe(true);
  });
});
