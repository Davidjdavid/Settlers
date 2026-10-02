/*
 * Sounds (SPEC 5.3, 5.9, 5.13, 9.3, 9.4), made in the browser with Web Audio (no sound files):
 * every sound has a few styles, its own switch and volume, under a master volume, saved on the
 * player's profile. `hear` respects all of those; `preview` plays one for the Sounds page.
 * Browsers only allow sound after the page has been touched or clicked, so the audio starts on
 * the first tap.
 */

import type { GameEvent, LogNote, Seat } from '@settlers/engine';
import type { PlayerSettings, SoundId, SoundPrefs } from '@settlers/server/protocol';

export type { SoundId };

let ctx: AudioContext | null = null;
/** What has played, for the end-to-end test. */
export const played: SoundId[] = [];

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Unlock audio on the first interaction.
if (typeof window !== 'undefined')
  window.addEventListener('pointerdown', () => audio(), { once: true, capture: true });

/* ---------- Building blocks ---------- */

/** Where a sound plays, at what time. */
interface Out {
  a: AudioContext;
  to: AudioNode;
  t: number;
}

function tone(o: Out, freq: number, at: number, len: number, gain = 0.15, type: OscillatorType = 'sine') {
  const { a } = o;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = o.t + at;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(g).connect(o.to);
  osc.start(t);
  osc.stop(t + len + 0.02);
}

/** A note that bends from one pitch to another, through a low-pass filter (brass, voices). */
function slide(
  o: Out,
  from: number,
  to: number,
  at: number,
  len: number,
  gain = 0.1,
  type: OscillatorType = 'sawtooth',
  cutoff = 1100,
) {
  const { a } = o;
  const osc = a.createOscillator();
  const f = a.createBiquadFilter();
  const g = a.createGain();
  const t = o.t + at;
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.linearRampToValueAtTime(to, t + len);
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.05);
  g.gain.setValueAtTime(gain, t + len * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(f).connect(g).connect(o.to);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

/** A burst of filtered noise: clicks, rattles, swishes, waves. */
function noise(
  o: Out,
  at: number,
  len: number,
  gain: number,
  filter: BiquadFilterType,
  freq: number,
  sweepTo?: number,
) {
  const { a } = o;
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * len)), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  const t = o.t + at;
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + len);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(o.to);
  src.start(t);
}

/** Notes one after another: [frequency, length] at a steady step. */
function notes(
  o: Out,
  list: [number, number][],
  step: number,
  gain = 0.13,
  type: OscillatorType = 'triangle',
) {
  list.forEach(([f, len], i) => tone(o, f, i * step, len, gain, type));
}

const rattle = (o: Out, clicks: number, low: number, gain = 0.35) => {
  for (let i = 0; i < clicks; i++)
    noise(o, i * 0.07 + Math.random() * 0.02, 0.04, gain, 'bandpass', low + Math.random() * 1200);
};

/* ---------- The sounds ---------- */

type Recipe = (o: Out, n: number) => void;

interface SoundInfo {
  label: string;
  /** Group on the Sounds page. */
  group: 'Turn and dice' | 'Building' | 'Cards and trades' | 'Robber and barbarians' | 'Table';
  on: boolean;
  vol: number;
  styles: [string, Recipe][];
}

