/*
 * Custom CPUs (docs/bot-medium-hard.md §5.2): a name, a base level and the sliders, shared by
 * everyone on the site like maps and presets. A seat that picks one keeps a copy of its
 * personality, so editing or deleting it never changes a game already set up.
 */

import { randomUUID } from 'node:crypto';
import { HARD, MEDIUM, isPersona, type CpuBrain, type CpuLevel, type Persona } from '@settlers/engine';
import type { CpuInfo, ServerMsg } from './protocol';
import { nickKey, type Store } from './store';

interface Sender {
  send(msg: ServerMsg): void;
}

const BUILT_IN = ['easy', 'medium', 'hard'] as const;
export const LEVEL_NAME: Record<CpuLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
export const isLevel = (l: string): l is CpuLevel => (BUILT_IN as readonly string[]).includes(l);

/** What plays a CPU seat: a built-in level, or a custom CPU's saved personality. */
export function brainOf(level: string | undefined, persona: Persona | undefined): CpuBrain {
  if (level === 'medium') return MEDIUM;
  if (level === 'hard') return HARD;
  if (level?.startsWith('c-') && persona && isPersona(persona)) return persona;
  return 'easy';
}

export class CpuLibrary {
  constructor(
    private store: Store,
    private now: () => number = Date.now,
  ) {}

  list(): CpuInfo[] {
    return this.store.cpus().map((c) => ({ id: c.id, name: c.name, persona: c.persona, by: c.madeBy }));
  }

  get(id: string): CpuInfo | null {
    return this.list().find((c) => c.id === id) ?? null;
  }

  save(c: Sender, id: string | undefined, rawName: string, persona: Persona, by?: string): CpuInfo | null {
    const name = rawName.trim();
    if (!name) {
      c.send({ t: 'error', text: 'Give it a name' });
      return null;
    }
    if (!isPersona(persona)) {
      c.send({ t: 'error', text: 'That isn’t a CPU' });
      return null;
    }
    if (BUILT_IN.some((l) => nickKey(LEVEL_NAME[l]) === nickKey(name)) || this.store.cpuNameTaken(name, id)) {
      c.send({ t: 'error', text: `There’s already a CPU called “${name}”` });
      return null;
    }
    const old = id ? this.store.cpus().find((x) => x.id === id) : undefined;
    if (id && !old) {
      c.send({ t: 'error', text: 'That CPU is gone' });
      return null;
    }
    const row = {
      id: old?.id ?? `c-${randomUUID().slice(0, 18)}`,
      name,
      persona,
      madeBy: old?.madeBy ?? by ?? null,
      createdAt: old?.createdAt ?? this.now(),
    };
    this.store.putCpu(row);
    return { id: row.id, name: row.name, persona: row.persona, by: row.madeBy };
  }

  delete(c: Sender, id: string): boolean {
    if (!this.store.cpus().some((x) => x.id === id)) {
      c.send({ t: 'error', text: 'That CPU is gone' });
      return false;
    }
    this.store.deleteCpu(id, this.now());
    return true;
  }
}
