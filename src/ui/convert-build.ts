/**
 * Building the Goodnotes file for the convert screen: full layout + writeGoodnotes. Runs inside a Web Worker
 * (convert-worker.ts) so long texts never freeze the page; `buildGoodnotesFile` is also the synchronous fallback
 * (tests, browsers without module workers). No DOM access here.
 */
import { writeGoodnotes } from '../goodnotes/index.ts';
import { layoutText } from '../layout/index.ts';
import type { Glyph } from '../types.ts';

export interface BuildRequest {
  text: string;
  glyphs: Glyph[];
  headingWidthMm: number;
  bodyWidthMm: number;
  template: Uint8Array;
}

export type BuildProgress = { stage: 'layout' } | { stage: 'pages'; done: number; total: number } | { stage: 'zip' };

export interface BuildResult {
  bytes: Uint8Array;
  pages: number;
  missing: string[];
}

export async function buildGoodnotesFile(req: BuildRequest, onProgress?: (p: BuildProgress) => void): Promise<BuildResult> {
  onProgress?.({ stage: 'layout' });
  const r = layoutText(req.text, req.glyphs, { headingWidthMm: req.headingWidthMm, bodyWidthMm: req.bodyWidthMm });
  const bytes = await writeGoodnotes(req.template, r.doc, (done, total) => {
    onProgress?.({ stage: 'pages', done, total });
    if (done === total) onProgress?.({ stage: 'zip' });
  });
  return { bytes, pages: r.doc.pages.length, missing: r.missing };
}

/** Messages between the screen and the worker. */
export type WorkerRequest = { id: number; req: BuildRequest };
export type WorkerReply =
  | { id: number; kind: 'progress'; progress: BuildProgress }
  | { id: number; kind: 'done'; result: BuildResult }
  | { id: number; kind: 'error'; message: string };

/** German status line for a progress event. */
export function progressText(p: BuildProgress): string {
  switch (p.stage) {
    case 'layout':
      return 'Wird erstellt … Text wird gesetzt';
    case 'pages':
      return `Wird erstellt … Seite ${p.done} von ${p.total}`;
    case 'zip':
      return 'Wird erstellt … Datei wird gepackt';
  }
}

/** Progress as 0..1 (layout ≈ 5 %, pages up to 95 %, packing the rest). */
export function progressFraction(p: BuildProgress): number {
  switch (p.stage) {
    case 'layout':
      return 0.02;
    case 'pages':
      return 0.05 + 0.9 * (p.done / Math.max(1, p.total));
    case 'zip':
      return 0.96;
  }
}
