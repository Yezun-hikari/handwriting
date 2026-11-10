/**
 * Module worker for the convert screen (created in convert-deps.ts with
 * `new Worker(new URL('./convert-worker.ts', import.meta.url), { type: 'module' })`).
 * One request per message; replies with progress events, then the file bytes (transferred, not copied).
 */
import { buildGoodnotesFile, type WorkerReply, type WorkerRequest } from './convert-build.ts';

const scope = self as unknown as { postMessage(m: WorkerReply, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null };

scope.onmessage = (e) => {
  const { id, req } = e.data;
  buildGoodnotesFile(req, (progress) => scope.postMessage({ id, kind: 'progress', progress })).then(
    (result) => scope.postMessage({ id, kind: 'done', result }, [result.bytes.buffer as ArrayBuffer]),
    (err: unknown) => scope.postMessage({ id, kind: 'error', message: err instanceof Error ? err.message : String(err) }),
  );
};
