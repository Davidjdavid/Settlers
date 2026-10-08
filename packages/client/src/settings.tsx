/* "My settings" (per person) and "Table rules" (per game) sheets, SPEC 4.3 and 4.5. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PlayerView, RuleKey } from '@settlers/engine';
import type { PlayerSettings, RoomInfo, SoundId, SoundPrefs } from '@settlers/server/protocol';
import { SIZE_LABEL, applySize, currentSize, type Size } from './display';
import { SOUNDS, askNotifyPermission, masterVolume, preview, soundPref } from './sound';
import {
  DICE_CHOICES,
  Help,
  RULE_HELP,
  SETTING_HELP,
  SETTING_LABEL,
  settingOn,
  type SettingKey,
} from './help';
import { client } from './net';
import { Sheet } from './Sheets';
import { RULE_LABEL } from './text';
import { STYLES, STYLE_HELP, STYLE_LABEL, type ArtStyle } from './themes';

const SETTINGS: SettingKey[] = [
  'confirmPlace',
  'confirmPlaceTouch',
  'confirmEnd',
  'confirmCard',
  'confirmTrade',
  'tradeLimit',
  'noCpuTrades',
  'turnSound',
  'gameSounds',
  'browserNotify',
  'showBreakdown',
  'diceCorner',
];

function Switch(props: {
  on: boolean;
  label: string;
  help: string;
  testid: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="switchrow">
      <input
        type="checkbox"
        role="switch"
        checked={props.on}
        disabled={props.disabled}
        data-testid={props.testid}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.label}</span>
      <Help text={props.help} />
    </label>
  );
}

const STYLE_ONLY_YOU = 'Only changes your screen. Everyone else sees the board in their own style.';

/** The board's art style, saved on your profile (in My settings and at the pre-game table). */
export function StyleSelect({ mine, testid }: { mine: PlayerSettings | null; testid: string }) {
  return (
    <select
      value={mine?.artStyle ?? 'classic'}
      data-testid={testid}
      aria-label="Board style"
      onChange={(e) => client.saveSettings({ ...(mine ?? {}), artStyle: e.target.value as ArtStyle })}
    >
      {STYLES.map((id) => (
        <option key={id} value={id} title={STYLE_HELP[id]}>
          {STYLE_LABEL[id]}
        </option>
      ))}
    </select>
  );
}

