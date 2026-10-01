/*
 * Cities & Knights progress cards (docs/rules/cities-and-knights.md §14). Each card checks
 * everything first and only then changes the state; a card that would do nothing can't be played.
 */

import { gain, isInt, pay, stealRandom, transfer, updateLongest } from '../ops';
import {
  canPlaceFreePiece, freePieceSupply, geo, has, robberAwake, robberHexOK, total, totalVP,
} from '../queries'; // prettier-ignore
import {
  COMS, RES, TRACKS, isCommodity, isLand, isResource, trackOf, type Action, type Card, type GameState, type Knight,
  type Owe, type Progress, type Resource, type Seat,
} from '../types'; // prettier-ignore
import type { Ctx } from './api';
import {
  WALLS, canPromote, ck, cityVerts, deserterFollowUp, displace, isOpenRoad, owe, wallsOf,
} from './citiesKnights'; // prettier-ignore

type Play = Extract<Action, { type: 'progress' }>;

export const MEDICINE_COST = { ore: 2, wheat: 1 };
/** Number tokens Inventor can't move. */
const FIXED_NUMBERS = [2, 12, 6, 8];

const opponents = (s: GameState, p: Seat): Seat[] => s.players.map((_, i) => i).filter((i) => i !== p);
const hasCommodity = (s: GameState, p: Seat) => COMS.some((k) => (s.players[p]!.res[k] ?? 0) > 0);
const knightAt = (s: GameState, v: number): Knight | null => (isInt(v) ? (ck(s).knights[v] ?? null) : null);

/** Hexes of terrain t next to at least one of p's buildings. */
function myHexes(s: GameState, p: Seat, t: Resource): number[] {
  const g = geo(s);
  return s.board.hexes.flatMap((h, i) =>
    h.t === t && g.hexVerts[i]!.some((v) => s.verts[v]?.[0] === p) ? [i] : [],
  );
}

/** Hexes Inventor may swap: numbered, and not 2, 12, 6 or 8. */
const inventorHex = (s: GameState, h: unknown): h is number =>
  isInt(h) &&
  h >= 0 &&
  h < s.board.hexes.length &&
  s.board.hexes[h]!.n > 0 &&
  !FIXED_NUMBERS.includes(s.board.hexes[h]!.n);

/** Land hexes next to one of p's buildings where p may put the merchant. */
function merchantHexes(s: GameState, p: Seat): number[] {
  const g = geo(s);
  const m = ck(s).merchant;
  return s.board.hexes.flatMap((h, i) =>
    isLand(h.t) && g.hexVerts[i]!.some((v) => s.verts[v]?.[0] === p) && !(m && m.h === i && m.p === p)
      ? [i]
      : [],
  );
}

const alchemyOK = (s: GameState, d: unknown): d is [number, number] =>
  Array.isArray(d) &&
  d.length === 2 &&
  d.every((x) => isInt(x) && x >= 1 && x <= 6) &&
  !(d[0] + d[1] === 7 && s.config.houseRules?.rerollBeforeAttack && ck(s).attacks === 0);

/** Opponents whose knight sits on a corner touching one of p's roads. */
const intrigueTargets = (s: GameState, p: Seat): number[] =>
  ck(s).knights.flatMap((k, v) =>
    k && k.p !== p && geo(s).verts[v]!.edges.some((e) => s.edges[e] === p) ? [v] : [],
  );

/** Saboteur: opponents with at least your points and 2+ cards. */
const saboteurTargets = (s: GameState, p: Seat) =>
  opponents(s, p).filter((o) => totalVP(s, o) >= totalVP(s, p) && total(s.players[o]!.res) >= 2);

/** Wedding and Master Merchant: opponents with more points than you and some cards. */
const richer = (s: GameState, p: Seat) =>
  opponents(s, p).filter((o) => totalVP(s, o) > totalVP(s, p) && total(s.players[o]!.res) > 0);

/** Smith: can these knights be promoted one after the other? */
function smithOK(s: GameState, p: Seat, vs: unknown): boolean {
  if (!Array.isArray(vs) || vs.length < 1 || vs.length > 2 || new Set(vs).size !== vs.length) return false;
  const c = ck(s);
  const t: GameState = { ...s, ck: { ...c, knights: c.knights.map((k) => k && { ...k }) } };
  for (const v of vs) {
    if (!isInt(v) || !canPromote(t, p, v)) return false;
    const k = t.ck!.knights[v]!;
    k.lvl = (k.lvl + 1) as 2 | 3;
    k.up = true;
  }
  return true;
}