/** Every sound with its styles; the first style is the default. */
export const SOUNDS: Record<SoundId, SoundInfo> = {
  turn: {
    label: 'Your turn',
    group: 'Turn and dice',
    on: true,
    vol: 0.8,
    styles: [
      ['Chime', (o) => (tone(o, 660, 0, 0.25), tone(o, 880, 0.15, 0.35))],
      ['Bell', (o) => (tone(o, 880, 0, 0.9, 0.12), tone(o, 1320, 0, 0.6, 0.05), tone(o, 1760, 0, 0.3, 0.03))],
      ['Knock', (o) => (tone(o, 180, 0, 0.12, 0.3), tone(o, 180, 0.18, 0.12, 0.3))],
    ],
  },
  dice: {
    label: 'Dice rolled',
    group: 'Turn and dice',
    on: true,
    vol: 0.8,
    styles: [
      ['Wooden', (o) => rattle(o, 6, 1800)],
      ['Soft', (o) => rattle(o, 4, 900, 0.25)],
      ['Cup', (o) => (noise(o, 0, 0.3, 0.12, 'highpass', 3000), rattle(o, 5, 1400))],
    ],
  },
  cards: {
    label: 'Cards dealt (a tick per card)',
    group: 'Cards and trades',
    on: true,
    vol: 0.35,
    styles: [
      ['Tick', (o, n) => { for (let i = 0; i < n; i++) noise(o, i * 0.06, 0.02, 0.3, 'highpass', 4000); }],
      ['Flip', (o, n) => { for (let i = 0; i < n; i++) noise(o, i * 0.07, 0.05, 0.25, 'bandpass', 2500, 900); }],
      ['Pluck', (o, n) => { for (let i = 0; i < n; i++) tone(o, 1200 + i * 60, i * 0.06, 0.06, 0.08, 'triangle'); }],
    ], // prettier-ignore
  },
  steal: {
    label: 'Card stolen',
    group: 'Cards and trades',
    on: true,
    vol: 0.8,
    styles: [
      ['Swipe', (o) => noise(o, 0, 0.25, 0.3, 'bandpass', 4000, 500)],
      [
        'Pluck',
        (o) =>
          notes(
            o,
            [
              [740, 0.1],
              [494, 0.18],
            ],
            0.09,
          ),
      ],
      [
        'Sneaky',
        (o) =>
          notes(
            o,
            [
              [220, 0.08],
              [262, 0.08],
              [208, 0.2],
            ],
            0.12,
            0.12,
            'square',
          ),
      ],
    ],
  },
  road: {
    label: 'Road or ship built',
    group: 'Building',
    on: true,
    vol: 0.8,
    styles: [
      ['Thunk', (o) => tone(o, 220, 0, 0.12, 0.14, 'triangle')],
      ['Tap', (o) => tone(o, 440, 0, 0.08, 0.1)],
      ['Wood', (o) => (noise(o, 0, 0.06, 0.3, 'lowpass', 900), tone(o, 180, 0, 0.1, 0.1, 'triangle'))],
    ],
  },
  settlement: {
    label: 'Settlement built',
    group: 'Building',
    on: true,
    vol: 0.8,
    styles: [
      [
        'Thunk',
        (o) =>
          notes(
            o,
            [
              [330, 0.12],
              [495, 0.16],
            ],
            0.08,
          ),
      ],
      [
        'Tap',
        (o) =>
          notes(
            o,
            [
              [523, 0.08],
              [659, 0.12],
            ],
            0.07,
            0.1,
            'sine',
          ),
      ],
      ['Wood', (o) => (noise(o, 0, 0.08, 0.3, 'lowpass', 1100), tone(o, 262, 0.02, 0.18, 0.12, 'triangle'))],
    ],
  },
  city: {
    label: 'City or wall built',
    group: 'Building',
    on: true,
    vol: 0.8,
    styles: [
      [
        'Rise',
        (o) =>
          notes(
            o,
            [
              [262, 0.12],
              [330, 0.12],
              [392, 0.25],
            ],
            0.09,
          ),
      ],
      [
        'Bells',
        (o) =>
          notes(
            o,
            [
              [784, 0.4],
              [988, 0.4],
              [1175, 0.6],
            ],
            0.12,
            0.07,
            'sine',
          ),
      ],
      ['Stone', (o) => (noise(o, 0, 0.12, 0.35, 'lowpass', 600), tone(o, 131, 0, 0.3, 0.16, 'triangle'))],
    ],
  },
  shipMove: {
    label: 'Ship moved',
    group: 'Building',
    on: true,
    vol: 0.8,
    styles: [
      ['Waves', (o) => noise(o, 0, 0.6, 0.25, 'lowpass', 500, 1500)],
      ['Ship bell', (o) => (tone(o, 1046, 0, 0.5, 0.08), tone(o, 1046, 0.25, 0.6, 0.08))],
      ['Creak', (o) => slide(o, 200, 150, 0, 0.35, 0.06, 'sawtooth', 700)],
    ],
  },
  robber: {
    label: 'Robber or pirate moved',
    group: 'Robber and barbarians',
    on: true,
    vol: 0.8,
    styles: [
      ['Thud', (o) => (tone(o, 90, 0, 0.3, 0.3), noise(o, 0, 0.1, 0.2, 'lowpass', 400))],
      ['Spooky', (o) => slide(o, 330, 247, 0, 0.6, 0.07, 'triangle', 2000)],
      [
        'Footsteps',
        (o) => (noise(o, 0, 0.06, 0.4, 'lowpass', 500), noise(o, 0.22, 0.06, 0.4, 'lowpass', 450)),
      ],
    ],
  },
  buyCard: {
    label: 'Card bought or drawn',
    group: 'Cards and trades',
    on: true,
    vol: 0.8,
    styles: [
      ['Shuffle', (o) => { for (let i = 0; i < 3; i++) noise(o, i * 0.06, 0.05, 0.25, 'bandpass', 2200); }],
      ['Coin', (o) => notes(o, [[988, 0.1], [1319, 0.3]], 0.08, 0.1, 'sine')],
      ['Flip', (o) => noise(o, 0, 0.12, 0.3, 'bandpass', 3000, 1200)],
    ], // prettier-ignore
  },
  playCard: {
    label: 'Card played',
    group: 'Cards and trades',
    on: true,
    vol: 0.8,
    styles: [
      ['Snap', (o) => (noise(o, 0, 0.04, 0.4, 'highpass', 2500), tone(o, 587, 0.02, 0.2, 0.1, 'triangle'))],
      ['Chord', (o) => [523, 659, 784].forEach((f) => tone(o, f, 0, 0.35, 0.06, 'triangle'))],
      ['Swish', (o) => noise(o, 0, 0.3, 0.25, 'bandpass', 800, 4000)],
    ],
  },
  trade: {
    label: 'Trade done',
    group: 'Cards and trades',
    on: true,
    vol: 0.8,
    styles: [
      [
        'Coins',
        (o) =>
          notes(
            o,
            [
              [1319, 0.12],
              [1568, 0.25],
            ],
            0.07,
            0.08,
            'sine',
          ),
      ],
      [
        'Handshake',
        (o) =>
          notes(
            o,
            [
              [392, 0.12],
              [523, 0.2],
            ],
            0.1,
          ),
      ],
      ['Register', (o) => (noise(o, 0, 0.05, 0.3, 'highpass', 3000), tone(o, 1568, 0.06, 0.5, 0.07))],
    ],
  },
  discard: {
    label: 'Discard',
    group: 'Cards and trades',
    on: true,
    vol: 0.8,
    styles: [
      ['Drop', (o) => notes(o, [[523, 0.1], [392, 0.1], [262, 0.2]], 0.08)],
      ['Flutter', (o) => { for (let i = 0; i < 4; i++) noise(o, i * 0.05, 0.04, 0.25, 'bandpass', 1800 - i * 300); }],
      ['Thud', (o) => tone(o, 110, 0, 0.25, 0.25)],
    ], // prettier-ignore
  },
  knight: {
    label: 'Knight built, activated or promoted',
    group: 'Building',
    on: true,
    vol: 0.8,
    styles: [
      ['Clank', (o) => (noise(o, 0, 0.08, 0.3, 'bandpass', 3200), tone(o, 880, 0, 0.15, 0.05, 'square'))],
      ['Trumpet', (o) => (slide(o, 392, 392, 0, 0.15, 0.07), slide(o, 523, 523, 0.15, 0.3, 0.07))],
      ['Drum', (o) => (tone(o, 150, 0, 0.15, 0.3), tone(o, 150, 0.12, 0.2, 0.3))],
    ],
  },
  barbarians: {
    label: 'Barbarian ship sails closer',
    group: 'Robber and barbarians',
    on: true,
    vol: 0.8,
    styles: [
      ['Drum', (o) => (tone(o, 82, 0, 0.25, 0.35), tone(o, 82, 0.3, 0.35, 0.35))],
      [
        'Oars',
        (o) => (
          noise(o, 0, 0.35, 0.25, 'lowpass', 300, 900),
          noise(o, 0.45, 0.35, 0.25, 'lowpass', 300, 900)
        ),
      ],
      ['Short horn', (o) => slide(o, 147, 140, 0, 0.45, 0.1)],
    ],
  },
  horn: {
    label: 'Barbarians win (someone else’s city)',
    group: 'Robber and barbarians',
    on: true,
    vol: 0.8,
    styles: [
      ['Horn', (o) => (slide(o, 147, 140, 0, 0.5, 0.12), slide(o, 147, 131, 0.6, 0.9, 0.12))],
      ['War drums', (o) => { for (let i = 0; i < 5; i++) tone(o, i % 2 ? 98 : 73, i * 0.22, 0.25, 0.35); }],
      ['Low horn', (o) => slide(o, 110, 98, 0, 1.4, 0.13)],
    ], // prettier-ignore
  },
  sad: {
    label: 'Barbarians take your city',
    group: 'Robber and barbarians',
    on: true,
    vol: 0.8,
    styles: [
      // "Wah wah wah waaah": four falling notes, the last one long and wobbling down.
      ['Trombone', (o) => [392, 370, 349, 330].forEach((f, i) =>
        slide(o, f, i === 3 ? f * 0.88 : f * 0.97, i * 0.42, i === 3 ? 1.1 : 0.36))],
      ['Piano', (o) => notes(o, [[392, 0.35], [370, 0.35], [349, 0.35], [330, 1]], 0.4, 0.12, 'sine')],
      ['Short', (o) => (slide(o, 330, 320, 0, 0.35), slide(o, 294, 262, 0.4, 0.9))],
    ], // prettier-ignore
  },
  defended: {
    label: 'Barbarians driven off',
    group: 'Robber and barbarians',
    on: true,
    vol: 0.8,
    styles: [
      [
        'Cheer',
        (o) =>
          notes(
            o,
            [
              [392, 0.12],
              [494, 0.12],
              [587, 0.12],
              [784, 0.4],
            ],
            0.1,
          ),
      ],
      ['Trumpet', (o) => (slide(o, 523, 523, 0, 0.15, 0.08), slide(o, 784, 784, 0.18, 0.5, 0.08))],
      [
        'Bells',
        (o) =>
          notes(
            o,
            [
              [1047, 0.5],
              [1319, 0.5],
              [1568, 0.7],
            ],
            0.15,
            0.07,
            'sine',
          ),
      ],
    ],
  },
  award: {
    label: 'Longest Road or Largest Army taken',
    group: 'Table',
    on: true,
    vol: 0.8,
    styles: [
      [
        'Ding',
        (o) =>
          notes(
            o,
            [
              [784, 0.15],
              [1047, 0.35],
            ],
            0.1,
            0.1,
            'sine',
          ),
      ],
      [
        'Chime',
        (o) =>
          notes(
            o,
            [
              [659, 0.3],
              [784, 0.3],
              [988, 0.5],
            ],
            0.12,
            0.08,
            'sine',
          ),
      ],
      ['Trumpet', (o) => (slide(o, 392, 392, 0, 0.12, 0.08), slide(o, 587, 587, 0.14, 0.4, 0.08))],
    ],
  },
  chat: {
    label: 'Table talk message',
    group: 'Table',
    on: true,
    vol: 0.4,
    styles: [
      ['Pop', (o) => tone(o, 880, 0, 0.08, 0.1)],
      ['Bubble', (o) => slide(o, 500, 900, 0, 0.12, 0.06, 'sine', 4000)],
      ['Tick', (o) => noise(o, 0, 0.03, 0.3, 'highpass', 3500)],
    ],
  },
  fanfare: {
    label: 'Win fanfare',
    group: 'Table',
    on: true,
    vol: 0.8,
    styles: [
      ['Fanfare', (o) => [523, 659, 784, 1047].forEach((f, i) => tone(o, f, i * 0.14, i === 3 ? 0.7 : 0.2, 0.14, 'triangle'))],
      ['Bells', (o) => notes(o, [[1047, 0.4], [1319, 0.4], [1568, 0.4], [2093, 0.9]], 0.16, 0.08, 'sine')],
      ['Trumpets', (o) => [392, 523, 659, 784].forEach((f, i) => slide(o, f, f, i * 0.16, i === 3 ? 0.7 : 0.18, 0.08))],
    ], // prettier-ignore
  },
};

