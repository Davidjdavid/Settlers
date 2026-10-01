/*
 * Rules that must hold in every reachable state. The simulator checks them after every
 * action, and the server checks them when it loads a saved game. Returns a list of
 * problems (empty means OK).
 */

import { mods } from './modules/api';
import { BANK_EACH, DEV_COUNTS, PIECES, geo, robberHexOK, routeLen, totalVP } from './queries';
import { DEV_PLAY, RES, type GameState } from './types';

export function checkInvariants(s: GameState): string[] {
  const bad: string[] = [];
  const g = geo(s);
  const n = s.players.length;

  // Resources are conserved and never negative.
  for (const r of RES) {
    const held = s.players.reduce((a, pl) => a + pl.res[r], 0);
    if (held + s.bank[r] !== BANK_EACH) bad.push(`${r}: bank ${s.bank[r]} + hands ${held} != ${BANK_EACH}`);
    if (s.bank[r] < 0) bad.push(`bank ${r} negative`);
    s.players.forEach((pl, p) => {
      if (pl.res[r] < 0) bad.push(`player ${p} ${r} negative`);
    });
  }

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
    if (!mods(s).some((m) => m.settleSupport) && !g.verts[v]!.edges.some((e) => s.edges[e] === b[0])) {
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
  const lens = s.players.map((_, p) => routeLen(s, p));
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
