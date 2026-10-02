import { describe, expect, it } from 'vitest';
import {
  COLORS,
  applyAction,
  botMove,
  eventsFor,
  logNotes,
  newGame,
  scenarioMap,
  seedRng,
  viewFor,
  type GameConfig,
} from '@settlers/engine';
import { SOUNDS, hear, masterVolume, played, soundPref, soundsFor, type SoundId } from '../src/sound';

describe('Sounds (SPEC 9.4)', () => {
  it('every sound has a name and at least two styles', () => {
    for (const [id, s] of Object.entries(SOUNDS)) {
      expect(s.label, id).toBeTruthy();
      expect(s.styles.length, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('card ticks and table talk are on but quiet by default (D4)', () => {
    expect(soundPref(undefined, 'cards')).toEqual({ on: true, vol: 0.35, style: 0 });
    expect(soundPref(undefined, 'chat')).toEqual({ on: true, vol: 0.4, style: 0 });
    expect(soundPref(undefined, 'dice').vol).toBeGreaterThan(0.5);
    expect(masterVolume(undefined)).toBe(0.8);
  });

  it('each sound’s switch, volume and style come from the profile', () => {
    const prefs = { master: 0.5, each: { dice: { on: false }, steal: { vol: 0.2, style: 2 } } };
    expect(soundPref(prefs, 'dice').on).toBe(false);
    expect(soundPref(prefs, 'steal')).toEqual({ on: true, vol: 0.2, style: 2 });
    // A style that doesn't exist falls back to the last one.
    expect(soundPref({ each: { road: { style: 4 } } }, 'road').style).toBe(SOUNDS.road.styles.length - 1);
  });

  it('hear: "Your turn sound" covers the chime, "Game sounds" the rest, then each switch', () => {
    const heard = (id: SoundId, settings: Parameters<typeof hear>[1]) => {
      const before = played.length;
      hear(id, settings);
      return played.length > before;
    };
    expect(heard('turn', {})).toBe(true);
    expect(heard('turn', { turnSound: false })).toBe(false);
    expect(heard('turn', { gameSounds: false })).toBe(true);
    expect(heard('dice', { gameSounds: false })).toBe(false);
    expect(heard('dice', { sounds: { each: { dice: { on: false } } } })).toBe(false);
    expect(heard('dice', { sounds: { each: { dice: { vol: 0 } } } })).toBe(false);
    expect(heard('dice', { sounds: { master: 0 } })).toBe(false);
    expect(heard('steal', { sounds: { each: { dice: { on: false } } } })).toBe(true);
  });

  it('events make the right sounds; the sad tune only for whoever lost a city (D3)', () => {
    const attack = { k: 'attack', strength: 5, defense: 2, losers: [1], defender: null, tied: [] } as const;
    expect(soundsFor([attack], 1)).toEqual([['sad', 1]]);
    expect(soundsFor([attack], 0)).toEqual([['horn', 1]]);
    expect(soundsFor([{ ...attack, strength: 1 }], 1)).toEqual([['defended', 1]]);
    expect(
      soundsFor(
        [
          { k: 'produce', gains: { 0: { wood: 2 }, 1: { ore: 1 } }, short: [] },
          { k: 'build', p: 0, what: 'city', v: 3 },
          { k: 'build', p: 0, what: 'road', e: 3 },
          { k: 'steal', p: 0, from: 1, r: null },
          { k: 'longest', p: null, n: 0, from: 1 },
        ] as never,
        0,
      ),
    ).toEqual([
      ['cards', 3],
      ['city', 1],
      ['road', 1],
      ['steal', 1],
    ]);
  });

  it('a whole game makes most sounds, from every seat’s own events', () => {
    const heard = new Set<SoundId>();
    for (const config of [
      { modules: ['citiesKnights'], winVP: 13 },
      { map: scenarioMap('heading-for-new-shores', 3) },
    ] as Partial<GameConfig>[]) {
      let s = newGame(
        'sounds',
        ['A', 'B', 'C'].map((nick, i) => ({ pid: `p${i}`, nick, color: COLORS[i]! })),
        config,
      );
      const rng = seedRng('sound-bots');
      for (let step = 0; step < 8000 && s.phase === 'play'; step++) {
        let moved = false;
        for (let p = 0; p < 3 && !moved; p++) {
          const a = botMove(viewFor(s, p), rng);
          const r = a && applyAction(s, p, a);
          if (!r || !r.ok) continue;
          s = r.state;
          moved = true;
          for (let seat = 0; seat < 3; seat++)
            for (const [id] of soundsFor([...eventsFor(r.events, seat), ...logNotes(s, r.events)], seat))
              heard.add(id);
        }
        if (!moved) break;
      }
    }
    for (const id of [
      'cards',
      'steal',
      'road',
      'settlement',
      'city',
      'shipMove',
      'robber',
      'buyCard',
      'playCard',
      'trade',
      'knight',
      'barbarians',
      'award',
    ] as SoundId[])
      // prettier-ignore
      expect(heard, id).toContain(id);
    expect(heard.has('horn') || heard.has('sad') || heard.has('defended')).toBe(true);
  });
});
