/*
 * What hovering a piece, or pressing and holding it, says (SPEC 8.3). Worked out from this
 * player's view only, so a label never shows anything hidden.
 */

import {
  RES,
  TRACKS,
  geometryFor,
  robberAwake,
  stateFromView,
  type Geometry,
  type PlayerView,
  type Resource,
  type Track,
} from '@settlers/engine';
import { K, RES_LABEL, TRACK_LABEL } from './art';
import { harborPoint } from './Board';

export type Spot =
  | { k: 'metro'; t: Track; v: number }
  | { k: 'knight'; v: number }
  | { k: 'building'; v: number }
  | { k: 'tile'; h: number }
  | { k: 'port'; i: number }
  | { k: 'robber' }
  | { k: 'pirate' }
  | { k: 'merchant' };

/** A piece that has a label, with where it's drawn and how close counts (board units). */
export interface SpotAt {
  spot: Spot;
  x: number;
  y: number;
  r: number;
}

/** Every piece on the board with a label, at the place it's drawn. */
export function spotsOf(view: PlayerView, g: Geometry, no3to1: boolean): SpotAt[] {
  const out: SpotAt[] = [];
  const b = view.board;
  b.ports.forEach((pt, i) => {
    if (no3to1 && pt.t === 'any') return;
    const e = g.edges[pt.e]!;
    const land = e.hexes.find((x) => b.hexes[x]!.t !== 'sea') ?? e.hexes[0]!;
    const p = harborPoint(g, pt.e, land);
    out.push({ spot: { k: 'port', i }, x: p.x / K, y: p.y / K, r: 0.36 });
  });
  // Number tokens (SPEC 13.4): what a tile pays and how often.
  b.hexes.forEach((hx, i) => {
    if (!hx.n) return;
    const h = g.hexes[i]!;
    out.push({ spot: { k: 'tile', h: i }, x: h.x, y: h.y, r: 0.3 });
  });
  if (b.robber >= 0) {
    const h = g.hexes[b.robber]!;
    out.push({ spot: { k: 'robber' }, x: h.x - 0.52, y: h.y, r: 0.3 });
  }
  if ((b.pirate ?? -1) >= 0) {
    const h = g.hexes[b.pirate!]!;
    out.push({ spot: { k: 'pirate' }, x: h.x, y: h.y, r: 0.42 });
  }
  const ck = view.ck;
  if (ck?.merchant) {
    const h = g.hexes[ck.merchant.h]!;
    out.push({ spot: { k: 'merchant' }, x: h.x + 0.5, y: h.y, r: 0.28 });
  }
  view.verts.forEach((bd, v) => {
    if (!bd) return;
    const t = ck ? TRACKS.find((x) => ck.metro[x] === v) : undefined;
    const V = g.verts[v]!;
    out.push({ spot: t ? { k: 'metro', t, v } : { k: 'building', v }, x: V.x, y: V.y, r: 0.32 });
  });
  ck?.knights.forEach((kn, v) => {
    if (!kn) return;
    const V = g.verts[v]!;
    out.push({ spot: { k: 'knight', v }, x: V.x, y: V.y, r: 0.3 });
  });
  return out;
}

