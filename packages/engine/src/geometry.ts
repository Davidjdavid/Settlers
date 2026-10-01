/*
 * Board geometry derived from a list of hex coordinates (pointy-top, axial q/r,
 * unit circumradius). Any hex layout works, so custom maps and Seafarers can reuse it.
 * Vertex and edge ids depend only on the order of the hex list, so they are stable
 * for a given board.
 */

export interface Vert {
  x: number;
  y: number;
  hexes: number[];
  edges: number[];
  adj: number[];
}

export interface Edge {
  a: number;
  b: number;
  hexes: number[];
}

export interface Geometry {
  hexes: { q: number; r: number; x: number; y: number }[];
  verts: Vert[];
  edges: Edge[];
  /** Vertex ids around each hex, clockwise from the top-right corner. */
  hexVerts: number[][];
  /** Neighbouring hex indexes for each hex. */
  hexNeighbors: number[][];
  /** Edges with exactly one hex, sorted by angle around the centre. */
  coast: number[];
}

const SQ3 = Math.sqrt(3);
const cache = new Map<string, Geometry>();
/** Per-array memo so repeated lookups on the same state skip building the key. */
const byArray = new WeakMap<object, Geometry>();

export function geometryFor(coords: readonly { q: number; r: number }[]): Geometry {
  let g = byArray.get(coords);
  if (g) return g;
  const key = coords.map((h) => `${h.q},${h.r}`).join(';');
  g = cache.get(key);
  if (!g) {
    g = build(coords);
    cache.set(key, g);
  }
  byArray.set(coords, g);
  return g;
}

function build(coords: readonly { q: number; r: number }[]): Geometry {
  const hexes = coords.map(({ q, r }) => ({ q, r, x: SQ3 * (q + r / 2), y: 1.5 * r }));
  const verts: Vert[] = [];
  const edges: Edge[] = [];
  const vIndex = new Map<string, number>();
  const eIndex = new Map<string, number>();

  const hexVerts = hexes.map((h, hi) => {
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 30);
      const x = h.x + Math.cos(ang);
      const y = h.y + Math.sin(ang);
      const k = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
      let id = vIndex.get(k);
      if (id === undefined) {
        id = verts.length;
        vIndex.set(k, id);
        verts.push({ x, y, hexes: [], edges: [], adj: [] });
      }
      verts[id]!.hexes.push(hi);
      ids.push(id);
    }
    return ids;
  });

  hexVerts.forEach((ids, hi) => {
    for (let i = 0; i < 6; i++) {
      const u = ids[i]!;
      const w = ids[(i + 1) % 6]!;
      const a = Math.min(u, w);
      const b = Math.max(u, w);
      const k = `${a}-${b}`;
      let id = eIndex.get(k);
      if (id === undefined) {
        id = edges.length;
        eIndex.set(k, id);
        edges.push({ a, b, hexes: [] });
        verts[a]!.edges.push(id);
        verts[b]!.edges.push(id);
        verts[a]!.adj.push(b);
        verts[b]!.adj.push(a);
      }
      edges[id]!.hexes.push(hi);
    }
  });

  const hexNeighbors = hexes.map((h) =>
    hexes
      .map((_, j) => j)
      .filter((j) => {
        const o = hexes[j]!;
        const dq = o.q - h.q;
        const dr = o.r - h.r;
        return Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr) === 2;
      }),
  );

  const mid = (i: number) => {
    const e = edges[i]!;
    return { x: (verts[e.a]!.x + verts[e.b]!.x) / 2, y: (verts[e.a]!.y + verts[e.b]!.y) / 2 };
  };
  const coast = edges
    .map((_, i) => i)
    .filter((i) => edges[i]!.hexes.length === 1)
    .sort((i, j) => {
      const a = mid(i);
      const b = mid(j);
      return Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x);
    });

  return { hexes, verts, edges, hexVerts, hexNeighbors, coast };
}

export function edgeMid(g: Geometry, e: number): { x: number; y: number } {
  const E = g.edges[e]!;
  return { x: (g.verts[E.a]!.x + g.verts[E.b]!.x) / 2, y: (g.verts[E.a]!.y + g.verts[E.b]!.y) / 2 };
}
