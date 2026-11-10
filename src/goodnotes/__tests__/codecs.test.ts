import { describe, expect, it } from 'vitest';
import { bytesEqual, uuidAdd } from '../bytes.ts';
import { lz4BlockDecode, lz4BlockEncode, lz4FrameDecode, lz4FrameEncode } from '../lz4.ts';
import * as pb from '../protobuf.ts';
import {
  decodeStrokeRecord,
  geometryToPolyline,
  polylineToGeometry,
  splitNotesFile,
  strokeToRaw,
  type StrokeRecord,
} from '../stroke.ts';
import { tplDecode, tplEncode } from '../tpl.ts';
import { orderKeysAfter } from '../events.ts';

const f32 = (x: number) => Math.fround(x);

function pseudoRandom(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe('protobuf', () => {
  it('round-trips fields of all wire types, incl. u64 varints', () => {
    const m: pb.Message = [
      pb.str(1, 'ÄBC'),
      pb.varint(2, 4196167631507652097n),
      pb.varint(3, 0xffffffffffffffffn),
      pb.fixed32(4, new Uint8Array([1, 2, 3, 4])),
      pb.fixed64(5, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
      pb.msg(6, [pb.varint(1, 1), pb.varint(2, 2763321332)]),
      pb.bytes(7, new Uint8Array(0)),
      pb.varint(300, 0),
    ];
    const b = pb.encode(m);
    const back = pb.parse(b);
    expect(back).toEqual(m);
    expect(bytesEqual(pb.encode(back), b)).toBe(true);
    expect(pb.getString(back, 1)).toBe('ÄBC');
    expect(pb.getVarint(back, 2)).toBe(4196167631507652097n);
  });
  it('round-trips length-delimited streams', () => {
    const recs = [new Uint8Array(0), new Uint8Array(200).fill(7), new Uint8Array([1])];
    expect(pb.parseStream(pb.encodeStream(recs))).toEqual(recs);
  });
  it('rejects truncated input', () => {
    expect(() => pb.parse(new Uint8Array([0x0a, 5, 1]))).toThrow();
  });
});

describe('lz4', () => {
  it('round-trips random, repetitive and tiny inputs', () => {
    const rnd = pseudoRandom(1);
    const inputs = [
      new Uint8Array(0),
      new Uint8Array([1, 2, 3]),
      new Uint8Array(1000).map(() => Math.floor(rnd() * 256)),
      new Uint8Array(70000).map((_, i) => (i % 37) * 3),
      new Uint8Array(5000).map(() => (rnd() < 0.8 ? 0 : 255)),
    ];
    for (const raw of inputs) {
      expect(lz4BlockDecode(lz4BlockEncode(raw), raw.length)).toEqual(raw);
      expect(lz4FrameDecode(lz4FrameEncode(raw))).toEqual(raw);
    }
  });
  it('actually compresses repetitive data', () => {
    const raw = new Uint8Array(4000).map((_, i) => i % 16);
    expect(lz4BlockEncode(raw).length).toBeLessThan(200);
  });
});

describe('tpl', () => {
  it('round-trips the stroke signature', () => {
    const t = {
      sig: 'vuA(v)A(S(uu))A(S(uuuu))vA(f)',
      values: [2, f32(1.3), [0, 1, 1], [[f32(1.5), f32(2.5)]], [[1, 2, 3, 4], [5, 6, 7, 8]], 1, [f32(0.1)]],
    };
    const b = tplEncode(t);
    expect(tplDecode(b)).toEqual(t);
    expect(bytesEqual(tplEncode(tplDecode(b)), b)).toBe(true);
  });
});

describe('stroke geometry', () => {
  it('polyline -> midpoint quadratics -> polyline', () => {
    for (const n of [1, 2, 3, 10]) {
      const pts = Array.from({ length: n }, (_, i) => ({ x: 10 + i * 3.3, y: 20 + Math.sin(i) * 7 }));
      const g = polylineToGeometry(pts, 1.2992);
      expect(g.nodeTypes.length).toBe(1 + g.quads.length);
      expect(g.quads.length).toBe(Math.max(1, n));
      // curve is continuous and ends at the last point
      expect(g.quads[g.quads.length - 1].slice(2)).toEqual([pts[n - 1].x, pts[n - 1].y]);
      expect(geometryToPolyline(g)).toEqual(pts);
    }
  });
  it('stroke record encodes and decodes (float32 precision)', () => {
    const rec: StrokeRecord = {
      uuid: '8B3CA54D-988D-4C02-A9E2-0EF0EED17303',
      clock: { counter: 2, rand: 3995937281 },
      deleted: false,
      device: 4196167631507652097n,
      seq: 1114414,
      f14: 5381,
      schema: 24,
      color: [0, 0, 0, 1],
      z: { index: 0, rand: 4291661641 },
      geometry: polylineToGeometry(
        [
          { x: 100.1, y: 200.2 },
          { x: 110.7, y: 205.3 },
          { x: 120.9, y: 199.9 },
        ],
        3.6378,
      ),
    };
    const raw = strokeToRaw(rec);
    const back = decodeStrokeRecord(raw.header, raw.body);
    expect(back.uuid).toBe(rec.uuid);
    expect(back.device).toBe(rec.device);
    expect(back.color).toEqual([0, 0, 0, 1]);
    expect(back.geometry.width).toBeCloseTo(3.6378, 5);
    const pts = geometryToPolyline(back.geometry);
    expect(pts.map((p) => [p.x, p.y])).toEqual([
      [f32(100.1), f32(200.2)],
      [f32(110.7), f32(205.3)],
      [f32(120.9), f32(199.9)],
    ]);
    const again = strokeToRaw(back);
    expect(bytesEqual(again.header, raw.header)).toBe(true);
    expect(bytesEqual(again.body, raw.body)).toBe(true);
    expect(splitNotesFile(pb.encodeStream([raw.header, raw.body]))).toHaveLength(1);
  });
});

describe('ids and order keys', () => {
  it('uuidAdd carries across 128 bits', () => {
    expect(uuidAdd('11F32BC7-8542-4B19-A1E6-5768D6ED860A', 1)).toBe('11F32BC7-8542-4B19-A1E6-5768D6ED860B');
    expect(uuidAdd('00000000-0000-4000-8000-0000FFFFFFFF', 1)).toBe('00000000-0000-4000-8000-000100000000');
  });
  it('order keys sort strictly after the base and ascending', () => {
    const keys = orderKeysAfter('A1EKT', 200);
    expect(new Set(keys).size).toBe(200);
    let prev = 'A1EKT';
    for (const k of keys) {
      expect(k > prev).toBe(true);
      expect(k.endsWith('0')).toBe(false);
      prev = k;
    }
  });
});