/** The labelled piece nearest a board point (board units), if one is close enough. */
export function spotAt(spots: SpotAt[], x: number, y: number): SpotAt | null {
  let best: SpotAt | null = null;
  let bestD = Infinity;
  for (const s of spots) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= s.r && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

const LEVEL = ['', 'basic', 'strong', 'mighty'];
/** Ways two dice make each total, out of 36. */
const WAYS = (n: number) => (n >= 2 && n <= 12 ? 6 - Math.abs(n - 7) : 0);

/** A tile in words: "Ore 6", "the gold field 9". */
function tileName(view: PlayerView, h: number): string {
  const x = view.board.hexes[h]!;
  if ((RES as readonly string[]).includes(x.t)) return `${RES_LABEL[x.t as Resource]} ${x.n}`;
  return x.t === 'gold' ? `Gold field ${x.n}` : `${x.t} ${x.n}`;
}

/**
 * The label for a piece. `rolled` is how often each total has come up this game (index = total),
 * for number tokens.
 */
export function spotLabel(view: PlayerView, spot: Spot, rolled?: readonly number[]): string {
  const name = (p: number) => view.players[p]?.nick ?? 'Someone';
  const g = geometryFor(view.board.hexes);
  const ck = view.ck;
  const walled = (v: number) => (ck?.walls.includes(v) ? ' · city wall: adds 2 to their hand limit' : '');
  switch (spot.k) {
    case 'metro': {
      const p = view.verts[spot.v]![0];
      const lvl = ck!.lvl[p]![spot.t];
      const track = TRACK_LABEL[spot.t];
      const hold =
        lvl >= 5
          ? `it's ${name(p)}'s for good`
          : `${name(p)} is at ${track} level ${lvl}, so whoever reaches level 5 first takes it`;
      return `${track} metropolis · ${name(p)} · worth 4 points (city 2 + metropolis 2) · can't be pillaged by barbarians · ${hold}${walled(spot.v)}`;
    }
    case 'building': {
      const [p, kind] = view.verts[spot.v]!;
      const what = kind === 2 ? 'city · 2 points' : 'settlement · 1 point';
      // What it sits on, and the cards it brings in on average (the robber's tile pays nothing).
      const tiles = g.verts[spot.v]!.hexes.filter((h) => view.board.hexes[h]!.n > 0);
      const per = tiles
        .filter((h) => h !== view.board.robber)
        .reduce((a, h) => a + (WAYS(view.board.hexes[h]!.n) / 36) * kind, 0);
      const on = tiles.length
        ? ` · on ${tiles.map((h) => tileName(view, h)).join(', ')} · about ${Math.round(per * 10)} card${Math.round(per * 10) === 1 ? '' : 's'} every 10 rolls`
        : '';
      return `${name(p)}'s ${what}${on}${walled(spot.v)}`;
    }
    case 'tile': {
      const x = view.board.hexes[spot.h]!;
      const ways = WAYS(x.n);
      const times = rolled ? ` · rolled ${rolled[x.n] ?? 0} time${rolled[x.n] === 1 ? '' : 's'} so far` : '';
      const pays = g.hexVerts[spot.h]!.flatMap((v) => {
        const b = view.verts[v];
        return b ? [`${name(b[0])}'s ${b[1] === 2 ? 'city (2)' : 'settlement (1)'}`] : [];
      });
      const robbed = view.board.robber === spot.h;
      return `${tileName(view, spot.h)} · comes up ${ways} in 36 rolls (${Math.round((ways / 36) * 100)}%)${times} · ${
        robbed ? 'the robber is on it: it pays nothing' : pays.length ? `pays ${pays.join(', ')}` : 'pays nobody yet'
      }`;
    }
    case 'knight': {
      const k = ck!.knights[spot.v]!;
      return `${name(k.p)}'s ${LEVEL[k.lvl]} knight (strength ${k.lvl}) · ${k.on ? 'active' : 'not active'}`;
    }
    case 'port': {
      const t = view.board.ports[spot.i]!.t;
      if (t === 'any') return '3:1 harbor · trade 3 of one card for 1 of anything';
      const r = t as Resource;
      return `2:1 ${RES_LABEL[r]} harbor · trade 2 ${RES_LABEL[r]} for 1 of anything`;
    }
    case 'robber': {
      const asleep = !robberAwake(stateFromView(view));
      return `The robber · the tile it's on produces nothing · ${
        asleep
          ? 'it stays put until the barbarians first attack'
          : 'a 7 or a Knight moves it and steals a card'
      }`;
    }
    case 'pirate':
      return 'The pirate · ships next to it can’t be built or moved · a 7 or a Knight moves it and steals a card';
    case 'merchant': {
      const m = ck!.merchant!;
      const t = view.board.hexes[m.h]!.t;
      const trade = (RES as readonly string[]).includes(t)
        ? `${name(m.p)} trades ${RES_LABEL[t as Resource]} 2:1`
        : 'no trade on this tile';
      return `${name(m.p)}'s merchant · ${trade} · worth 1 point`;
    }
  }
}
