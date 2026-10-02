/*
 * The CPU page (docs/bot-medium-hard.md §5): how Easy, Medium, Hard and your custom CPUs play,
 * side by side, and the custom CPU maker. Custom CPUs are shared with everyone, like maps.
 */

import { useEffect, useState } from 'react';
import { HARD, MEDIUM, PERSONA_CHOICES, type Persona } from '@settlers/engine';
import type { CpuInfo } from '@settlers/server/protocol';
import { Brand } from './home';
import { client, useClient } from './net';
import { ConfirmTwice, Sheet } from './Sheets';

type Row = 'start' | 'build' | 'robber' | 'trade' | 'cards';
const ROWS: { k: Row; label: string }[] = [
  { k: 'start', label: 'Where it starts' },
  { k: 'build', label: 'What it builds' },
  { k: 'robber', label: 'When and whom it robs' },
  { k: 'trade', label: 'How it trades' },
  { k: 'cards', label: 'How it uses cards' },
];

const EASY: Record<Row, string> = {
  start: 'A random legal corner.',
  build: 'Rarely: one thing on about one turn in four (a city, then a settlement, then a road).',
  robber: 'Never robs a person if it can help it: an empty hex first, then one only it uses.',
  trade:
    'Never trades with people and turns down every offer. Uses the bank toward a city and to keep its hand small.',
  cards: 'Only harmless cards. Never Monopoly, never cards that hurt someone.',
};

/** Slider labels, as on the maker. */
export const SLIDER: { [K in keyof Persona]: { label: string; names: Record<Persona[K], string> } } = {
  base: { label: 'Base level', names: { medium: 'Medium', hard: 'Hard' } },
  robber: {
    label: 'Robber',
    names: { gentle: 'Gentle (like Easy)', late: 'Only near the end', leader: 'Always the leader' },
  },
  trading: {
    label: 'Trading',
    names: { never: 'Never', fair: 'Fair only', generous: 'Generous', shrewd: 'Shrewd' },
  },
  style: {
    label: 'Building style',
    names: {
      cities: 'Cities first',
      settlements: 'Settlements and roads',
      cards: 'Development cards',
      balanced: 'Balanced',
    },
  },
  focus: {
    label: 'Longest Road, Army, metropolis',
    names: { ignore: 'Ignore', normal: 'Normal', chase: 'Chase hard' },
  },
  timing: { label: 'Card timing', names: { soon: 'As soon as useful', hold: 'Hold for the best moment' } },
  chatter: { label: 'Chatter', names: { off: 'Off', quiet: 'Quiet', chatty: 'Chatty' } },
};

/** How a personality plays, in plain words, row by row. */
export function describe(p: Persona): Record<Row, string> {
  const start =
    p.base === 'hard'
      ? 'Rich corners with a good mix, and it thinks ahead about which second spot will still be free.'
      : 'Rich corners with a good mix: brick and wood first, ore and wheat second, harbors that fit.';
  const style = {
    balanced: 'A city, then a settlement, then a road toward the best open spot, then a card.',
    cities: 'Cities first, then cards, then settlements and roads.',
    settlements: 'Settlements and the roads to reach them first, then cities.',
    cards: 'Development cards first, then cities.',
  }[p.style];
  const plan =
    p.base === 'hard'
      ? ' It plans: it picks what’s worth most for how many turns it will take to afford.'
      : ' It saves up, and trades with the bank to finish a build.';
  const robber = {
    gentle: EASY.robber,
    late: 'Like Easy until someone is within 3 points of winning; then the leader’s best hex.',
    leader:
      p.base === 'hard'
        ? 'Always the real leader, counting likely hidden points and production, people included.'
        : 'Always whoever is ahead on points, people included.',
  }[p.robber];
  const trade = {
    never: 'Never trades with people and turns down every offer. Still uses the bank.',
    fair: 'Takes fair offers that help its next build, and makes at most one fair offer a turn. Never trades with someone about to win.',
    generous:
      'Takes offers that help it even when it gives a card more, and offers 2 for 1. Never trades with someone about to win.',
    shrewd:
      'Trades only when it comes out ahead, never with the leader, and asks for what others probably have (it counts cards).',
  }[p.trading];
  const timing =
    p.timing === 'hold'
      ? 'Holds cards for the best moment: Monopoly when others hold lots, a Knight to take Largest Army.'
      : 'Plays a card as soon as it helps: a Knight when robbed, Road Building toward a spot, Year of Plenty to finish a build.';
  const focus = {
    ignore: ' Doesn’t chase Longest Road, Largest Army or metropolises.',
    normal: '',
    chase: ' Chases Longest Road, Largest Army and metropolises hard.',
  }[p.focus];
  return { start, build: style + plan, robber, trade, cards: timing + focus };
}

const BUILT_IN: { name: string; rows: Record<Row, string> }[] = [
  { name: 'Easy', rows: EASY },
  { name: 'Medium', rows: describe(MEDIUM) },
  { name: 'Hard', rows: describe(HARD) },
];

