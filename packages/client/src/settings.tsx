/* "My settings" (per person) and "Table rules" (per game) sheets, SPEC 4.3 and 4.5. */

import type { ReactNode } from 'react';
import type { PlayerView, RuleKey } from '@settlers/engine';
import type { PlayerSettings } from '@settlers/server/protocol';
import { Help, RULE_HELP, SETTING_HELP, SETTING_LABEL, settingOn, type SettingKey } from './help';
import { client } from './net';
import { Sheet } from './Sheets';
import { RULE_LABEL } from './text';

const SETTINGS: SettingKey[] = [
  'confirmPlace',
  'confirmPlaceTouch',
  'confirmEnd',
  'confirmCard',
  'confirmTrade',
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

/** Your own confirmation switches, saved under your nickname. */
export function SettingsSheet({ mine, onClose }: { mine: PlayerSettings | null; onClose: () => void }) {
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
            onChange={(on) => client.saveSettings({ ...(mine ?? {}), [k]: on })}
          />
        ))}
      </div>
    </Sheet>
  );
}

/** The game's rules, changed by the player whose turn it is; everyone sees each change in the log. */
export function RulesSheet({ v, onClose }: { v: PlayerView; onClose: () => void }) {
  const mine = v.me != null && v.turn === v.me && v.phase === 'play';
  const hr = v.rules.houseRules;
  const sea = v.rules.modules.includes('seafarers');
  const ck = v.rules.modules.includes('citiesKnights');
  const set = (rule: RuleKey, value: boolean | number) =>
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
  ];
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
              disabled={!mine || (k === 'handBackSetup' && !hr.handBack)}
              onChange={(on) => set(k, on)}
            />
          ))}
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
