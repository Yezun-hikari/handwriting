/**
 * In-memory stand-in for the parts of supabase-js used by the stores: from().select().eq()(.maybeSingle()),
 * upsert(row | rows, { onConflict }), delete().eq(). Records calls; `failWith` makes the next requests fail.
 */
import type { DbClient } from '../supabase.ts';

export type Row = Record<string, unknown>;
export interface FakeError {
  message: string;
  code?: string;
}

export class FakeDb {
  tables = new Map<string, Row[]>();
  calls: unknown[][] = [];
  /** Error (and HTTP status) returned by every request while set. */
  failWith: { error: FakeError; status: number } | null = null;
  /** Only fail requests of this kind. */
  failOn: 'select' | 'upsert' | 'delete' | null = null;

  rows(t: string): Row[] {
    if (!this.tables.has(t)) this.tables.set(t, []);
    return this.tables.get(t)!;
  }

  private result(kind: 'select' | 'upsert' | 'delete', data: unknown) {
    if (this.failWith && (!this.failOn || this.failOn === kind))
      return { data: null, error: this.failWith.error, status: this.failWith.status };
    return { data, error: null, status: 200 };
  }

  client(): DbClient {
    const db = this;
    const from = (table: string) => {
      db.calls.push(['from', table]);
      const filters: [string, unknown][] = [];
      const match = (r: Row) => filters.every(([c, v]) => r[c] === v);
      const filterable = (kind: 'select' | 'delete', run: () => unknown) => {
        const q = {
          eq(c: string, v: unknown) {
            db.calls.push(['eq', c, v]);
            filters.push([c, v]);
            return q;
          },
          maybeSingle() {
            const res = db.result(kind, null);
            if (res.error) return Promise.resolve(res);
            const rows = run() as Row[];
            return Promise.resolve({ ...res, data: rows[0] ?? null });
          },
          then<T>(ok: (r: unknown) => T, bad?: (e: unknown) => T) {
            const res = db.result(kind, null);
            return Promise.resolve(res.error ? res : { ...res, data: run() }).then(ok, bad);
          },
        };
        return q;
      };
      return {
        select(cols: string) {
          db.calls.push(['select', cols]);
          return filterable('select', () => db.rows(table).filter(match).map((r) => structuredClone(r)));
        },
        upsert(input: Row | Row[], opts?: { onConflict?: string }) {
          const list = Array.isArray(input) ? input : [input];
          db.calls.push(['upsert', list.length, opts?.onConflict]);
          const res = db.result('upsert', null);
          if (!res.error) {
            const keys = (opts?.onConflict ?? 'id').split(',');
            const rows = db.rows(table);
            for (const r of list) {
              const i = rows.findIndex((x) => keys.every((k) => x[k] === r[k]));
              const copy = structuredClone(r);
              if (i >= 0) rows[i] = copy;
              else rows.push(copy);
            }
          }
          return Promise.resolve(res);
        },
        delete() {
          db.calls.push(['delete']);
          return filterable('delete', () => {
            db.tables.set(table, db.rows(table).filter((r) => !match(r)));
            return null;
          });
        },
      };
    };
    return { from } as unknown as DbClient; // test double: only the methods the stores call
  }
}
