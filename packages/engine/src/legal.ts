/*
 * Enumerate the concrete actions a seat can take. Used by the client for highlighting,
 * the simulator, and later the CPU player.
 *
 * Two kinds of action take free-form card counts and are not enumerated: `discard`
 * (see `mustDiscard`) and `offer`. Everything returned here must be accepted by applyAction;
 * the simulator checks that.
 */

import { mods } from './modules/api';
import {
  COST, canPlaceFreePiece, cardKinds, deckCount, devCardsOn, freePieceSupply, has, legalCities, legalRoads,
  legalSettlements, legalSetupRoads, legalSetupVerts, rateFor, robberHexOK, robberVictims,
} from './queries'; // prettier-ignore
import { RES, type Action, type GameState, type Seat } from './types';

export function mustDiscard(s: GameState, seat: Seat): number {
  return s.phase === 'play' && s.stage === 'discard' ? (s.discard?.[seat] ?? 0) : 0;
}

/** Requests between players (undo, the dice back, rule changes): never picked by a bot or CPU. */
export const TABLE_TALK: readonly Action['type'][] = [
  'askUndo', 'answerUndo', 'cancelUndo', 'askBack', 'handBack', 'refuseBack', 'setRule',
]; // prettier-ignore

export function legalActions(s: GameState, p: Seat): Action[] {
  if (s.phase !== 'play' || p < 0 || p >= s.players.length) return [];
  const out: Action[] = [];
  const me = s.players[p]!;
  const myTurn = s.turn === p;

  // Answering trade offers can happen off-turn.
  if (s.stage === 'main') {
    for (const o of s.offers) {
      if (o.from === p) {
        out.push({ type: 'cancel', id: o.id });
        if (myTurn) {
          for (const [w, yes] of Object.entries(o.resp)) {
            const ws = Number(w);
            if (yes === 1 && has(me.res, o.give) && has(s.players[ws]!.res, o.want)) {
              out.push({ type: 'confirm', id: o.id, with: ws });
            }
          }
        }
        continue;
      }
      if (o.from === s.turn) {
        out.push({ type: 'respond', id: o.id, yes: false });
        if (has(me.res, o.want)) out.push({ type: 'respond', id: o.id, yes: true });
      } else if (myTurn) {
        out.push({ type: 'respond', id: o.id, yes: false });
        if (has(me.res, o.want) && has(s.players[o.from]!.res, o.give)) {
          out.push({ type: 'respond', id: o.id, yes: true });
        }
      }
    }
  }
  for (const m of mods(s)) m.legal?.(s, p, out);
  // Handing the dice back.
  const b = s.back;
  if (b) {
    if (p === b.from && !myTurn && !b.asked && !b.refused) out.push({ type: 'askBack' });
    if (myTurn) out.push({ type: 'handBack' });
    if (myTurn && b.asked) out.push({ type: 'refuseBack' });
  }
  // Undo (SPEC 5.10).
  const u = s.undo;
  if (u) {
    if (p === u.p) out.push(u.asked ? { type: 'cancelUndo' } : { type: 'askUndo' });
    else if (u.asked && !u.ok.includes(p))
      out.push({ type: 'answerUndo', yes: true }, { type: 'answerUndo', yes: false });
  }
  if (!myTurn) return out;

  switch (s.stage) {
    case 'setup':
      for (const v of legalSetupVerts(s)) {
        for (const e of legalSetupRoads(s, v)) out.push({ type: 'setup', v, e });
      }
      return out;
    case 'discard':
      return out;
    case 'robber':
      for (let h = 0; h < s.board.hexes.length; h++) {
        if (h === s.board.robber || !robberHexOK(s, h)) continue;
        const victims = robberVictims(s, p, h);
        if (!victims.length) out.push({ type: 'robber', hex: h });
        for (const victim of victims) out.push({ type: 'robber', hex: h, victim });
      }
      return out;
    case 'roads':
      if (me.pieces.road > 0) for (const e of legalRoads(s, p)) out.push({ type: 'freeRoad', e });
      out.push({ type: 'skipRoads' });
      return out;
    case 'preroll':
      out.push({ type: 'roll' });
      pushDevPlays(s, p, out);
      return out;
    case 'main': {
      if (!mods(s).some((m) => m.endTurnBlock?.(s, p))) out.push({ type: 'end' });
      pushDevPlays(s, p, out);
      if (has(me.res, COST.road) && me.pieces.road > 0) {
        for (const e of legalRoads(s, p)) out.push({ type: 'road', e });
      }
      if (has(me.res, COST.settlement) && me.pieces.settlement > 0) {
        for (const v of legalSettlements(s, p)) out.push({ type: 'settlement', v });
      }
      if (has(me.res, COST.city) && me.pieces.city > 0) {
        for (const v of legalCities(s, p)) out.push({ type: 'city', v });
      }
      if (has(me.res, COST.dev) && deckCount(s) > 0 && devCardsOn(s)) out.push({ type: 'buyDev' });
      const kinds = cardKinds(s);
      for (const give of kinds) {
        if ((me.res[give] ?? 0) < rateFor(s, p, give)) continue;
        for (const get of kinds) if (get !== give && s.bank[get]! > 0) out.push({ type: 'bank', give, get });
      }
      return out;
    }
    default:
      return out;
  }
}

function pushDevPlays(s: GameState, p: Seat, out: Action[]) {
  const me = s.players[p]!;
  if (s.devPlayed || !devCardsOn(s)) return;
  if (me.dev.knight > 0) out.push({ type: 'playKnight' });
  if (me.dev.road > 0 && freePieceSupply(s, p) > 0 && canPlaceFreePiece(s, p))
    out.push({ type: 'playRoads' });
  if (me.dev.plenty > 0) {
    for (let i = 0; i < RES.length; i++) {
      for (let j = i; j < RES.length; j++) {
        const r1 = RES[i]!;
        const r2 = RES[j]!;
        const ok = r1 === r2 ? s.bank[r1] >= 2 : s.bank[r1] >= 1 && s.bank[r2] >= 1;
        if (ok) out.push({ type: 'playPlenty', r1, r2 });
      }
    }
  }
  if (me.dev.mono > 0) for (const r of RES) out.push({ type: 'playMono', r });
}
