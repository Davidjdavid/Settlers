/*
 * Colour checks for player pieces (SPEC 4.2): colour difference (CIEDE2000) between colours and
 * against tiles, under normal vision and simulated colorblindness (Machado et al. 2009, full
 * severity). Pure functions, used by the tests.
 */

export type Vision = 'normal' | 'protan' | 'deutan' | 'tritan';
export const VISIONS: Vision[] = ['normal', 'protan', 'deutan', 'tritan'];

const MATRIX: Record<Exclude<Vision, 'normal'>, number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Linear RGB as seen with a given vision. */
function seen(hex: string, v: Vision): [number, number, number] {
  const [r, g, b] = rgb(hex).map(toLin) as [number, number, number];
  if (v === 'normal') return [r, g, b];
  const m = MATRIX[v];
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(m[0]! * r + m[1]! * g + m[2]! * b),
    clamp(m[3]! * r + m[4]! * g + m[5]! * b),
    clamp(m[6]! * r + m[7]! * g + m[8]! * b),
  ];
}

function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 colour difference. */
export function deltaE([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1!, b1!);
  const C2 = Math.hypot(a2!, b2!);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1! * (1 + G);
  const a2p = a2! * (1 + G);
  const C1p = Math.hypot(a1p, b1!);
  const C2p = Math.hypot(a2p, b2!);
  const h = (a: number, b: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = h(a1p, b1!);
  const h2p = h(a2p, b2!);
  const dL = L2! - L1!;
  const dC = C2p - C1p;
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * rad) / 2);
  const Lb = (L1! + L2!) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hb = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hb += h1p + h2p < 360 ? 360 : -360;
    hb /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hb - 30) * rad) +
    0.24 * Math.cos(2 * hb * rad) +
    0.32 * Math.cos((3 * hb + 6) * rad) -
    0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const RT = -RC * Math.sin(2 * dTheta * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/** How different two colours look with a given vision. */
export const diff = (x: string, y: string, v: Vision = 'normal') => deltaE(lab(seen(x, v)), lab(seen(y, v)));
