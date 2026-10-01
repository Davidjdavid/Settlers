/* Seeded PRNG (sfc32). Its whole state lives in GameState.rng so games replay exactly. */

export type RngState = [number, number, number, number];

/** Hash a seed string into an initial sfc32 state (cyrb128). */
export function seedRng(seed: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const st: RngState = [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  // Warm up so similar seeds diverge.
  for (let i = 0; i < 15; i++) nextFloat(st);
  return st;
}

/** Advance `st` in place and return a float in [0, 1). */
export function nextFloat(st: RngState): number {
  let [a, b, c, d] = st;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  st[0] = a >>> 0;
  st[1] = b >>> 0;
  st[2] = c >>> 0;
  st[3] = d >>> 0;
  return (t >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function nextInt(st: RngState, n: number): number {
  return Math.floor(nextFloat(st) * n);
}

export function shuffle<T>(arr: T[], st: RngState): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(st, i + 1);
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}
