/*
 * Rules that must hold in every reachable state. The simulator checks them after every
 * action, and the server checks them when it loads a saved game. Returns a list of
 * problems (empty means OK).
 */

import { mods } from './modules/api';
import {
  supplyOf,
  DEV_COUNTS,
  PIECES,
  geo,
  piecesLeft,
  publicVP,
  robberHexOK,
  routeLen,
  totalVP,
  vpBreakdown,
} from './queries';
import { DEV_PLAY, RES, type GameState } from './types';

/** Same pieces on the board (so route lengths can't have changed)? */
function samePieces(a: GameState, b: GameState): boolean {
  const eq = <T>(
    x: readonly T[] | undefined,
    y: readonly T[] | undefined,
    f: (t: T | undefined) => unknown,
  ) => x === y || (!!x && !!y && x.length === y.length && x.every((v, i) => f(v) === f(y[i])));
  return (
    eq(a.edges, b.edges, (x) => x) &&
    eq(a.verts, b.verts, (x) => (x ? x[0] * 4 + x[1] : -1)) &&
    eq(a.sea?.ships, b.sea?.ships, (x) => x) &&
    eq(a.ck?.knights, b.ck?.knights, (x) => (x ? x.p : -1))
  );
}

/**
 * `prev` (optional, already checked) lets the simulator skip recomputing route lengths when no
 * piece moved; the result is the same.
 */
