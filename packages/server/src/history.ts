/*
 * Stats across games (SPEC 5.6). Every number comes from replaying games' saved moves
 * (statsFromLog); the cache in the database is only a shortcut and can be thrown away.
 * The history holds finished games with two or more people (D2).
 */

import {
  ENGINE_VERSION,
  GAIN_SOURCES,
  LOSS_SOURCES,
  statsFromLog,
  sumCards,
  type Color,
  type GameConfig,
  type GameStats,
  type GameState,
} from '@settlers/engine';
import type { GameStatsInfo, PlayerRecord, SavedGame } from './protocol';
import type { GameRow, Store } from './store';

export type Mode = SavedGame['mode'];

export function modeOf(config: Partial<GameConfig>): Mode {
  // Seafarers by its module (a custom or generated board may have any id).
  const sea = !!(config.modules?.includes('seafarers') || config.map?.modules.includes('seafarers'));
  const ck = !!config.modules?.includes('citiesKnights');
  return sea ? (ck ? 'full' : 'seafarers') : ck ? 'knights' : 'base';
}

/** One finished game, ready for adding up. */
interface Played {
  row: GameRow;
  stats: GameStats;
  /** Seat order in the game: who sat there (a profile id, or cpu:<level>). */
  who: string[];
  names: string[];
  colors: Color[];
  /** Seat order → index into row.players doesn't matter; we keep the game's seat order. */
  humans: number;
}

export class History {
  constructor(private store: Store) {}

  /** A game's stats: from the cache if it matches the game's moves, else rebuilt and cached. */
  statsOf(row: GameRow): { stats: GameStats; state: GameState } | null {
    const seq = this.store.lastSeq(row.id);
    const actions = this.store.loadActions(row.id);
    try {
      const { stats, state } = statsFromLog(row.seed, row.players, row.config, actions);
      this.store.saveStats(row.id, ENGINE_VERSION, seq, stats);
      return { stats, state };
    } catch {
      return null;
    }
  }

  /** Cached stats only (for lists): rebuilt when missing. */
  private cached(row: GameRow): { stats: GameStats; state: GameState | null } | null {
    const seq = this.store.lastSeq(row.id);
    const hit = this.store.getStats(row.id, ENGINE_VERSION, seq) as GameStats | null;
    if (hit) return { stats: hit, state: null };
    return this.statsOf(row);
  }

  /** Who sat in each seat (in the game's seat order), by the state's pids. */
  private seatsOf(
    row: GameRow,
    pids: string[],
  ): { who: string[]; names: string[]; colors: Color[]; humans: number } {
    const links = new Map(this.store.gamePlayers(row.id).map((g) => [g.pid, g]));
    const byPid = new Map(row.players.map((p) => [p.pid, p]));
    const who: string[] = [];
    const names: string[] = [];
    const colors: Color[] = [];
    let humans = 0;
    for (const pid of pids) {
      const link = links.get(pid);
      const p = byPid.get(pid)!;
      if (link?.profileId) {
        humans++;
        who.push(link.profileId);
        names.push(this.store.profileById(link.profileId)?.name ?? p.nick);
      } else {
        const level = link?.cpuLevel ?? 'easy';
        who.push(`cpu:${level}`);
        names.push(p.nick);
      }
      colors.push(p.color);
    }
    return { who, names, colors, humans };
  }

  /** The game's seat order (state.players), from its first snapshot-free replay. */
  private pidsOf(row: GameRow, state: GameState | null): string[] {
    if (state) return state.players.map((p) => p.pid);
    const s = statsFromLog(row.seed, row.players, row.config, []).state;
    return s.players.map((p) => p.pid);
  }

  /** Finished games with two or more people, newest first. */
  history(): Played[] {
    const out: Played[] = [];
    for (const row of this.store.allGames()) {
      if (row.endReason !== 'won') continue;
      const c = this.cached(row);
      if (!c) continue;
      const seats = this.seatsOf(row, this.pidsOf(row, c.state));
      if (seats.humans < 2) continue;
      out.push({ row, stats: c.stats, ...seats });
    }
    return out;
  }

