/*
 * CPU personalities (docs/bot-medium-hard.md). Easy is its own code (cpu.ts) and has no sliders.
 * Medium and Hard are the two built-in personalities; a custom CPU is a name, a base level and
 * the sliders of §5.2. Everything here is plain data, so it can be saved and sent as JSON.
 */

export type CpuBase = 'medium' | 'hard';

export interface Persona {
  /** Hard adds card counting, planning and timing (§3). */
  base: CpuBase;
  /** Gentle: Easy's rule. Late: only once someone is close to winning (Medium). Leader: always. */
  robber: 'gentle' | 'late' | 'leader';
  /** Never; fair only (Medium); generous; shrewd (Hard). */
  trading: 'never' | 'fair' | 'generous' | 'shrewd';
  /** What it builds first. */
  style: 'cities' | 'settlements' | 'cards' | 'balanced';
  /** Longest Road, Largest Army and metropolises. */
  focus: 'ignore' | 'normal' | 'chase';
  /** Cards: play as soon as useful (Medium), or hold for the best moment (Hard). */
  timing: 'soon' | 'hold';
  chatter: 'off' | 'quiet' | 'chatty';
}

export const MEDIUM: Persona = {
  base: 'medium',
  robber: 'late',
  trading: 'fair',
  style: 'balanced',
  focus: 'normal',
  timing: 'soon',
  chatter: 'quiet',
};

export const HARD: Persona = {
  base: 'hard',
  robber: 'leader',
  trading: 'shrewd',
  style: 'balanced',
  focus: 'normal',
  timing: 'hold',
  chatter: 'quiet',
};

/** The values each slider can take, in the order the CPU page lists them. */
export const PERSONA_CHOICES = {
  base: ['medium', 'hard'],
  robber: ['gentle', 'late', 'leader'],
  trading: ['never', 'fair', 'generous', 'shrewd'],
  style: ['cities', 'settlements', 'cards', 'balanced'],
  focus: ['ignore', 'normal', 'chase'],
  timing: ['soon', 'hold'],
  chatter: ['off', 'quiet', 'chatty'],
} as const satisfies { [K in keyof Persona]: readonly Persona[K][] };

/** Which brain plays a CPU seat: Easy, or a personality. */
export type CpuBrain = 'easy' | Persona;

/** Room settings that change how CPUs trade with people (§1.2, D4), plus a nudge from the server. */
export interface CpuOptions {
  /** "CPU trading": off means CPUs neither offer nor accept. */
  trading: boolean;
  /** "One CPU offer per turn". */
  oneOffer: boolean;
  /** Its own offer has waited long enough for answers: take what it has, or withdraw it. */
  offerTimeout?: boolean;
}

export const DEFAULT_CPU_OPTIONS: CpuOptions = { trading: true, oneOffer: true };

/** Is this a valid personality (for saved custom CPUs)? */
export function isPersona(x: unknown): x is Persona {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (Object.keys(PERSONA_CHOICES) as (keyof Persona)[]).every((k) =>
    (PERSONA_CHOICES[k] as readonly unknown[]).includes(o[k]),
  );
}
