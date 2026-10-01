/*
 * Seafarers, as specified in docs/rules/seafarers.md. Everything here plugs into the base
 * rules through the hooks in api.ts.
 */

import { startHexes } from '../map';
import {
  checkWin, afterFreePiece, cleanCounts, finishRobber, gain, isInt, pay, stealRandom, updateLongest,
} from '../ops'; // prettier-ignore
import { blockedAt, geo, has, legalSetupVerts, total } from '../queries';
import {
  RES, isLand, isResource, type GameEvent, type GameState, type PartialRes, type Seat, type Stage, type Terrain,
} from '../types'; // prettier-ignore
import type { Ctx, RuleModule } from './api';

export const SHIP_COST = { wood: 1, sheep: 1 };
export const SHIPS = 15;

const sea = (s: GameState) => s.sea!;
const produces = (t: Terrain) => isResource(t) || t === 'gold';

/* ---------- Edges and pieces ---------- */

/** Terrain on each side of an edge; the outside of the map counts as sea. */
export function edgeSides(s: GameState, e: number): Terrain[] {
  const hs = geo(s).edges[e]!.hexes.map((h) => s.board.hexes[h]!.t);
  return hs.length === 1 ? [...hs, 'sea'] : hs;
}

function known(s: GameState, e: number): Terrain[] | null {
  const sides = edgeSides(s, e);
  const k = sides.filter((t) => t !== 'fog');
  return k.length ? k : null; // fog on both sides: nothing can be built
}

/** Per-board cache of which edges can take a road or a ship (kinds only change when fog lifts). */
const kindCache = new WeakMap<object, { road: Uint8Array; ship: Uint8Array }>();
function kinds(s: GameState) {
  let k = kindCache.get(s.board.hexes);
  if (!k) {
    const n = s.edges.length;
    k = { road: new Uint8Array(n), ship: new Uint8Array(n) };
    for (let e = 0; e < n; e++) {
      const kn = known(s, e);
      k.road[e] = kn?.some(isLand) ? 1 : 0;
      k.ship[e] = kn?.includes('sea') ? 1 : 0;
    }
    kindCache.set(s.board.hexes, k);
  }
  return k;
}

/** The edge's kind allows a road: a known land side (land, coast, or land next to fog). */
export const roadKindOK = (s: GameState, e: number) => kinds(s).road[e] === 1;
/** The edge's kind allows a ship: a known sea side (sea, coast, or sea next to fog). */
export const shipKindOK = (s: GameState, e: number) => kinds(s).ship[e] === 1;

export const onPirateHex = (s: GameState, e: number) =>
  (s.board.pirate ?? -1) >= 0 && geo(s).edges[e]!.hexes.includes(s.board.pirate!);

function edgeFree(s: GameState, e: number) {
  return s.edges[e] == null && sea(s).ships[e] == null;
}

/** Can p build a ship on e? (Ignores cost and supply.) */
export function shipOK(s: GameState, p: Seat, e: number): boolean {
  const g = geo(s);
  if (!isInt(e) || e < 0 || e >= g.edges.length) return false;
  if (!edgeFree(s, e) || !shipKindOK(s, e) || onPirateHex(s, e)) return false;
  const E = g.edges[e]!;
  for (const v of [E.a, E.b]) {
    const b = s.verts[v];
    if (b && b[0] === p) return true;
    if (b && b[0] !== p) continue; // an opponent's building blocks the connection
    if (blockedAt(s, p, v)) continue; // ...and so can other pieces (knights)
    if (g.verts[v]!.edges.some((f) => f !== e && sea(s).ships[f] === p)) return true;
  }
  return false;
}

export function legalShips(s: GameState, p: Seat): number[] {
  const out: number[] = [];
  for (let e = 0; e < s.edges.length; e++) if (shipOK(s, p, e)) out.push(e);
  return out;
}

/** A ship at an open end of its route: one end touches neither p's building nor another p ship. */
export function isOpenEnd(s: GameState, p: Seat, e: number): boolean {
  const g = geo(s);
  const E = g.edges[e]!;
  return [E.a, E.b].some((v) => {
    const b = s.verts[v];
    if (b && b[0] === p) return false;
    return !g.verts[v]!.edges.some((f) => f !== e && sea(s).ships[f] === p);
  });
}