export function CpusPage() {
  const st = useClient();
  const [edit, setEdit] = useState<{ id?: string; name: string; persona: Persona } | null>(null);
  const [del, setDel] = useState<CpuInfo | null>(null);
  useEffect(() => {
    if (st.status === 'live') {
      client.loadCpus();
      client.loadProfiles();
    }
  }, [st.status]);
  const custom = st.cpus ?? [];
  const cols = [...BUILT_IN, ...custom.map((c) => ({ name: c.name, rows: describe(c.persona) }))];
  return (
    <div className="center cpuspage">
      <div className="card wide" data-testid="cpus-page">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Brand />
          <button className="btn small" onClick={() => client.go('/')}>
            Back
          </button>
        </div>
        <h2>CPU players</h2>
        <p className="lede">
          How each CPU plays. Every CPU sees only its own screen, exactly what a person in its seat would see.
          Custom CPUs are shared with everyone.
        </p>
        <div className="cpucompare" data-testid="cpu-compare">
          <table>
            <thead>
              <tr>
                <th />
                {cols.map((c) => (
                  <th key={c.name} scope="col">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.k}>
                  <th scope="row">{r.label}</th>
                  {cols.map((c) => (
                    <td key={c.name} data-testid={`cpu-${r.k}`}>
                      {c.rows[r.k]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Your CPUs</h3>
        {custom.length ? (
          <ul className="cpulist" data-testid="cpu-list">
            {custom.map((c) => (
              <li key={c.id} data-testid="cpu-item" data-name={c.name}>
                <div>
                  <b>{c.name}</b>
                  <span className="muted">
                    {' '}
                    · {SLIDER.base.names[c.persona.base]}
                    {c.by ? ` · made by ${c.by}` : ''}
                  </span>
                </div>
                <div className="row">
                  <button
                    className="btn small"
                    onClick={() => setEdit({ id: c.id, name: c.name, persona: c.persona })}
                    data-testid="cpu-edit"
                  >
                    Edit
                  </button>
                  <button className="btn small" onClick={() => setDel(c)} data-testid="cpu-delete">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None yet. Make one to pick it for any CPU seat.</p>
        )}
        <button
          className="btn primary"
          onClick={() => setEdit({ name: '', persona: { ...MEDIUM } })}
          data-testid="new-cpu"
        >
          New CPU
        </button>
      </div>
      {edit ? (
        <CpuMaker
          start={edit}
          onClose={() => setEdit(null)}
          onSave={(name, persona) => {
            client.saveCpu(edit.id, name, persona);
            setEdit(null);
          }}
        />
      ) : null}
      {del ? (
        <ConfirmTwice
          title={`Delete “${del.name}”?`}
          first="It’ll be gone from the CPU list for everyone."
          second="Seats already playing as it keep playing that way until their game ends. Delete it?"
          action="Delete it"
          onConfirm={() => client.deleteCpu(del.id)}
          onClose={() => setDel(null)}
        />
      ) : null}
    </div>
  );
}

function CpuMaker({
  start,
  onClose,
  onSave,
}: {
  start: { id?: string; name: string; persona: Persona };
  onClose: () => void;
  onSave: (name: string, persona: Persona) => void;
}) {
  const [name, setName] = useState(start.name);
  const [p, setP] = useState<Persona>(start.persona);
  const keys = Object.keys(PERSONA_CHOICES) as (keyof Persona)[];
  const ok = name.trim().length > 0 && name.trim().length <= 24;
  return (
    <Sheet title={start.id ? `Edit ${start.name}` : 'New CPU'} onClose={onClose}>
      <label className="field">
        <span className="eyebrow">Name</span>
        <input
          className="text"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          placeholder="Turnip"
          data-testid="cpu-name"
        />
      </label>
      {keys.map((k) => (
        <div className="slider" key={k} data-testid={`cpu-slider-${k}`}>
          <div className="sliderlabel">{SLIDER[k].label}</div>
          <div className="seg cpuseg" role="radiogroup" aria-label={SLIDER[k].label}>
            {(PERSONA_CHOICES[k] as readonly string[]).map((val) => (
              <button
                key={val}
                role="radio"
                aria-checked={p[k] === val}
                className={`btn small${p[k] === val ? ' on' : ''}`}
                onClick={() => setP({ ...p, [k]: val })}
                data-testid={`cpu-${k}-${val}`}
              >
                {(SLIDER[k].names as Record<string, string>)[val]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="cpupreview">
        {ROWS.map((r) => (
          <p key={r.k}>
            <b>{r.label}:</b> {describe(p)[r.k]}
          </p>
        ))}
      </div>
      <div className="row">
        <button
          className="btn primary"
          disabled={!ok}
          onClick={() => onSave(name.trim(), p)}
          data-testid="cpu-save"
        >
          Save
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
