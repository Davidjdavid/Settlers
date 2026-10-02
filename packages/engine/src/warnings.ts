/*
 * Cards that wouldn't do anything right now (SPEC 8.11 D4): a short reason to show before the
 * card is played. The player may play it anyway. Worked out from the player's own view only, so
 * it never hints at anything hidden (it can't know who holds which card).
 */

import { canPromote, cityVerts } from './modules/citiesKnights';
import { canPlaceFreePiece, geo, robberHexOK, robberVictims } from './queries';
import { RES, TRACKS, TRACK_COM, type Action, type Seat } from './types';
import { stateFromView, type PlayerView } from './view';

const others = (v: PlayerView, me: Seat) => v.players.filter((_, q) => q !== me);

/** Why playing this card now would do nothing, or null if it would do something. */
export function cardWarning(v: PlayerView, a: Action): string | null {
  const me = v.me;
  if (me == null || !v.hand) return null;
  const s = stateFromView(v);
  const noCards = others(v, me).every((p) => p.resCount === 0);
  switch (a.type) {
    case 'playKnight': {
      // A spot matters if it blocks someone else's building or lets you rob someone.
      const g = geo(s);
      const blocksMine =
        s.board.robber >= 0 && g.hexVerts[s.board.robber]!.some((u) => s.verts[u]?.[0] === me);
      const matters = s.board.hexes.some(
        (_, h) =>
          h !== s.board.robber &&
          robberHexOK(s, h) &&
          (robberVictims(s, me, h).length > 0 ||
            g.hexVerts[h]!.some((u) => s.verts[u] && s.verts[u]![0] !== me)),
      );
      return matters || blocksMine
        ? null
        : 'Knight: no robber spot would block or rob anyone (it still counts toward Largest Army)';
    }
    case 'playRoads':
      return canPlaceFreePiece(s, me) ? null : 'Road Building: there’s no space for a road or ship';
    case 'playPlenty':
      return RES.some((r) => v.bank[r] > 0) ? null : 'Year of Plenty: the bank has no resources';
    case 'playMono':
      return noCards ? 'Monopoly: nobody else holds any cards' : null;
    case 'progress':
      switch (a.card) {
        case 'smith': {
          const can = s.ck!.knights.some((k, u) => k?.p === me && canPromote(s, me, u));
          return can ? null : 'Smith: none of your knights can be promoted right now';
        }
        case 'crane': {
          // Improvements this turn cost 1 less; is any within reach?
          const reach = cityVerts(s, me).length > 0 &&
            TRACKS.some((t) => {
              const L = s.ck!.lvl[me]![t];
              return L < 5 && (v.hand!.res[TRACK_COM[t]] ?? 0) >= L;
            }); // prettier-ignore
          return reach ? null : 'Crane: you can’t afford an improvement this turn, even 1 cheaper';
        }
        case 'resourceMonopoly':
        case 'tradeMonopoly':
          return noCards ? 'Monopoly: nobody else holds any cards' : null;
        case 'merchantFleet': {
          const n = a.r ? (v.hand.res[a.r] ?? 0) : 0;
          // Cloth is shown as linen (SPEC 8.11 D6).
          const name = a.r === 'cloth' ? 'linen' : (a.r ?? 'cards');
          return n >= 2 ? null : `Merchant Fleet: you hold fewer than 2 ${name} to trade 2:1`;
        }
        case 'warlord': {
          const off = s.ck!.knights.some((k) => k?.p === me && !k.on);
          return off ? null : 'Warlord: all your knights are already active';
        }
        case 'commercialHarbor': {
          const any = others(v, me).some((p) => p.resCount > 0);
          return any ? null : 'Commercial Harbor: nobody else holds any cards';
        }
        default:
          return null;
      }
    default:
      return null;
  }
}
