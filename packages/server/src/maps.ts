/*
 * Saved maps and generator presets (docs/maps.md 4.4, 5.18), shared by everyone on the site.
 * Every map is checked as in 3.1 before it's stored, and stored as the editor sees it
 * (normalized), so loading it back gives the same file.
 */

import { randomUUID } from 'node:crypto';
import { BUILTIN_PRESETS, mapProblems, normalize, type GenRules, type MapData } from '@settlers/engine';
import type { MapInfo, PresetInfo, ServerMsg } from './protocol';
import { nickKey, type MapRow, type Store } from './store';

interface Sender {
  send(msg: ServerMsg): void;
}

const info = (r: MapRow): MapInfo => {
  const m = r.map as MapData;
  return {
    id: r.id,
    name: r.name,
    by: r.madeBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    players: m.players,
    seafarers: m.modules.includes('seafarers'),
    hexes: m.hexes.map((h) => ({ q: h.q, r: h.r, t: h.t, n: typeof h.n === 'number' ? h.n : 0 })),
  };
};

export class MapLibrary {
  constructor(
    private store: Store,
    private now: () => number,
    private log: (m: string) => void,
  ) {}

  list(): MapInfo[] {
    return this.store.maps().map(info);
  }

  get(c: Sender, id: string) {
    const r = this.store.mapById(id);
    if (!r) return c.send({ t: 'error', text: 'That map isn’t there any more' });
    c.send({ t: 'map', map: r.map as MapData, info: info(r) });
  }

  /** The map as stored, or the reason it can't be. */
  private check(map: MapData): { ok: true; map: MapData } | { ok: false; error: string } {
    let m: MapData;
    try {
      m = normalize(map);
    } catch {
      return { ok: false, error: 'This map can’t be read' };
    }
    const bad = mapProblems(m);
    if (bad.length) return { ok: false, error: `This map can’t be saved: ${bad[0]}` };
    return { ok: true, map: m };
  }

  /** "Name", or "Name (2)", "Name (3)"… whichever is free. */
  private freeName(name: string, except?: string): string {
    const base = name.trim().replace(/ \(\d+\)$/, '');
    if (!this.store.mapNameTaken(name, except)) return name.trim();
    for (let i = 2; ; i++) {
      const n = `${base.slice(0, 34)} (${i})`;
      if (!this.store.mapNameTaken(n, except)) return n;
    }
  }

  /** Save a map from the editor: an existing id updates it, anything else makes a new one. */
  save(c: Sender, map: MapData, by?: string) {
    const checked = this.check(map);
    if (!checked.ok) return c.send({ t: 'error', text: checked.error });
    const old = this.store.mapById(map.id);
    const id = old ? old.id : `m-${randomUUID()}`;
    if (this.store.mapNameTaken(map.name, id))
      return c.send({ t: 'error', text: `There’s already a map called “${map.name.trim()}”` });
    this.put(c, { ...checked.map, id }, old ? (old.madeBy ?? null) : (by ?? null), old?.createdAt);
  }

  /** Import a file (3.3): always a new map; a taken name gets a number. */
  import(c: Sender, map: MapData, by?: string) {
    const checked = this.check(map);
    if (!checked.ok) return c.send({ t: 'error', text: checked.error });
    const id = `m-${randomUUID()}`;
    this.put(c, { ...checked.map, id, name: this.freeName(map.name) }, by ?? map.made?.by ?? null);
  }

  rename(c: Sender, id: string, name: string) {
    const r = this.store.mapById(id);
    if (!r) return c.send({ t: 'error', text: 'That map isn’t there any more' });
    if (this.store.mapNameTaken(name, id))
      return c.send({ t: 'error', text: `There’s already a map called “${name.trim()}”` });
    this.put(c, { ...(r.map as MapData), name: name.trim() }, r.madeBy, r.createdAt);
  }

  duplicate(c: Sender, id: string, by?: string) {
    const r = this.store.mapById(id);
    if (!r) return c.send({ t: 'error', text: 'That map isn’t there any more' });
    const copy = { ...(r.map as MapData), id: `m-${randomUUID()}`, name: this.freeName(`${r.name} (copy)`) };
    this.put(c, copy, by ?? null);
  }

  delete(c: Sender, id: string) {
    const r = this.store.mapById(id);
    if (!r) return c.send({ t: 'error', text: 'That map isn’t there any more' });
    this.store.deleteMap(id, this.now());
    this.log(`map ${id} (${r.name}) deleted`);
    c.send({ t: 'maps', list: this.list() });
  }

  private put(c: Sender, map: MapData, by: string | null, createdAt?: number) {
    const at = this.now();
    const row: MapRow = {
      id: map.id,
      name: map.name,
      map,
      madeBy: by,
      createdAt: createdAt ?? at,
      updatedAt: at,
    };
    this.store.putMap(row);
    c.send({ t: 'map', map, info: info(row), saved: true });
    c.send({ t: 'maps', list: this.list() });
  }

  /* ---------- Presets ---------- */

  presets(): PresetInfo[] {
    return [
      ...BUILTIN_PRESETS.map((p) => ({
        id: `builtin:${nickKey(p.name)}`,
        name: p.name,
        rules: p.rules,
        builtIn: true,
        by: null,
      })),
      ...this.store.presets().map((p) => ({
        id: p.id,
        name: p.name,
        rules: p.rules as GenRules,
        builtIn: false,
        by: p.madeBy,
      })),
    ];
  }

  /** The rules of a preset by id or name, falling back to "Our rules". */
  rulesOf(id: string): { name: string; rules: GenRules } {
    const p = this.presets().find((x) => x.id === id || nickKey(x.name) === nickKey(id));
    return p
      ? { name: p.name, rules: p.rules }
      : { name: BUILTIN_PRESETS[0]!.name, rules: BUILTIN_PRESETS[0]!.rules };
  }

  savePreset(c: Sender, id: string | undefined, name: string, rules: GenRules, by?: string) {
    if (
      BUILTIN_PRESETS.some((p) => nickKey(p.name) === nickKey(name)) ||
      this.store.presetNameTaken(name, id)
    )
      return c.send({ t: 'error', text: `There’s already a preset called “${name.trim()}”` });
    if (id?.startsWith('builtin:')) return c.send({ t: 'error', text: 'Built-in presets can’t be changed' });
    const old = id ? this.store.presets().find((p) => p.id === id) : undefined;
    this.store.putPreset({
      id: old?.id ?? `p-${randomUUID()}`,
      name: name.trim(),
      rules,
      madeBy: old?.madeBy ?? by ?? null,
      createdAt: old?.createdAt ?? this.now(),
    });
    c.send({ t: 'presets', list: this.presets() });
  }

  deletePreset(c: Sender, id: string) {
    if (id.startsWith('builtin:')) return c.send({ t: 'error', text: 'Built-in presets can’t be deleted' });
    this.store.deletePreset(id, this.now());
    c.send({ t: 'presets', list: this.presets() });
  }
}
