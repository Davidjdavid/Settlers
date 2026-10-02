/* Saved maps and presets on the server (docs/maps.md 3.3, 4.4, 5.18, 6.3-6.4). */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyEdit,
  CLASSIC_MAP,
  coastalSides,
  fillRest,
  OUR_RULES,
  standardBlank,
  type MapData,
} from '@settlers/engine';
import { ClientMsgSchema, type ClientMsg, type ServerMsg } from '../src/protocol';
import { Rooms, type Conn } from '../src/rooms';
import { Store } from '../src/store';

class FakeConn implements Conn {
  room: Conn['room'] = null;
  pid: string | null = null;
  msgs: ServerMsg[] = [];
  send(m: ServerMsg) {
    this.msgs.push(structuredClone(m));
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> {
    const m = [...this.msgs].reverse().find((x) => x.t === t);
    if (!m) throw new Error(`no ${t} message`);
    return m as Extract<ServerMsg, { t: T }>;
  }
}

let dir: string;
let store: Store;
let rooms: Rooms;
let clock = 1000;
const open = () => (rooms = new Rooms(store, { log: () => {}, now: () => clock++ }));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settlers-maps-'));
  store = new Store(join(dir, 'test.db'));
  open();
});
afterEach(() => {
  rooms.stop();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Send a message through the same validation the WebSocket uses. */
function send(c: FakeConn, msg: unknown) {
  const parsed = ClientMsgSchema.safeParse(JSON.parse(JSON.stringify(msg)));
  if (!parsed.success) throw new Error(`rejected: ${parsed.error.message}`);
  rooms.handle(c, parsed.data as ClientMsg);
}
const edit = (m: MapData, op: Parameters<typeof applyEdit>[1]) => {
  const r = applyEdit(m, op);
  if (!r.ok) throw new Error(r.error);
  return r.map;
};
function aMap(name = 'Ring island'): MapData {
  let m = standardBlank(CLASSIC_MAP, 'new', name);
  m = edit(m, { k: 'terrain', at: [0, 0], t: 'ore' });
  m = edit(m, { k: 'number', at: [0, 0], n: 5 });
  m = edit(m, { k: 'lock', at: [0, 0], what: 'n', on: true });
  return m;
}

describe('saved maps', () => {
  it('save, list, open: the same file comes back, and survives a restart', () => {
    const c = new FakeConn();
    send(c, { t: 'saveMap', map: aMap(), by: 'Ann' });
    const saved = c.last('map');
    expect(saved.saved).toBe(true);
    expect(saved.map.id).toMatch(/^m-/);
    expect(saved.info).toMatchObject({
      name: 'Ring island',
      by: 'Ann',
      players: [2, 3, 4],
      seafarers: false,
    });
    expect(c.last('maps').list.map((m) => m.name)).toEqual(['Ring island']);
    const file = JSON.stringify(saved.map);
    // Save again unchanged: byte-identical.
    send(c, { t: 'saveMap', map: saved.map });
    expect(JSON.stringify(c.last('map').map)).toBe(file);
    rooms.stop();
    store.close();
    store = new Store(join(dir, 'test.db'));
    open();
    send(c, { t: 'getMap', id: saved.map.id });
    expect(JSON.stringify(c.last('map').map)).toBe(file);
  });

  it('editing a saved map keeps its id; a new map with a taken name is refused', () => {
    const c = new FakeConn();
    send(c, { t: 'saveMap', map: aMap(), by: 'Ann' });
    const first = c.last('map').map;
    const changed = edit(first, { k: 'terrain', at: [1, 0], t: 'wheat' });
    send(c, { t: 'saveMap', map: changed, by: 'Bob' });
    const second = c.last('map');
    expect(second.map.id).toBe(first.id);
    expect(second.info.by).toBe('Ann');
    send(c, { t: 'saveMap', map: aMap('ring  ISLAND') });
    expect(c.last('error').text).toBe('There’s already a map called “ring  ISLAND”');
  });

  it('rename, duplicate and delete', () => {
    const c = new FakeConn();
    send(c, { t: 'saveMap', map: aMap(), by: 'Ann' });
    const id = c.last('map').map.id;
    send(c, { t: 'renameMap', id, name: 'Donut' });
    expect(c.last('maps').list.map((m) => m.name)).toEqual(['Donut']);
    send(c, { t: 'duplicateMap', id, by: 'Bob' });
    send(c, { t: 'duplicateMap', id, by: 'Bob' });
    expect(
      c
        .last('maps')
        .list.map((m) => m.name)
        .sort(),
    ).toEqual(['Donut', 'Donut (copy)', 'Donut (copy) (2)']);
    send(c, { t: 'deleteMap', id });
    expect(
      c
        .last('maps')
        .list.map((m) => m.name)
        .sort(),
    ).toEqual(['Donut (copy)', 'Donut (copy) (2)']);
    send(c, { t: 'getMap', id });
    expect(c.last('error').text).toBe('That map isn’t there any more');
  });

  it('import makes a new map, numbering a taken name; export and import give the same board', () => {
    const c = new FakeConn();
    const filled = fillRest(aMap(), OUR_RULES, 'export', 4);
    if (!filled.ok) throw new Error(filled.error);
    send(c, { t: 'saveMap', map: filled.map });
    const exported = c.last('map').map;
    send(c, { t: 'importMap', map: JSON.parse(JSON.stringify(exported)) });
    const imported = c.last('map').map;
    expect(imported.id).not.toBe(exported.id);
    expect(imported.name).toBe('Ring island (2)');
    expect(imported.hexes).toEqual(exported.hexes);
    expect(imported.harbors).toEqual(exported.harbors);
  });

  it('refuses bad files: by the schema, and by the map rules', () => {
    const c = new FakeConn();
    const m = aMap();
    expect(() => send(c, { t: 'importMap', map: { ...m, hexes: [{ q: 0, r: 0, t: 'lava' }] } })).toThrow(
      /rejected/,
    );
    expect(() => send(c, { t: 'importMap', map: { ...m, extra: 1 } })).toThrow(/rejected/);
    // A second harbor on a coastal side next to an existing one: they share a corner.
    const side = coastalSides(m).find((s) =>
      m.harbors.some((h) => h.q === s.at[0] && h.r === s.at[1] && Math.abs(h.side - s.side) === 1),
    )!;
    send(c, {
      t: 'importMap',
      map: { ...m, harbors: [...m.harbors, { q: side.at[0], r: side.at[1], side: side.side, t: 'any' }] },
    });
    expect(c.last('error').text).toBe('This map can’t be saved: two harbors share a corner');
    send(c, { t: 'importMap', map: { ...m, hexes: [...m.hexes, m.hexes[0]!] } });
    expect(c.last('error').text).toMatch(/^This map can’t be saved: duplicate hex/);
    expect(c.msgs.some((x) => x.t === 'maps')).toBe(false);
  });
});

describe('presets', () => {
  it('lists the built-in ones, adds, renames and deletes others, and protects the built-ins', () => {
    const c = new FakeConn();
    send(c, { t: 'presets' });
    expect(c.last('presets').list.map((p) => [p.name, p.builtIn])).toEqual([
      ['Our rules', true],
      ['Anything goes', true],
    ]);
    send(c, { t: 'savePreset', name: 'Tight', rules: { ...OUR_RULES, bestSpot: 11 }, by: 'Ann' });
    const tight = c.last('presets').list.find((p) => p.name === 'Tight')!;
    expect(tight.rules.bestSpot).toBe(11);
    send(c, { t: 'savePreset', id: tight.id, name: 'Tighter', rules: { ...OUR_RULES, bestSpot: 10 } });
    expect(c.last('presets').list.find((p) => p.id === tight.id)).toMatchObject({
      name: 'Tighter',
      by: 'Ann',
    });
    send(c, { t: 'savePreset', name: 'our rules', rules: OUR_RULES });
    expect(c.last('error').text).toBe('There’s already a preset called “our rules”');
    send(c, { t: 'deletePreset', id: c.last('presets').list[0]!.id });
    expect(c.last('error').text).toBe('Built-in presets can’t be deleted');
    send(c, { t: 'deletePreset', id: tight.id });
    expect(c.last('presets').list).toHaveLength(2);
  });
});
