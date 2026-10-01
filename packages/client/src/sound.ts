/*
 * Sounds (SPEC 5.3, 5.9, 5.13), made in the browser with Web Audio (no sound files): the turn
 * chime for whoever needs to act, the dice, building, and the win fanfare. Each respects the
 * player's switches. Browsers only allow sound after the page has been touched or clicked, so
 * the audio starts on the first tap.
 */

export type SoundKind = 'turn' | 'dice' | 'build' | 'fanfare';

let ctx: AudioContext | null = null;
/** What has played, for the end-to-end test. */
export const played: SoundKind[] = [];

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

function tone(
  a: AudioContext,
  freq: number,
  at: number,
  len: number,
  gain = 0.15,
  type: OscillatorType = 'sine',
) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + len + 0.02);
}

function rattle(a: AudioContext, at: number) {
  // A few short clicks of filtered noise: dice tumbling.
  for (let i = 0; i < 6; i++) {
    const t = at + i * 0.07 + Math.random() * 0.02;
    const len = 0.04;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / d.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800 + Math.random() * 1200;
    const g = a.createGain();
    g.gain.value = 0.35;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  }
}

export function play(kind: SoundKind) {
  played.push(kind);
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.01;
  if (kind === 'turn') {
    tone(a, 660, t, 0.25);
    tone(a, 880, t + 0.15, 0.35);
  } else if (kind === 'dice') rattle(a, t);
  else if (kind === 'build') tone(a, 330, t, 0.12, 0.12, 'triangle');
  else if (kind === 'fanfare')
    [523, 659, 784, 1047].forEach((f, i) => tone(a, f, t + i * 0.14, i === 3 ? 0.7 : 0.2, 0.14, 'triangle'));
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