/* ---------- Playing them ---------- */

const MASTER = 0.8;

/** A sound's switch, volume and style for this player, with the defaults filled in. */
export function soundPref(prefs: SoundPrefs | undefined, id: SoundId) {
  const p = prefs?.each?.[id];
  const info = SOUNDS[id];
  return {
    on: p?.on ?? info.on,
    vol: p?.vol ?? info.vol,
    style: Math.min(info.styles.length - 1, p?.style ?? 0),
  };
}
export const masterVolume = (prefs: SoundPrefs | undefined) => prefs?.master ?? MASTER;

function render(id: SoundId, style: number, gain: number, n: number) {
  const a = audio();
  if (!a || gain <= 0) return;
  const g = a.createGain();
  // The recipes are written for full volume; this scales them, a little louder than linear.
  g.gain.value = gain * gain * 2;
  g.connect(a.destination);
  SOUNDS[id].styles[style]![1]({ a, to: g, t: a.currentTime + 0.01 }, n);
}

/**
 * Play a sound for this player, if they want it: "Your turn sound" covers the turn chime and
 * "Game sounds" every other sound (SPEC 5.9); then the sound's own switch and volume (9.4).
 * `n` is how many (card ticks).
 */
export function hear(id: SoundId, settings: PlayerSettings | null | undefined, n = 1) {
  const master = id === 'turn' ? settings?.turnSound !== false : settings?.gameSounds !== false;
  const p = soundPref(settings?.sounds, id);
  const gain = masterVolume(settings?.sounds) * p.vol;
  if (!master || !p.on || gain <= 0) return;
  played.push(id);
  render(id, p.style, gain, Math.max(1, Math.min(n, 10)));
}