/** Your own confirmation switches, saved under your nickname. */
export function SettingsSheet({ mine, onClose }: { mine: PlayerSettings | null; onClose: () => void }) {
  const [page, setPage] = useState<'main' | 'sounds'>('main');
  if (page === 'sounds') return <SoundsSheet mine={mine} onBack={() => setPage('main')} />;
  return (
    <Sheet
      title="My settings"
      sub="Saved under your name, for every game. Only you see them."
      onClose={onClose}
      foot={
        <button className="btn" onClick={onClose} data-testid="settings-close">
          Done
        </button>
      }
    >
      <div className="switches" data-testid="my-settings">
        {SETTINGS.map((k) => (
          <Switch
            key={k}
            on={settingOn(mine, k)}
            label={SETTING_LABEL[k]}
            help={SETTING_HELP[k]}
            testid={`setting-${k}`}
            onChange={(on) => {
              // A browser notification needs the browser's permission first.
              if (k === 'browserNotify' && on)
                void askNotifyPermission().then((ok) =>
                  ok
                    ? client.saveSettings({ ...(mine ?? {}), [k]: true })
                    : client.toast('Your browser said no'),
                );
              else client.saveSettings({ ...(mine ?? {}), [k]: on });
            }}
          />
        ))}
      </div>
      <DisplaySize />
      <div className="switchrow">
        <span>Board style: how the board looks on your screen</span>
        <StyleSelect mine={mine} testid="setting-artStyle" />
        <Help text={STYLE_ONLY_YOU} />
      </div>
      <div className="switchrow">
        <span>Event die with rolls (Knights): “9 blue”, “blue 9”, or leave it out</span>
        <select
          value={mine?.eventDieText ?? 'after'}
          data-testid="setting-eventDieText"
          aria-label="Event die with rolls"
          onChange={(e) =>
            client.saveSettings({
              ...(mine ?? {}),
              eventDieText: e.target.value as 'after' | 'before' | 'off',
            })
          }
        >
          <option value="after">9 blue</option>
          <option value="before">blue 9</option>
          <option value="off">Leave it out</option>
        </select>
      </div>
      <div className="switchrow">
        <span>Sounds: each one’s switch, volume and style</span>
        <button className="btn small" onClick={() => setPage('sounds')} data-testid="sounds-open">
          Sounds…
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The Sounds page (SPEC 9.4): a master volume, and for every sound its switch, volume, style
 * and a ▶ to hear it. Saved on your profile, so it follows you; it only changes what you hear.
 * Sliders save a moment after you stop moving them.
 */
function SoundsSheet({ mine, onBack }: { mine: PlayerSettings | null; onBack: () => void }) {
  const [prefs, setPrefs] = useState<SoundPrefs>(mine?.sounds ?? {});
  const saved = useRef(JSON.stringify(mine?.sounds ?? {}));
  const latest = useRef(prefs);
  latest.current = prefs;
  const flush = () => {
    const next = JSON.stringify(latest.current);
    if (next === saved.current) return;
    saved.current = next;
    client.saveSettings({ ...(client.state.room?.mySettings ?? mine ?? {}), sounds: latest.current });
  };
  useEffect(() => {
    const t = setTimeout(flush, 350);
    return () => clearTimeout(t);
  }, [prefs]);
  // Closing the page right after a change still saves it.
  useEffect(() => () => flush(), []);
  const set = (id: SoundId, patch: { on?: boolean; vol?: number; style?: number }) =>
    setPrefs((p) => ({ ...p, each: { ...p.each, [id]: { ...p.each?.[id], ...patch } } }));
  const master = masterVolume(prefs);
  const groups = [...new Set(Object.values(SOUNDS).map((x) => x.group))];
  return (
    <Sheet
      title="Sounds"
      sub="Saved on your profile, for every device. Only you hear the difference."
      onClose={onBack}
      foot={
        <button className="btn" onClick={onBack} data-testid="sounds-back">
          Done
        </button>
      }
    >
      <label className="soundrow master">
        <span>Master volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(master * 100)}
          aria-label="Master volume"
          data-testid="sound-master"
          onChange={(e) => setPrefs((p) => ({ ...p, master: Number(e.target.value) / 100 }))}
        />
        <output>{Math.round(master * 100)}</output>
      </label>
      {groups.map((g) => (
        <section key={g} className="soundgroup">
          <span className="eyebrow">{g}</span>
          {(Object.keys(SOUNDS) as SoundId[])
            .filter((id) => SOUNDS[id].group === g)
            .map((id) => {
              const p = soundPref(prefs, id);
              return (
                <div key={id} className={`soundrow${p.on ? '' : ' off'}`} data-testid={`sound-${id}`}>
                  <label className="nm">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={p.on}
                      data-testid={`sound-${id}-on`}
                      onChange={(e) => set(id, { on: e.target.checked })}
                    />
                    <span>{SOUNDS[id].label}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(p.vol * 100)}
                    disabled={!p.on}
                    aria-label={`${SOUNDS[id].label}: volume`}
                    data-testid={`sound-${id}-vol`}
                    onChange={(e) => set(id, { vol: Number(e.target.value) / 100 })}
                  />
                  <select
                    value={p.style}
                    disabled={!p.on}
                    aria-label={`${SOUNDS[id].label}: style`}
                    data-testid={`sound-${id}-style`}
                    onChange={(e) => {
                      set(id, { style: Number(e.target.value) });
                      preview(id, Number(e.target.value), master * p.vol);
                    }}
                  >
                    {SOUNDS[id].styles.map(([name], i) => (
                      <option key={name} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label={`Play ${SOUNDS[id].label}`}
                    data-testid={`sound-${id}-play`}
                    onClick={() => preview(id, p.style, master * (p.vol || 0.5))}
                  >
                    ▶
                  </button>
                </div>
              );
            })}
        </section>
      ))}
    </Sheet>
  );
}

/** The game's rules, changed by the player whose turn it is; everyone sees each change in the log. */
/** Display size (SPEC 5.12), remembered on this device. */
function DisplaySize() {
  const [size, setSize] = useState<Size>(currentSize());
  return (
    <div className="switchrow" data-testid="display-size">
      <span>
        Display size <small>(this device)</small>
      </span>
      <div className="seg">
        {(Object.keys(SIZE_LABEL) as Size[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`btn small${size === k ? ' on' : ''}`}
            aria-pressed={size === k}
            data-testid={`size-${k}`}
            onClick={() => {
              applySize(k);
              setSize(k);
            }}
          >
            {SIZE_LABEL[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RulesSheet({ v, room, onClose }: { v: PlayerView; room: RoomInfo; onClose: () => void }) {
  const mine = v.me != null && v.turn === v.me && v.phase === 'play';
  const hr = v.rules.houseRules;
  const sea = v.rules.modules.includes('seafarers');
  const ck = v.rules.modules.includes('citiesKnights');
  const set = (rule: RuleKey, value: boolean | number | 'full' | 'trimmed') =>
    void client.act({ type: 'setRule', rule, value }).then((r) => !r.ok && r.error && client.toast(r.error));
  const top = Math.max(v.hand?.totalVP ?? 0, ...v.players.map((p) => p.publicVP));
  const flags: { k: RuleKey; show: boolean }[] = [
    { k: 'no7FirstRound', show: true },
    { k: 'bank3to1', show: true },
    { k: 'freeShipMoves', show: sea },
    { k: 'rerollBeforeAttack', show: ck },
    { k: 'noDiscardBeforeAttack', show: ck },
    { k: 'handBack', show: true },
    { k: 'handBackSetup', show: true },
    { k: 'undo', show: true },
    { k: 'undoTurn', show: true },
  ];
  const seated = v.me != null;
  const cpus = v.players.some((p) => p.cpu);
  const stepper = (label: ReactNode, value: number, min: number, max: number, rule: RuleKey, id: string) => (
    <div className="switchrow">
      <span>{label}</span>
      <div className="ctl" style={{ marginLeft: 'auto' }}>
        <button
          type="button"
          disabled={!mine || value <= min}
          onClick={() => set(rule, value - 1)}
          aria-label="Less"
        >
          −
        </button>
        <output data-testid={id}>{value}</output>
        <button
          type="button"
          disabled={!mine || value >= max}
          onClick={() => set(rule, value + 1)}
          aria-label="More"
        >
          +
        </button>
      </div>
    </div>
  );
  return (
    <Sheet
      title="Table rules"
      sub={
        mine
          ? 'Changes apply to everyone at once and show in the log.'
          : 'Whoever has the dice can change these on their turn.'
      }
      onClose={onClose}
      foot={
        <button className="btn" onClick={onClose} data-testid="rules-close">
          Done
        </button>
      }
    >
      <div className="switches" data-testid="table-rules">
        {stepper(
          <>
            {RULE_LABEL.winVP} <Help text={RULE_HELP.winVP} />
          </>,
          v.winVP,
          Math.min(30, Math.max(3, top + 1)),
          30,
          'winVP',
          'rules-winvp',
        )}
        {flags
          .filter((f) => f.show)
          .map(({ k }) => (
            <Switch
              key={k}
              on={!!(hr as Record<string, unknown>)[k]}
              label={RULE_LABEL[k]}
              help={RULE_HELP[k]}
              testid={`tablerule-${k}`}
              disabled={!mine || (k === 'handBackSetup' && !hr.handBack) || (k === 'undoTurn' && !hr.undo)}
              onChange={(on) => set(k, on)}
            />
          ))}
        <div className="switchrow">
          <span>
            Dice <Help text={RULE_HELP.diceDeck} />
          </span>
          <select
            style={{ marginLeft: 'auto' }}
            value={hr.diceDeck ?? 'dice'}
            disabled={!mine}
            data-testid="tablerule-diceDeck"
            aria-label="Dice"
            onChange={(e) =>
              set('diceDeck', e.target.value === 'dice' ? false : (e.target.value as 'full' | 'trimmed'))
            }
          >
            {DICE_CHOICES.map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {v.deckLeft != null && hr.diceDeck ? (
          <p className="small" data-testid="deck-left">
            {v.deckLeft} cards left in the dice deck
          </p>
        ) : null}
        {ck
          ? stepper(
              <>
                {RULE_LABEL.barbarianDelay} <Help text={RULE_HELP.barbarianDelay} />
              </>,
              hr.barbarianDelay ?? 0,
              0,
              10,
              'barbarianDelay',
              'rules-delay',
            )
          : null}
        {cpus ? (
          <Switch
            on={room.options.cpuChat !== false}
            label="CPU chatter in table talk"
            help="Now and then a CPU says what it’s looking for, what it has too much of, or how it feels about being robbed. At most once a turn. Anyone at the table can switch it off or on, any time."
            testid="tablerule-cpuChat"
            disabled={!seated}
            onChange={(on) => client.setCpuChat(on)}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

/** A one-step "are you sure?" (the confirmation settings). */
export function AskSheet(props: {
  title: string;
  sub?: string;
  yes: string;
  onYes: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Sheet
      title={props.title}
      sub={props.sub}
      onClose={props.onClose}
      foot={
        <>
          <button className="btn ghost" onClick={props.onClose} data-testid="ask-no">
            Cancel
          </button>
          <button
            className="btn primary"
            data-testid="ask-yes"
            onClick={() => {
              props.onClose();
              props.onYes();
            }}
          >
            {props.yes}
          </button>
        </>
      }
    >
      {props.children ?? null}
    </Sheet>
  );
}
