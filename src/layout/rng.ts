/** Small deterministic PRNG (mulberry32). Same seed → same sequence on every platform. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  /** Triangular-ish in [-1, 1], centred on 0 (more natural than uniform). */
  soft(): number {
    return (this.signed() + this.signed()) / 2;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