/** The ▶ button: play one style at a volume, whatever the switches say. */
export function preview(id: SoundId, style: number, gain: number) {
  render(id, style, gain, 3);
}

/**
 * The sounds a batch of new log events makes, for the player at seat `me` (SPEC 9.4). The
 * dice, your turn and the win are played by the dice, the prompt and the celebration; chat by
 * the log.
 */
export function soundsFor(events: readonly (GameEvent | LogNote)[], me: Seat | null): [SoundId, number][] {
  const out = new Map<SoundId, number>();
  const add = (id: SoundId, n = 1) => out.set(id, (out.get(id) ?? 0) + n);
  const count = (c: Partial<Record<string, number>> | null | undefined) =>
    Object.values(c ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);
  for (const e of events) {
    switch (e.k) {
      case 'produce':
      case 'commodities':
        add(
          'cards',
          Object.values(e.gains).reduce((a, g) => a + count(g), 0),
        );
        break;
      case 'setup':
        add('settlement');
        if (e.got) add('cards', count(e.got));
        break;
      case 'gold':
      case 'plenty':
        add('cards', count(e.got));
        break;
      case 'steal':
        add('steal');
        break;
      case 'build':
        add(e.what === 'city' ? 'city' : e.what === 'settlement' ? 'settlement' : 'road');
        break;
      case 'wall':
        add('city');
        break;
      case 'moveShip':
        add('shipMove');
        break;
      case 'robber':
      case 'pirate':
        add('robber');
        break;
      case 'buyDev':
      case 'draw':
        add('buyCard');
        break;
      case 'playDev':
      case 'progress':
        add('playCard');
        break;
      case 'trade':
      case 'bank':
        add('trade');
        break;
      case 'discard':
        add('discard');
        break;
      case 'knight':
      case 'activate':
      case 'activateAll':
      case 'promote':
        add('knight');
        break;
      case 'barbarians':
        if (e.at < 7) add('barbarians');
        break;
      case 'attack':
        // D3: the sad tune for whoever lost a city, the horn for everyone else.
        if (e.strength > e.defense) add(me != null && e.losers.includes(me) ? 'sad' : 'horn');
        else add('defended');
        break;
      case 'longest':
        if (e.p != null) add('award');
        break;
      case 'largest':
        add('award');
        break;
    }
  }
  return [...out];
}

/** A browser notification while the tab is in the background (SPEC 5.9, opt-in). */
export function notify(text: string) {
  try {
    if (!document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted')
      return;
    new Notification('Settlers', { body: text, tag: 'settlers-turn' });
  } catch {
    /* not available */
  }
}

export async function askNotifyPermission(): Promise<boolean> {
  try {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}
