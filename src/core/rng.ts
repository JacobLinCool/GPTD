/**
 * Small, fast, deterministic PRNG (mulberry32). Seeded so the whole simulation
 * is reproducible — essential for the Vitest suite to assert on full playthroughs.
 */
export class RNG {
  private s: number

  constructor(seed = 0x9e3779b9) {
    // normalize to uint32
    this.s = seed >>> 0
  }

  /** Next float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Integer in [0, max). */
  int(max: number): number {
    return Math.floor(this.next() * max)
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** True with probability p (0..1). */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Pick a random element. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }

  /** A child RNG forked deterministically from this one. */
  fork(): RNG {
    return new RNG((this.s ^ (this.int(0xffffffff) >>> 0)) >>> 0)
  }

  /** Serialize/restore for save games. */
  get state(): number {
    return this.s
  }
  set state(v: number) {
    this.s = v >>> 0
  }
}