export function checkInvariants(s: GameState, prev?: GameState): string[] {
  const bad: string[] = [];
  const g = geo(s);
  const n = s.players.length;

  // Resources are conserved and never negative.
  for (const r of RES) {
    const held = s.players.reduce((a, pl) => a + pl.res[r], 0);
    const supply = supplyOf(s, r);
    if (held + s.bank[r] !== supply) bad.push(`${r}: bank ${s.bank[r]} + hands ${held} != ${supply}`);
    if (s.bank[r] < 0) bad.push(`bank ${r} negative`);
    s.players.forEach((pl, p) => {
      if (pl.res[r] < 0) bad.push(`player ${p} ${r} negative`);
    });
  }

  // Score breakdowns add up exactly to the score (SPEC 5.8), and supply counts are never negative.
  s.players.forEach((_, p) => {
    const sum = (hidden: boolean) => vpBreakdown(s, p, hidden).reduce((a, x) => a + x.vp, 0);
    if (sum(false) !== publicVP(s, p))
      bad.push(`player ${p} public breakdown ${sum(false)} != ${publicVP(s, p)}`);
    if (sum(true) !== totalVP(s, p)) bad.push(`player ${p} breakdown ${sum(true)} != ${totalVP(s, p)}`);
    for (const [k, left] of Object.entries(piecesLeft(s, p)))
      if (!(left! >= 0)) bad.push(`player ${p} has ${left} ${k} left`);
  });

  // Pieces are conserved.
  s.players.forEach((pl, p) => {
    const roads = s.edges.filter((x) => x === p).length;
    const setts = s.verts.filter((b) => b && b[0] === p && b[1] === 1).length;
    const cities = s.verts.filter((b) => b && b[0] === p && b[1] === 2).length;
    if (roads + pl.pieces.road !== PIECES.road) bad.push(`player ${p} roads ${roads}+${pl.pieces.road}`);
    if (setts + pl.pieces.settlement !== PIECES.settlement)
      bad.push(`player ${p} settlements ${setts}+${pl.pieces.settlement}`);
    if (cities + pl.pieces.city !== PIECES.city) bad.push(`player ${p} cities ${cities}+${pl.pieces.city}`);
  });

  // Development cards are conserved.
  for (const k of DEV_PLAY) {
    let count = s.deck[k];
    for (const pl of s.players) {
      count += pl.dev[k] + pl.fresh[k];
      count += k === 'knight' ? pl.knights : pl.played[k];
    }
    if (count !== DEV_COUNTS[k]) bad.push(`dev ${k} count ${count} != ${DEV_COUNTS[k]}`);
  }
  const vpCards = s.deck.vp + s.players.reduce((a, pl) => a + pl.vpCards, 0);
  if (vpCards !== DEV_COUNTS.vp) bad.push(`vp cards ${vpCards} != ${DEV_COUNTS.vp}`);

  // Distance rule, and every settlement/city touches its owner's road.
  s.verts.forEach((b, v) => {
    if (!b) return;
    if (g.verts[v]!.adj.some((u) => s.verts[u])) bad.push(`distance rule broken at vertex ${v}`);
    // Base game: a building always touches its owner's road. (Expansions where other pieces
    // can support a settlement, such as ships that may later sail away, check their own rules.)
    if (
      !mods(s).some((m) => m.settleSupport || m.looseBuildings) &&
      !g.verts[v]!.edges.some((e) => s.edges[e] === b[0])
    ) {
      bad.push(`building at ${v} has no road`);
    }
  });

  // Every road is connected to its owner's network, which starts at their buildings.
  for (let p = 0; p < n; p++) {
    const seen = new Set<number>();
    const stack: number[] = [];
    s.verts.forEach((b, v) => {
      if (b && b[0] === p) stack.push(v);
    });
    const visited = new Set<number>(stack);
    while (stack.length) {
      const v = stack.pop()!;
      for (const e of g.verts[v]!.edges) {
        if (s.edges[e] !== p || seen.has(e)) continue;
        seen.add(e);
        const E = g.edges[e]!;
        const w = E.a === v ? E.b : E.a;
        if (!visited.has(w)) {
          visited.add(w);
          stack.push(w);
        }
      }
    }
    const roads = s.edges.flatMap((x, e) => (x === p ? [e] : []));
    for (const e of roads) if (!seen.has(e)) bad.push(`player ${p} road ${e} is disconnected`);
  }

  // Longest road.
  const lens = prev && samePieces(prev, s) ? prev.roadLens : s.players.map((_, p) => routeLen(s, p));
  if (lens.some((l, p) => l !== s.roadLens[p])) bad.push(`roadLens ${s.roadLens} != ${lens}`);
  const max = Math.max(...lens);
  const atMax = lens.filter((l) => l === max).length;
  if (s.longest != null) {
    if (lens[s.longest]! < 5 || lens[s.longest] !== max)
      bad.push(`longest road holder ${s.longest} has ${lens[s.longest]}, max ${max}`);
  } else if (max >= 5 && atMax === 1) {
    bad.push(`nobody holds longest road but one player has ${max}`);
  }

  // Largest army.
  const knights = s.players.map((pl) => pl.knights);
  if (s.largest != null) {
    const k = knights[s.largest]!;
    if (k < 3 || knights.some((x) => x > k))
      bad.push(`largest army holder ${s.largest} has ${k} knights (${knights})`);
  } else if (knights.some((k) => k >= 3)) {
    bad.push(`nobody holds largest army but knights are ${knights}`);
  }

  // Win condition.
  if ((s.phase === 'over') !== (s.winner != null)) bad.push(`phase ${s.phase} but winner ${s.winner}`);
  if (s.phase === 'over' && totalVP(s, s.winner!) < s.config.winVP)
    bad.push(`winner has only ${totalVP(s, s.winner!)} VP`);
  if (s.phase === 'play' && s.stage !== 'setup' && totalVP(s, s.turn) >= s.config.winVP) {
    bad.push(`player ${s.turn} has ${totalVP(s, s.turn)} VP on their turn but the game is not over`);
  }

  // Stage bookkeeping.
  if ((s.stage === 'discard') !== (s.discard != null))
    bad.push(`stage ${s.stage} with discard ${JSON.stringify(s.discard)}`);
  // Free pieces are pending only in the roads stage (or while gold is chosen in the middle of it).
  if (s.stage === 'roads' ? !(s.freeRoads > 0) : s.freeRoads > 0 && s.stage !== 'gold') {
    bad.push(`stage ${s.stage} with ${s.freeRoads} free roads`);
  }
  if ((s.stage === 'robber' || s.stage === 'discard') !== (s.robberReturn != null)) {
    bad.push(`stage ${s.stage} with robberReturn ${s.robberReturn}`);
  }
  if (s.board.robber !== -1 && !robberHexOK(s, s.board.robber))
    bad.push(`robber on an illegal hex ${s.board.robber}`);
  if (!(s.turn >= 0 && s.turn < n)) bad.push(`turn ${s.turn} out of range`);

  // Handing the dice back.
  if (s.back) {
    const b = s.back;
    if (!s.config.houseRules?.handBack) bad.push('hand-back pending without the rule');
    if (!(b.from >= 0 && b.from < n)) bad.push(`hand-back from ${b.from}`);
    if (b.asked && b.refused) bad.push('hand-back both asked and refused');
    if (!b.state || b.state.back) bad.push('hand-back without exactly one earlier turn');
    if (s.phase !== 'play') bad.push('hand-back pending after the game ended');
  }

  // Undo.
  if (s.undo) {
    const u = s.undo;
    if (!s.config.houseRules?.undo) bad.push('undo pending without the rule');
    if (!(u.p >= 0 && u.p < n)) bad.push(`undo for ${u.p}`);
    if (!u.state || u.state.undo) bad.push('undo without exactly one earlier state');
    if (!u.asked && u.ok.length) bad.push('undo approved before it was asked');
    if (u.ok.includes(u.p)) bad.push('undo approved by its own player');
    if (s.phase !== 'play') bad.push('undo pending after the game ended');
  }

  for (const m of mods(s)) bad.push(...(m.invariants?.(s) ?? []));
  return bad;
}

/** Rules about how one state may follow another. */
export function checkTransition(prev: GameState, next: GameState): string[] {
  const bad: string[] = [];
  // The longest road holder keeps it while still tied for longest.
  if (prev.longest != null && next.phase === 'play') {
    const lens = next.roadLens;
    if (
      lens[prev.longest]! >= 5 &&
      lens[prev.longest] === Math.max(...lens) &&
      next.longest !== prev.longest
    ) {
      bad.push(`longest road moved from ${prev.longest} to ${next.longest} on a tie`);
    }
  }
  // Largest army only changes hands when beaten outright.
  if (prev.largest != null && next.largest !== prev.largest) {
    const k = next.players.map((pl) => pl.knights);
    if (next.largest == null || k[next.largest]! <= k[prev.largest]!) {
      bad.push(`largest army moved from ${prev.largest} to ${next.largest} without being beaten`);
    }
  }
  if (next.seq !== prev.seq + 1) bad.push(`seq ${prev.seq} -> ${next.seq}`);
  for (const m of mods(next)) bad.push(...(m.transition?.(prev, next) ?? []));
  return bad;
}
