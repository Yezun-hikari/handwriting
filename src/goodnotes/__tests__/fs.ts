// Node file access for tests without depending on @types/node (not installed).
type Fs = { readFileSync(p: string | URL): Uint8Array; existsSync(p: string | URL): boolean };
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs;

export const TEMPLATE_URL = new URL('../../../public/template/a4-ruled-yellow.goodnotes', import.meta.url);

/** The user's private sample, used only when present locally (never committed). */
const SAMPLE_PATH =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.GOODNOTES_SAMPLE ??
  '/tmp/claude-0/-home-user-handwriting/9c3d9d02-2e62-50f1-a901-1147801443c1/scratchpad/sample/claude.goodnotes';

export const readBytes = (p: string | URL): Uint8Array => new Uint8Array(fs.readFileSync(p));
export const sampleBytes = (): Uint8Array | null => (fs.existsSync(SAMPLE_PATH) ? readBytes(SAMPLE_PATH) : null);