export function shipMovesLeft(s: GameState): boolean {
  return !!s.config.houseRules?.freeShipMoves || sea(s).movesThisTurn < 1;
}

/** Ships p may move right now (ignoring stage and turn). */
export function movableShips(s: GameState, p: Seat): number[] {
  const out: number[] = [];
  sea(s).ships.forEach((o, e) => {
    if (o === p && !sea(s).builtThisTurn.includes(e) && !onPirateHex(s, e) && isOpenEnd(s, p, e)) out.push(e);
  });
  return out;
}

/** Where ship `from` could move to. */
export function shipDestinations(s: GameState, p: Seat, from: number): number[] {
  const t: GameState = { ...s, sea: { ...sea(s), ships: sea(s).ships.slice() } };
  t.sea!.ships[from] = null;
  return legalShips(t, p).filter((e) => e !== from);
}

/* ---------- Islands ---------- */

/** The hexes of the island containing land hex h (land connected through shared edges). */
export function islandOf(s: GameState, h: number): number[] {
  const g = geo(s);
  const seen = new Set([h]);
  const stack = [h];
  while (stack.length) {
    const x = stack.pop()!;
    for (const y of g.hexNeighbors[x]!) {
      if (!seen.has(y) && isLand(s.board.hexes[y]!.t)) {
        seen.add(y);
        stack.push(y);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function islandAtVertex(s: GameState, v: number): number[] | null {
  const h = geo(s).verts[v]!.hexes.find((x) => isLand(s.board.hexes[x]!.t));
  return h == null ? null : islandOf(s, h);
}

const overlaps = (a: number[], b: number[]) => a.some((x) => b.includes(x));

/* ---------- Route length: roads and ships, switching only at your own buildings ---------- */

export function tradeRouteLen(s: GameState, p: Seat): number {
  const g = geo(s);
  const ships = sea(s).ships;
  const kindAt = (e: number) => (s.edges[e] === p ? 'road' : ships[e] === p ? 'ship' : null);
  let best = 0;
  const used = new Set<number>();
  const dfs = (v: number, len: number, last: 'road' | 'ship' | null) => {
    if (len > best) best = len;
    const b = s.verts[v];
    if (len > 0 && ((b && b[0] !== p) || blockedAt(s, p, v))) return;
    const mine = !!b && b[0] === p;
    for (const e of g.verts[v]!.edges) {
      const k = kindAt(e);
      if (!k || used.has(e)) continue;
      if (last && k !== last && !mine) continue; // roads and ships only join at your own building
      used.add(e);
      const E = g.edges[e]!;
      dfs(E.a === v ? E.b : E.a, len + 1, k);
      used.delete(e);
    }
  };
  for (let v = 0; v < g.verts.length; v++) {
    if (g.verts[v]!.edges.some((e) => kindAt(e))) dfs(v, 0, null);
  }
  return best;
}

/* ---------- Gold and fog ---------- */

/** Resources left in the bank (gold only ever pays resources). */
const bankTotal = (s: GameState) => RES.reduce((a, r) => a + s.bank[r], 0);

/** Begin (or extend) the gold-choosing step. */
function owe(s: GameState, owed: Record<number, number>, events: GameEvent[]) {
  const add = Object.entries(owed).filter(([, n]) => n > 0);
  if (!add.length || bankTotal(s) === 0) return;
  const st = sea(s);
  if (!st.gold) st.gold = { owed: {}, back: s.stage as Stage };
  for (const [p, n] of add) st.gold.owed[Number(p)] = (st.gold.owed[Number(p)] ?? 0) + n;
  s.stage = 'gold';
  events.push({ k: 'goldOwed', owed: Object.fromEntries(add.map(([p, n]) => [Number(p), n])) });
}

/** How many gold resources p must choose now (capped by what the bank holds). */
export function goldDue(s: GameState, p: Seat): number {
  if (s.stage !== 'gold') return 0;
  const n = s.sea?.gold?.owed[p] ?? 0;
  return Math.min(n, bankTotal(s));
}

/** Reveal fog next to edge e, rewarding p. */
function discover(x: Ctx, e: number) {
  const { s, p, events } = x;
  const st = sea(s);
  for (const h of geo(s).edges[e]!.hexes) {
    if (s.board.hexes[h]!.t !== 'fog') continue;
    const t = st.fog.terrain.shift() ?? 'sea';
    const n = produces(t) ? (st.fog.numbers.shift() ?? 0) : 0;
    // A new array, so caches keyed on the hex list (edge kinds) see the change.
    s.board.hexes = s.board.hexes.map((x, i) => (i === h ? { ...x, t, n } : x));
    let got: PartialRes | null = null;
    if (isResource(t) && s.bank[t] > 0) {
      gain(s, p, t, 1);
      got = { [t]: 1 };
    }
    events.push({ k: 'discover', p, h, t, n, got });
    if (t === 'gold') owe(s, { [p]: 1 }, events);
  }
}

/* ---------- The module ---------- */

export const seafarers: RuleModule = {
  id: 'seafarers',

  init(s, fog) {
    s.sea = {
      ships: new Array(s.edges.length).fill(null),
      builtThisTurn: [],
      movesThisTurn: 0,
      home: s.players.map(() => []),
      bonus: s.players.map(() => []),
      specialVP: s.players.map(() => 0),
      gold: null,
      fog: { terrain: fog.terrain.slice(), numbers: fog.numbers.slice() },
    };
    for (const pl of s.players) pl.pieces.ship = SHIPS;
  },

  roadEdgeOK: (s, e) => sea(s).ships[e] == null && roadKindOK(s, e),
  vertexOK: (s, v) => geo(s).verts[v]!.hexes.some((h) => isLand(s.board.hexes[h]!.t)),
  settleSupport: (s, p, v) => geo(s).verts[v]!.edges.some((e) => sea(s).ships[e] === p),
  setupVertexOK(s, v) {
    const start = startHexes(s.config.map, s.board);
    return geo(s).verts[v]!.hexes.some((h) => start.has(h) && isLand(s.board.hexes[h]!.t));
  },
  robberHexOK: (s, h) => isLand(s.board.hexes[h]!.t),

  extraVP: (s, p) => sea(s).specialVP[p] ?? 0,
  vpParts: (s, p) => [{ k: 'island', n: sea(s).bonus[p]?.length ?? 0, vp: sea(s).specialVP[p] ?? 0 }],
  piecesLeft: (s, p) => ({ ship: s.players[p]!.pieces.ship ?? 0 }),
  routeLen: tradeRouteLen,
  freePieceSupply: (s, p) => s.players[p]!.pieces.ship ?? 0,
  canPlaceFreePiece: (s, p) => (s.players[p]!.pieces.ship ?? 0) > 0 && legalShips(s, p).length > 0,

  afterProduce(x, roll) {
    const { s } = x;
    const g = geo(s);
    const owed: Record<number, number> = {};
    s.board.hexes.forEach((h, hi) => {
      if (h.t !== 'gold' || h.n !== roll || hi === s.board.robber) return;
      for (const v of g.hexVerts[hi]!) {
        const b = s.verts[v];
        if (b) owed[b[0]] = (owed[b[0]] ?? 0) + b[1];
      }
    });
    owe(s, owed, x.events);
  },

  afterSetupSettlement(x, v, second, e, ship) {
    const { s, p } = x;
    if (ship) discover(x, e);
    const isl = islandAtVertex(s, v);
    if (isl && !sea(s).home[p]!.some((h) => overlaps(h, isl))) sea(s).home[p]!.push(isl);
    if (second) {
      const golds = geo(s).verts[v]!.hexes.filter((h) => s.board.hexes[h]!.t === 'gold').length;
      if (golds) owe(s, { [p]: golds }, x.events);
    }
  },

  afterSettlement(x, v) {
    const { s, p } = x;
    const bonus = s.config.map?.specialVP?.newIsland ?? 0;
    const isl = islandAtVertex(s, v);
    if (!bonus || !isl) return;
    const st = sea(s);
    if (st.home[p]!.some((h) => overlaps(h, isl)) || st.bonus[p]!.some((h) => overlaps(h, isl))) return;
    st.bonus[p]!.push(isl);
    st.specialVP[p]! += bonus;
    x.events.push({ k: 'islandBonus', p, vp: bonus });
  },

  afterRoad: (x, e) => discover(x, e),

  placeSetupPiece(x, v, e) {
    const { s, p } = x;
    if (!edgeFree(s, e) || !shipKindOK(s, e) || onPirateHex(s, e))
      return 'Ships go on the water next to your settlement';
    sea(s).ships[e] = p;
    x.me.pieces.ship!--;
    void v;
    return null;
  },

  ruleChangeBlock: (s, rule, value) =>
    rule === 'freeShipMoves' && !value && sea(s).movesThisTurn > 1
      ? 'You’ve already moved more than one ship this turn'
      : null,

  onTurnEnd(s) {
    sea(s).builtThisTurn = [];
    sea(s).movesThisTurn = 0;
  },

  waitingOn: (s) => (s.stage === 'gold' ? Object.keys(sea(s).gold?.owed ?? {}).map(Number) : undefined),

  reduce(x, a) {
    const { s, p, me, myTurn, events } = x;
    const st = sea(s);
    switch (a.type) {
      case 'ship': {
        if (!myTurn) return 'Wait for your turn';
        if (s.stage !== 'main')
          return s.stage === 'preroll' ? 'Roll the dice first' : 'Finish what you’re doing first';
        if (!has(me.res, SHIP_COST)) return 'A ship costs 1 wood and 1 sheep';
        if ((me.pieces.ship ?? 0) <= 0) return 'You have no ships left';
        if (!shipOK(s, p, a.e)) return 'Ships must connect to your own ships or a building on the coast';
        pay(s, p, SHIP_COST);
        st.ships[a.e] = p;
        me.pieces.ship!--;
        st.builtThisTurn.push(a.e);
        events.push({ k: 'build', p, what: 'ship', at: a.e });
        updateLongest(s, events);
        discover(x, a.e);
        checkWin(s, events);
        return null;
      }
      case 'freeShip': {
        if (!myTurn || s.stage !== 'roads') return 'You have no free pieces to place';
        if ((me.pieces.ship ?? 0) <= 0) return 'You have no ships left';
        if (!shipOK(s, p, a.e)) return 'Ships must connect to your own ships or a building on the coast';
        st.ships[a.e] = p;
        me.pieces.ship!--;
        st.builtThisTurn.push(a.e);
        events.push({ k: 'build', p, what: 'ship', at: a.e, free: true });
        updateLongest(s, events);
        afterFreePiece(x);
        discover(x, a.e);
        checkWin(s, events);
        return null;
      }
      case 'moveShip': {
        if (!myTurn) return 'Wait for your turn';
        if (s.stage !== 'main')
          return s.stage === 'preroll' ? 'Roll the dice first' : 'Finish what you’re doing first';
        if (!shipMovesLeft(s)) return 'You can move one ship per turn';
        const { from, to } = a;
        if (!isInt(from) || st.ships[from] !== p) return 'That isn’t your ship';
        if (st.builtThisTurn.includes(from)) return 'Ships built this turn can’t move yet';
        if (onPirateHex(s, from)) return 'The pirate is blocking that ship';
        if (!isOpenEnd(s, p, from)) return 'Only a ship at the open end of a route can move';
        st.ships[from] = null;
        if (to === from || !shipOK(s, p, to)) return 'The ship can’t go there';
        st.ships[to] = p;
        st.movesThisTurn++;
        events.push({ k: 'moveShip', p, from, to });
        updateLongest(s, events);
        discover(x, to);
        checkWin(s, events);
        return null;
      }
      case 'pirate': {
        if (!myTurn || s.stage !== 'robber') return 'You can’t move the pirate now';
        const h = a.hex;
        if (!isInt(h) || h < 0 || h >= s.board.hexes.length || s.board.hexes[h]!.t !== 'sea')
          return 'The pirate sails on the sea';
        if (h === s.board.pirate) return 'Move the pirate to a different spot';
        const victims = pirateVictims(s, p, h);
        let victim: Seat | null = null;
        if (victims.length) {
          victim = victims.length === 1 && a.victim == null ? victims[0]! : (a.victim ?? -1);
          if (!victims.includes(victim)) return 'Choose who to steal from';
        }
        s.board.pirate = h;
        events.push({ k: 'pirate', p, h, victim });
        if (victim != null) events.push({ k: 'steal', p, from: victim, r: stealRandom(s, victim, p) });
        finishRobber(s);
        return null;
      }
      case 'chooseGold': {
        const due = goldDue(s, p);
        if (s.stage !== 'gold' || st.gold?.owed[p] == null) return 'You have no gold to choose';
        const c = cleanCounts(a.cards);
        if (!c) return 'Pick resources';
        if (total(c) !== due) return `Choose exactly ${due}`;
        if (!has(s.bank, c)) return 'The bank doesn’t have those';
        for (const r of RES) if (c[r]) gain(s, p, r, c[r]);
        delete st.gold.owed[p];
        events.push({ k: 'gold', p, got: Object.fromEntries(RES.filter((r) => c[r]).map((r) => [r, c[r]])) });
        // Anyone still owed gold when the bank is empty gets nothing.
        if (bankTotal(s) === 0) st.gold.owed = {};
        if (!Object.keys(st.gold.owed).length) {
          s.stage = st.gold.back;
          st.gold = null;
        }
        return null;
      }
      default:
        return undefined;
    }
  },

  legal(s, p, out) {
    const me = s.players[p]!;
    if (s.turn !== p) return;
    if (s.stage === 'setup') {
      const g = geo(s);
      for (const v of legalSetupVerts(s)) {
        for (const e of g.verts[v]!.edges) {
          if (edgeFree(s, e) && shipKindOK(s, e) && !onPirateHex(s, e))
            out.push({ type: 'setup', v, e, ship: true });
        }
      }
    }
    if (s.stage === 'robber') {
      s.board.hexes.forEach((h, i) => {
        if (h.t !== 'sea' || i === s.board.pirate) return;
        const victims = pirateVictims(s, p, i);
        if (!victims.length) out.push({ type: 'pirate', hex: i });
        for (const victim of victims) out.push({ type: 'pirate', hex: i, victim });
      });
    }
    if (s.stage === 'roads' && (me.pieces.ship ?? 0) > 0) {
      for (const e of legalShips(s, p)) out.push({ type: 'freeShip', e });
    }
    if (s.stage === 'main') {
      if (has(me.res, SHIP_COST) && (me.pieces.ship ?? 0) > 0)
        for (const e of legalShips(s, p)) out.push({ type: 'ship', e });
      if (shipMovesLeft(s)) {
        for (const from of movableShips(s, p))
          for (const to of shipDestinations(s, p, from)) out.push({ type: 'moveShip', from, to });
      }
    }
  },

  invariants(s) {
    const bad: string[] = [];
    const st = s.sea;
    if (!st) return ['seafarers state missing'];
    const g = geo(s);
    s.players.forEach((pl, p) => {
      const n = st.ships.filter((x) => x === p).length;
      if (n + (pl.pieces.ship ?? -99) !== SHIPS) bad.push(`player ${p} ships ${n}+${pl.pieces.ship}`);
    });
    st.ships.forEach((o, e) => {
      if (o == null) return;
      if (s.edges[e] != null) bad.push(`edge ${e} has a road and a ship`);
      if (!shipKindOK(s, e)) bad.push(`ship on non-water edge ${e}`);
    });
    s.edges.forEach((o, e) => {
      if (o != null && !roadKindOK(s, e)) bad.push(`road on water edge ${e}`);
    });
    if (s.board.hexes.some((h) => h.t === 'fog')) {
      for (let e = 0; e < s.edges.length; e++) {
        if ((s.edges[e] != null || st.ships[e] != null) && edgeSides(s, e).includes('fog')) {
          bad.push(`piece next to fog at ${e}`);
        }
      }
    }
    s.verts.forEach((b, v) => {
      if (b && !g.verts[v]!.hexes.some((h) => isLand(s.board.hexes[h]!.t)))
        bad.push(`building at sea vertex ${v}`);
    });
    // Every ship chains (through its owner's ships) to one of its owner's buildings.
    s.players.forEach((_, p) => {
      const seen = new Set<number>();
      const stack: number[] = [];
      s.verts.forEach((b, v) => b && b[0] === p && stack.push(v));
      const visited = new Set(stack);
      while (stack.length) {
        const v = stack.pop()!;
        for (const e of g.verts[v]!.edges) {
          if (st.ships[e] !== p || seen.has(e)) continue;
          seen.add(e);
          const E = g.edges[e]!;
          const w = E.a === v ? E.b : E.a;
          if (!visited.has(w)) {
            visited.add(w);
            stack.push(w);
          }
        }
      }
      st.ships.forEach((o, e) => o === p && !seen.has(e) && bad.push(`player ${p} ship ${e} is stranded`));
    });
    const rob = s.board.robber;
    if (rob !== -1 && !(rob >= 0 && isLand(s.board.hexes[rob]!.t)))
      bad.push(`robber on ${s.board.hexes[rob]?.t}`);
    const pir = s.board.pirate ?? -1;
    if (pir !== -1 && s.board.hexes[pir]?.t !== 'sea') bad.push(`pirate on ${s.board.hexes[pir]?.t}`);
    const bonus = s.config.map?.specialVP?.newIsland ?? 0;
    s.players.forEach((_, p) => {
      if (st.specialVP[p] !== st.bonus[p]!.length * bonus)
        bad.push(`player ${p} special VP ${st.specialVP[p]}`);
      for (const b of st.bonus[p]!) {
        if (st.home[p]!.some((h) => overlaps(h, b))) bad.push(`player ${p} has a bonus for a home island`);
        const settled = s.verts.some(
          (x, v) => x && x[0] === p && geo(s).verts[v]!.hexes.some((h) => b.includes(h)),
        );
        if (!settled) bad.push(`player ${p} has a bonus for an island they haven't settled`);
      }
    });
    const fogLeft = s.board.hexes.filter((h) => h.t === 'fog').length;
    if (st.fog.terrain.length < fogLeft)
      bad.push(`fog stack ${st.fog.terrain.length} < ${fogLeft} fog hexes`);
    // Gold may wait while another module's choices (Cities & Knights) are made first.
    const goldWaits = s.stage === 'gold' || (s.stage === 'ck' && s.ck?.back === 'gold');
    if (goldWaits !== (st.gold != null)) bad.push(`stage ${s.stage} with gold ${JSON.stringify(st.gold)}`);
    if (st.gold && Object.values(st.gold.owed).some((n) => !(n > 0))) bad.push('gold owed must be positive');
    if (st.gold && !Object.keys(st.gold.owed).length) bad.push('gold stage with nobody owed');
    for (const e of st.builtThisTurn)
      if (st.ships[e] !== s.turn) bad.push(`built-this-turn ship ${e} missing`);
    if (!s.config.houseRules?.freeShipMoves && st.movesThisTurn > 1)
      bad.push(`${st.movesThisTurn} ship moves this turn`);
    return bad;
  },

  transition(prev, next) {
    const bad: string[] = [];
    const pir = next.board.pirate ?? -1;
    if (pir >= 0 && prev.board.pirate === pir) {
      geo(next).edges.forEach((E, e) => {
        if (E.hexes.includes(pir) && prev.sea!.ships[e] !== next.sea!.ships[e])
          bad.push(`ship changed on pirate edge ${e}`);
      });
    }
    // (When the turn changes, the count starts again, or comes back with a handed-back turn.)
    const moved = prev.turn === next.turn ? next.sea!.movesThisTurn - prev.sea!.movesThisTurn : 0;
    if (moved > 1) bad.push(`${moved} ship moves in one action`);
    return bad;
  },

  view(s, _seat, v) {
    const st = sea(s);
    v.sea = {
      ships: st.ships.slice(),
      builtThisTurn: st.builtThisTurn.slice(),
      movesThisTurn: st.movesThisTurn,
      specialVP: st.specialVP.slice(),
      home: JSON.parse(JSON.stringify(st.home)),
      bonus: JSON.parse(JSON.stringify(st.bonus)),
      gold: st.gold ? { owed: { ...st.gold.owed }, back: st.gold.back } : null,
      fogLeft: st.fog.terrain.length,
    };
  },

  fromView(v, s) {
    const sv = v.sea!;
    s.sea = {
      ships: sv.ships.slice(),
      builtThisTurn: sv.builtThisTurn.slice(),
      movesThisTurn: sv.movesThisTurn,
      home: JSON.parse(JSON.stringify(sv.home)),
      bonus: JSON.parse(JSON.stringify(sv.bonus)),
      specialVP: sv.specialVP.slice(),
      gold: sv.gold ? { owed: { ...sv.gold.owed }, back: sv.gold.back } : null,
      // The real stack is secret; placeholders only matter for counting.
      fog: { terrain: new Array(sv.fogLeft).fill('sea'), numbers: [] },
    };
  },
};

export function pirateVictims(s: GameState, p: Seat, hex: number): Seat[] {
  const set = new Set<Seat>();
  geo(s).edges.forEach((E, e) => {
    const o = sea(s).ships[e];
    if (o != null && o !== p && E.hexes.includes(hex) && total(s.players[o]!.res) > 0) set.add(o);
  });
  return [...set].sort((a, b) => a - b);
}