/** Run a card. Returns an error, or null after applying its effect. */
function run(x: Ctx, a: Play): string | null {
  const { s, p, me, events } = x;
  const c = ck(s);
  switch (a.card) {
    /* ---------- Science ---------- */
    case 'alchemist':
      if (!alchemyOK(s, a.d)) return 'Choose both dice (1 to 6)';
      c.alchemy = [a.d[0], a.d[1]];
      return null;
    case 'crane':
      if (!cityVerts(s, p).length || TRACKS.every((t) => c.lvl[p]![t] >= 5))
        return 'You have nothing to improve';
      c.crane++;
      return null;
    case 'engineer': {
      const b = isInt(a.v) ? s.verts[a.v] : null;
      if (!b || b[0] !== p || b[1] !== 2 || c.walls.includes(a.v!))
        return 'Pick one of your cities without a wall';
      if (wallsOf(s, p) >= WALLS) return 'You have no walls left';
      c.walls.push(a.v!);
      events.push({ k: 'wall', p, v: a.v!, free: true });
      return null;
    }
    case 'inventor': {
      if (!inventorHex(s, a.h) || !inventorHex(s, a.h2) || a.h === a.h2)
        return 'Pick two tiles (not 2, 12, 6 or 8)';
      const h1 = s.board.hexes[a.h]!;
      const h2 = s.board.hexes[a.h2]!;
      [h1.n, h2.n] = [h2.n, h1.n];
      events.push({ k: 'inventor', p, h: a.h, h2: a.h2 });
      return null;
    }
    case 'irrigation':
    case 'mining': {
      const t = a.card === 'irrigation' ? 'wheat' : 'ore';
      const n = Math.min(2 * myHexes(s, p, t).length, s.bank[t]);
      if (!myHexes(s, p, t).length)
        return `You have no ${a.card === 'irrigation' ? 'fields' : 'mountains'} next to you`;
      gain(s, p, t, n);
      events.push({ k: 'gain', p, cards: { [t]: n }, from: null });
      return null;
    }
    case 'medicine': {
      const b = isInt(a.v) ? s.verts[a.v] : null;
      if (!b || b[0] !== p || b[1] !== 1) return 'Pick one of your settlements';
      if (me.pieces.city <= 0) return 'You have no cities left';
      if (!has(me.res, MEDICINE_COST)) return 'Medicine needs 2 ore and 1 wheat';
      pay(s, p, MEDICINE_COST);
      s.verts[a.v!] = [p, 2];
      me.pieces.city--;
      me.pieces.settlement++;
      events.push({ k: 'build', p, what: 'city', at: a.v! });
      return null;
    }
    case 'roadBuilding': {
      const n = Math.min(2, freePieceSupply(s, p));
      if (!n || !canPlaceFreePiece(s, p)) return 'You have nowhere to build a road';
      s.freeRoads = n;
      s.roadsReturn = 'main';
      s.stage = 'roads';
      return null;
    }
    case 'smith': {
      if (!smithOK(s, p, a.vs)) return 'Pick one or two of your knights that can be promoted';
      for (const v of a.vs!) {
        const k = c.knights[v]!;
        k.lvl = (k.lvl + 1) as 2 | 3;
        k.up = true;
        events.push({ k: 'promote', p, v, lvl: k.lvl, free: true });
      }
      return null;
    }
    /* ---------- Politics ---------- */
    case 'bishop': {
      if (!robberAwake(s)) return 'The robber stays put until the barbarians attack';
      const h = a.h;
      if (!isInt(h) || h === s.board.robber || !robberHexOK(s, h)) return 'Move the robber to another tile';
      s.board.robber = h;
      events.push({ k: 'robber', p, h, victim: null });
      const victims = new Set<Seat>();
      for (const v of geo(s).hexVerts[h]!) {
        const b = s.verts[v];
        if (b && b[0] !== p && total(s.players[b[0]]!.res) > 0) victims.add(b[0]);
      }
      for (const o of [...victims].sort((x, y) => x - y))
        events.push({ k: 'steal', p, from: o, r: stealRandom(s, o, p) });
      return null;
    }
    case 'deserter': {
      const to = a.to;
      if (!isInt(to) || to === p || to < 0 || to >= s.players.length) return 'Choose another player';
      const theirs = c.knights.flatMap((k, v) => (k && k.p === to ? [v] : []));
      if (!theirs.length) return 'They have no knights';
      if (theirs.length > 1) {
        owe(s, [{ k: 'desert', p: to, by: p }], events);
        return null;
      }
      const v = theirs[0]!;
      const k = c.knights[v]!;
      c.knights[v] = null;
      events.push({ k: 'knightRemoved', p: to, v });
      updateLongest(s, events);
      deserterFollowUp(x, p, k);
      return null;
    }
    case 'diplomat': {
      const e = a.e;
      if (!isInt(e) || !isOpenRoad(s, e)) return 'Pick an open road';
      const o = s.edges[e]!;
      s.edges[e] = null;
      s.players[o]!.pieces.road++;
      events.push({ k: 'roadRemoved', p: o, e, by: p });
      updateLongest(s, events);
      if (o === p) owe(s, [{ k: 'rebuild', p }], events);
      return null;
    }
    case 'intrigue': {
      if (!isInt(a.v) || !intrigueTargets(s, p).includes(a.v))
        return 'Pick an opponent’s knight on your road';
      const k = c.knights[a.v]!;
      c.knights[a.v] = null;
      events.push({ k: 'knightRemoved', p: k.p, v: a.v });
      displace(x, k.p, k, a.v);
      updateLongest(s, events);
      return null;
    }
    case 'saboteur': {
      const hit = saboteurTargets(s, p);
      if (!hit.length) return 'Nobody has as many points as you and cards to lose';
      owe(
        s,
        hit.map((o): Owe => ({ k: 'discard', p: o, n: Math.floor(total(s.players[o]!.res) / 2) })),
        events,
      );
      return null;
    }
    case 'spy': {
      const to = a.to;
      if (!isInt(to) || to === p || to < 0 || to >= s.players.length || !c.hands[to]!.length)
        return 'Choose a player with progress cards';
      owe(s, [{ k: 'spy', p, from: to }], events);
      return null;
    }
    case 'warlord': {
      const mine = c.knights.filter((k): k is Knight => !!k && k.p === p && !k.on);
      if (!mine.length) return 'All your knights are already active';
      for (const k of mine) {
        k.on = true;
        k.fresh = true;
      }
      events.push({ k: 'activateAll', p, n: mine.length });
      return null;
    }
    case 'wedding': {
      const who = richer(s, p);
      if (!who.length) return 'Nobody has more points than you';
      owe(
        s,
        who.map((o): Owe => ({ k: 'give', p: o, to: p, n: Math.min(2, total(s.players[o]!.res)) })),
        events,
      );
      return null;
    }
    /* ---------- Trade ---------- */
    case 'commercialHarbor': {
      // Playable with any resource in hand (whether others hold commodities is secret);
      // only players with a commodity take part.
      if (!RES.some((r) => me.res[r] > 0)) return 'You need a resource to offer';
      const left = opponents(s, p).filter((o) => hasCommodity(s, o));
      if (left.length) owe(s, [{ k: 'harbor', p, left }], events);
      return null;
    }
    case 'masterMerchant': {
      const to = a.to;
      if (!isInt(to) || !richer(s, p).includes(to)) return 'Choose a player with more points than you';
      owe(s, [{ k: 'take', p, from: to, n: Math.min(2, total(s.players[to]!.res)) }], events);
      return null;
    }
    case 'merchant': {
      if (!isInt(a.h) || !merchantHexes(s, p).includes(a.h)) return 'Put the merchant next to your town';
      c.merchant = { h: a.h, p };
      events.push({ k: 'merchant', p, h: a.h });
      return null;
    }
    case 'merchantFleet': {
      const r = a.r;
      if (!r || !(isResource(r) || isCommodity(r)) || c.fleet.includes(r)) return 'Pick a card to trade 2:1';
      c.fleet.push(r);
      return null;
    }
    case 'resourceMonopoly':
    case 'tradeMonopoly': {
      const r = a.r;
      const res = a.card === 'resourceMonopoly';
      if (!r || !(res ? isResource(r) : isCommodity(r))) return res ? 'Pick a resource' : 'Pick a commodity';
      const from: Record<number, number> = {};
      let n = 0;
      for (const o of opponents(s, p)) {
        const k = Math.min(res ? 2 : 1, s.players[o]!.res[r] ?? 0);
        if (!k) continue;
        transfer(s, o, p, { [r]: k });
        from[o] = k;
        n += k;
      }
      events.push({ k: 'gain', p, cards: { [r]: n }, from });
      return null;
    }
    case 'printer':
    case 'constitution':
      return 'That card is played when drawn';
    default:
      return 'Unknown card';
  }
}

