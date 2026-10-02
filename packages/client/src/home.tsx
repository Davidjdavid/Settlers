/* The start screen (create or join a room, saved games, stats) and the profile picker (SPEC 5.1, 5.7). */

import { useEffect, useState } from 'react';
import { PLAYER_COLORS, geometryFor, type Color, type Terrain } from '@settlers/engine';
import type { ProfileInfo, SavedGame } from '@settlers/server/protocol';
import { BRAND_SVG, K, PCOL, PNAME, TILE_COLOR, hexPts } from './art';
import { client, getStored, useClient } from './net';
import { ConfirmTwice } from './Sheets';

export const MODE_NAME: Record<string, string> = {
  base: 'Base game',
  seafarers: 'Seafarers',
  knights: 'Knights',
  full: 'Full game',
};

export function Brand() {
  return (
    <div className="brand" style={{ marginBottom: 14 }}>
      <span dangerouslySetInnerHTML={{ __html: BRAND_SVG }} style={{ display: 'contents' }} />
      <span>Settlers</span>
    </div>
  );
}

/** A small picture of a board's tiles. */
export function MapPreview({
  hexes,
  size = 120,
}: {
  hexes: { q: number; r: number; t: string }[];
  size?: number;
}) {
  const g = geometryFor(hexes);
  const xs = g.hexes.map((h) => h.x * K);
  const ys = g.hexes.map((h) => h.y * K);
  const pad = K;
  const vb = [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) - Math.min(...xs) + 2 * pad,
    Math.max(...ys) - Math.min(...ys) + 2 * pad,
  ];
  return (
    <svg
      className="mappreview"
      viewBox={vb.join(' ')}
      width={size}
      height={(size * vb[3]!) / vb[2]!}
      aria-hidden="true"
    >
      {hexes.map((h, i) => (
        <polygon
          key={i}
          points={hexPts(g.hexes[i]!.x * K, g.hexes[i]!.y * K, 0.96 * K)}
          fill={h.t === 'random' ? '#3a4a52' : (TILE_COLOR[h.t as Terrain] ?? '#1f5f73')}
        />
      ))}
    </svg>
  );
}

export function Home({ error }: { error: string | null }) {
  const st = useClient();
  const [code, setCode] = useState('');
  const [del, setDel] = useState<SavedGame | null>(null);
  useEffect(() => {
    if (st.status === 'live') client.loadSaved();
  }, [st.status]);
  const saved = st.saved ?? [];
  return (
    <div className="center">
      <div className="card">
        <Brand />
        <h2>Start or join a game</h2>
        <p className="lede">Create a room and share the code, or enter a friend’s code.</p>
        <div className="row" style={{ marginBottom: 16 }}>
          <button className="btn primary" onClick={() => client.createRoom()} data-testid="create">
            Create a room
          </button>
          <button className="btn" onClick={() => client.go('/stats')} data-testid="open-stats">
            Stats
          </button>
          <button className="btn" onClick={() => client.go('/maps')} data-testid="open-maps">
            Maps
          </button>
          <button className="btn" onClick={() => client.go('/cpus')} data-testid="open-cpus">
            CPU players
          </button>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c) {
              history.pushState(null, '', `/r/${c}`);
              client.openRoom(c);
            }
          }}
        >
          <input
            className="text codein"
            placeholder="CODE"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, ''))}
            aria-label="Room code"
          />
          <button className="btn" disabled={!code}>
            Join
          </button>
        </form>
        {error ? <p className="err">{error}</p> : null}
        <div className="field" style={{ marginTop: 18 }}>
          <label>Saved games</label>
          {saved.length ? (
            <div className="savedlist" data-testid="saved">
              {saved.map((g) => (
                <div className="saved" key={g.id} data-testid="saved-game">
                  <MapPreview hexes={g.hexes} size={92} />
                  <div className="info">
                    <b>{MODE_NAME[g.mode]}</b>
                    <span className="sub">
                      {new Date(g.lastAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      {g.room ? ` · open in room ${g.room}` : ''}
                    </span>
                    <span className="scores">
                      {g.players.map((p, i) => (
                        <span key={i} className="who">
                          <span className="dot" style={{ background: PCOL[p.color] }} />
                          {p.name}
                          {p.cpu ? ' (CPU)' : ''} <b>{p.vp}</b>
                        </span>
                      ))}
                    </span>
                  </div>
                  <div className="acts">
                    <button
                      className="btn small primary"
                      onClick={() => client.resume(g.id)}
                      data-testid="resume"
                    >
                      Resume
                    </button>
                    <button className="btn small ghost" onClick={() => setDel(g)} data-testid="delete-saved">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">
              No saved games. Games save after every move; “Save and quit” in the menu ends a night.
            </p>
          )}
        </div>
      </div>
      {del ? (
        <ConfirmTwice
          title="Delete this saved game?"
          first={`The ${MODE_NAME[del.mode]} with ${del.players.map((p) => p.name).join(', ')} will be gone from the list.`}
          second="It can’t be resumed after this. It never counted in the stats, since nobody won it."
          action="Delete it"
          onConfirm={() => client.deleteSaved(del.id)}
          onClose={() => setDel(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Pick who you are (SPEC 5.1): the list of profiles, this browser's last pick first, or a new
 * profile (a name and a favourite colour).
 */
export function ProfilePicker({
  value,
  onPick,
  here,
}: {
  value: string | null;
  onPick: (p: ProfileInfo) => void;
  /**
   * Profiles seated at this table: always pickable, to get your seat back (even from a screen
   * that still has it). Profiles in use at another table can't be picked.
   */
  here?: Set<string>;
}) {
  const st = useClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<Color>('red');
  useEffect(() => {
    if (st.status === 'live') client.loadProfiles();
  }, [st.status]);
  const last = getStored('settlers.profile');
  const list = [...(st.profiles ?? [])].sort((a, b) => (a.id === last ? -1 : b.id === last ? 1 : 0));
  // A profile just made in this browser is picked straight away.
  useEffect(() => {
    if (!value && last && list.some((p) => p.id === last && !p.inUse))
      onPick(list.find((p) => p.id === last)!);
  }, [st.profiles]);
  return (
    <div className="profiles" data-testid="profiles">
      {list.map((p) => (
        <button
          type="button"
          key={p.id}
          className={`profile${value === p.id ? ' on' : ''}`}
          aria-pressed={value === p.id}
          disabled={p.inUse && !here?.has(p.id) && value !== p.id}
          data-testid="profile"
          data-name={p.name}
          onClick={() => onPick(p)}
        >
          <span className="dot" style={{ background: PCOL[p.color] }} />
          {p.name}
          {here?.has(p.id) ? <small> at this table</small> : p.inUse ? <small> in use</small> : null}
        </button>
      ))}
      {adding ? (
        <div className="newprofile">
          <input
            className="text"
            maxLength={18}
            placeholder="Your name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            data-testid="new-name"
          />
          <select
            value={color}
            onChange={(e) => setColor(e.target.value as Color)}
            aria-label="Favourite colour"
            data-testid="new-color"
          >
            {PLAYER_COLORS.map((c) => (
              <option key={c} value={c}>
                {PNAME[c]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn small primary"
            disabled={!name.trim()}
            data-testid="new-save"
            onClick={() => {
              client.newProfile(name.trim(), color);
              setAdding(false);
              setName('');
            }}
          >
            Add
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="profile add"
          onClick={() => setAdding(true)}
          data-testid="new-profile"
        >
          + New name
        </button>
      )}
    </div>
  );
}