  /** One game's stats with names, for the end screen or the Stats page. */
  gameInfo(id: string): GameStatsInfo | null {
    const row = this.store.loadGame(id);
    if (!row) return null;
    const r = this.statsOf(row);
    if (!r) return null;
    const seats = this.seatsOf(
      row,
      r.state.players.map((p) => p.pid),
    );
    return {
      id: row.id,
      at: row.lastAt ?? row.createdAt,
      mode: modeOf(row.config),
      players: seats.names.map((name, i) => ({
        name,
        color: seats.colors[i]!,
        ...(seats.who[i]!.startsWith('cpu:') ? { cpu: true } : {}),
      })),
      stats: r.stats,
      hexes: r.state.board.hexes.map((h) => ({ q: h.q, r: h.r, t: h.t, n: h.n })),
    };
  }

  /** Someone's record: a profile id, or cpu:<level>. */
  recordFor(who: string): PlayerRecord {
    const rec: PlayerRecord = {
      wins: 0,
      games: 0,
      byMode: {},
      avgPoints: 0,
      vs: [],
      got: {},
      lost: {},
      robs: 0,
      robbed: 0,
      luck: { got: 0, expected: 0 },
      dice: new Array<number>(13).fill(0),
      events: {},
      streak: { current: 0, best: 0 },
      past: [],
    };
    const vs = new Map<string, { name: string; wins: number; losses: number }>();
    let points = 0;
    // Oldest first, for streaks.
    const games = this.history().reverse();
    let run = 0;
    for (const g of games) {
      // Dice are everyone's: count every roll in the history.
      g.stats.dice.forEach((n, t) => (rec.dice[t]! += n));
      for (const [f, n] of Object.entries(g.stats.events)) rec.events[f] = (rec.events[f] ?? 0) + n;
      const seat = g.who.indexOf(who);
      if (seat < 0) continue;
      const ps = g.stats.players[seat]!;
      const won = g.stats.winner === seat;
      rec.games++;
      if (won) rec.wins++;
      const m = (rec.byMode[modeOf(g.row.config)] ??= { wins: 0, games: 0 });
      m.games++;
      if (won) m.wins++;
      const vp = ps.points.reduce((a, x) => a + x.vp, 0);
      points += vp;
      for (const k of GAIN_SOURCES) rec.got[k] = (rec.got[k] ?? 0) + sumCards(ps.got[k]);
      for (const k of LOSS_SOURCES) rec.lost[k] = (rec.lost[k] ?? 0) + sumCards(ps.lost[k]);
      for (const k of GAIN_SOURCES)
        for (const [r, n] of Object.entries(ps.got[k]))
          rec.got[`card:${r}`] = (rec.got[`card:${r}`] ?? 0) + (n ?? 0);
      rec.robs += ps.robs;
      rec.robbed += ps.robbed;
      rec.luck.got += ps.luck.got;
      rec.luck.expected += ps.luck.expected;
      // Head to head: against everyone else at the table.
      g.who.forEach((other, i) => {
        if (i === seat) return;
        const line = vs.get(other) ?? { name: g.names[i]!, wins: 0, losses: 0 };
        if (won) line.wins++;
        else if (g.stats.winner === i) line.losses++;
        vs.set(other, line);
      });
      run = won ? run + 1 : 0;
      rec.streak.best = Math.max(rec.streak.best, run);
      rec.past.push({
        id: g.row.id,
        at: g.row.lastAt ?? g.row.createdAt,
        mode: modeOf(g.row.config),
        players: g.names.map((name, i) => ({
          name,
          color: g.colors[i]!,
          vp: g.stats.players[i]!.points.reduce((a, x) => a + x.vp, 0),
          won: g.stats.winner === i,
        })),
      });
    }
    rec.streak.current = run;
    rec.avgPoints = rec.games ? points / rec.games : 0;
    rec.vs = [...vs.entries()]
      .map(([w, x]) => ({ who: w, ...x }))
      .sort((a, b) => a.name.localeCompare(b.name));
    rec.past.reverse();
    return rec;
  }
}