export function playProgress(x: Ctx, a: Play): string | null {
  const { s, p, myTurn, events } = x;
  const c = ck(s);
  if (!myTurn) return 'Wait for your turn';
  if (typeof a.card !== 'string' || !c.hands[p]!.includes(a.card)) return 'You don’t have that card';
  if (a.card === 'alchemist') {
    if (s.stage !== 'preroll') return 'Play the Alchemist before you roll';
    if (c.alchemy) return 'You already chose the dice';
  } else if (s.stage !== 'main') {
    return s.stage === 'preroll' ? 'Roll the dice first' : 'Finish what you’re doing first';
  }
  const at = events.length;
  const card = a.card;
  // Take the card out first, so effects that move cards around see the right hand.
  c.hands[p]!.splice(c.hands[p]!.indexOf(card), 1);
  const err = run(x, a);
  if (err) return err; // applyAction throws the changed copy away
  c.decks[trackOf(card)].push(card);
  events.splice(at, 0, { k: 'progress', p, card });
  return null;
}

/* ---------- Legal plays ---------- */

export function legalProgress(s: GameState, p: Seat, out: Action[]) {
  const c = ck(s);
  if (s.turn !== p || (s.stage !== 'main' && s.stage !== 'preroll')) return;
  const me = s.players[p]!;
  const push = (card: Progress, extra: Partial<Play> = {}) => out.push({ type: 'progress', card, ...extra });
  for (const card of new Set(c.hands[p])) {
    if (s.stage === 'preroll') {
      if (card !== 'alchemist' || c.alchemy) continue;
      for (let y = 1; y <= 6; y++)
        for (let r = 1; r <= 6; r++) if (alchemyOK(s, [y, r])) push(card, { d: [y, r] });
      continue;
    }
    switch (card) {
      case 'crane':
        if (cityVerts(s, p).length && TRACKS.some((t) => c.lvl[p]![t] < 5)) push(card);
        break;
      case 'engineer':
        if (wallsOf(s, p) < WALLS)
          for (const v of cityVerts(s, p)) if (!c.walls.includes(v)) push(card, { v });
        break;
      case 'inventor': {
        const hs = s.board.hexes.flatMap((_, i) => (inventorHex(s, i) ? [i] : []));
        for (let i = 0; i < hs.length; i++)
          for (let j = i + 1; j < hs.length; j++) push(card, { h: hs[i], h2: hs[j] });
        break;
      }
      case 'irrigation':
        if (myHexes(s, p, 'wheat').length) push(card);
        break;
      case 'mining':
        if (myHexes(s, p, 'ore').length) push(card);
        break;
      case 'medicine':
        if (me.pieces.city > 0 && has(me.res, MEDICINE_COST))
          s.verts.forEach((b, v) => b && b[0] === p && b[1] === 1 && push(card, { v }));
        break;
      case 'roadBuilding':
        if (freePieceSupply(s, p) > 0 && canPlaceFreePiece(s, p)) push(card);
        break;
      case 'smith': {
        const ks = c.knights.flatMap((_, v) => (canPromote(s, p, v) ? [v] : []));
        for (const v of ks) push(card, { vs: [v] });
        for (let i = 0; i < ks.length; i++) {
          for (let j = i + 1; j < ks.length; j++) {
            // Both promotions must fit in the supply, in some order.
            const pair = [ks[i]!, ks[j]!];
            const rev = [ks[j]!, ks[i]!];
            if (smithOK(s, p, pair)) push(card, { vs: pair });
            else if (smithOK(s, p, rev)) push(card, { vs: rev });
          }
        }
        break;
      }
      case 'bishop':
        if (robberAwake(s))
          for (let h = 0; h < s.board.hexes.length; h++)
            if (h !== s.board.robber && robberHexOK(s, h)) push(card, { h });
        break;
      case 'deserter':
        for (const to of opponents(s, p)) if (c.knights.some((k) => k && k.p === to)) push(card, { to });
        break;
      case 'diplomat':
        s.edges.forEach((o, e) => o != null && isOpenRoad(s, e) && push(card, { e }));
        break;
      case 'intrigue':
        for (const v of intrigueTargets(s, p)) push(card, { v });
        break;
      case 'saboteur':
        if (saboteurTargets(s, p).length) push(card);
        break;
      case 'spy':
        for (const to of opponents(s, p)) if (c.hands[to]!.length) push(card, { to });
        break;
      case 'warlord':
        if (c.knights.some((k) => k && k.p === p && !k.on)) push(card);
        break;
      case 'wedding':
        if (richer(s, p).length) push(card);
        break;
      case 'commercialHarbor':
        if (RES.some((r) => me.res[r] > 0)) push(card);
        break;
      case 'masterMerchant':
        for (const to of richer(s, p)) push(card, { to });
        break;
      case 'merchant':
        for (const h of merchantHexes(s, p)) push(card, { h });
        break;
      case 'merchantFleet':
        for (const r of [...RES, ...COMS] as Card[]) if (!c.fleet.includes(r)) push(card, { r });
        break;
      case 'resourceMonopoly':
        for (const r of RES) push(card, { r });
        break;
      case 'tradeMonopoly':
        for (const r of COMS) push(card, { r });
        break;
      default:
        break;
    }
  }
}
