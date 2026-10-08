/*
 * House rules that only last a while (no 7s in the first round, nothing before the first
 * attack, the barbarians' delay): a badge in the board's corner while they're on, and a notice
 * for everyone when one ends, with OK (a setting turns the OK off: then it goes by itself).
 * Worked out from the view alone, exactly as the engine decides them.
 */

import { useEffect, useRef, useState } from 'react';
import type { PlayerView, RuleKey } from '@settlers/engine';
import type { PlayerSettings } from '@settlers/server/protocol';
import { settingOn } from './help';

export interface TimedRule {
  key: RuleKey;
  /** Its name in the corner. */
  label: string;
  /** What it does, and until when. */
  now: string;
  /** What changes now it's over. */
  over: string;
}

/** The house rules that last a while and are still in force. */
export function activeRules(v: PlayerView): TimedRule[] {
  if (v.phase !== 'play') return [];
  const hr = v.rules.houseRules;
  const n = v.players.length;
  const out: TimedRule[] = [];
  // rules.ts: a 7 is rolled again while turnN <= players.
  if (hr.no7FirstRound && v.turnN <= n)
    out.push({
      key: 'no7FirstRound',
      label: 'No 7s in the first round',
      now: 'A 7 is rolled again until everyone has had a turn.',
      over: 'The first round is over: 7s count from now on. The robber moves, and anyone over their limit discards.',
    });
  const beforeAttack = !!v.ck && v.ck.attacks === 0;
  // citiesKnights.ts: rolled again (or no discards) while nobody has been attacked.
  if (hr.rerollBeforeAttack && beforeAttack)
    out.push({
      key: 'rerollBeforeAttack',
      label: 'No 7s until the first attack',
      now: 'A 7 is rolled again until the barbarians first attack.',
      over: 'The barbarians have attacked: 7s count from now on.',
    });
  else if (hr.noDiscardBeforeAttack && beforeAttack)
    out.push({
      key: 'noDiscardBeforeAttack',
      label: 'No discards until the first attack',
      now: 'A 7 makes nobody discard until the barbarians first attack.',
      over: 'The barbarians have attacked: a 7 makes anyone over their limit discard from now on.',
    });
  // citiesKnights.ts: the event die waits while turnN <= delay × players.
  const delay = hr.barbarianDelay ?? 0;
  if (v.ck && delay > 0 && v.turnN <= delay * n)
    out.push({
      key: 'barbarianDelay',
      label: `Barbarians wait ${delay} round${delay === 1 ? '' : 's'}`,
      now: `The event die isn’t rolled for the first ${delay === 1 ? 'round' : `${delay} rounds`}: no barbarians and no progress cards yet.`,
      over: 'The barbarians are on their way: the event die is rolled from now on.',
    });
  return out;
}

/**
 * The rules that ended between two views: in force before, not now, and still switched on (a
 * rule switched off mid-game is a rule change, not one running out).
 */
export function endedRules(before: PlayerView, after: PlayerView): TimedRule[] {
  const now = new Set(activeRules(after).map((r) => r.key));
  const on = after.rules.houseRules as Partial<Record<RuleKey, unknown>>;
  return activeRules(before).filter((r) => !now.has(r.key) && !!on[r.key]);
}

export function HouseRules({ v, my }: { v: PlayerView; my: PlayerSettings | null | undefined }) {
  const active = activeRules(v);
  const prev = useRef<PlayerView | null>(null);
  const [ended, setEnded] = useState<TimedRule[]>([]);
  useEffect(() => {
    const before = prev.current;
    prev.current = v;
    if (!before || before.seq >= v.seq) return;
    const gone = endedRules(before, v);
    if (gone.length) setEnded((e) => [...e, ...gone]);
  }, [v.seq]);
  const ask = settingOn(my, 'ruleOk');
  // Without the OK, the notice goes by itself.
  useEffect(() => {
    if (!ended.length || ask) return;
    const t = window.setTimeout(() => setEnded((e) => e.slice(1)), 6000);
    return () => window.clearTimeout(t);
  }, [ended[0]?.key, ask]);
  const first = ended[0];
  return (
    <>
      {active.length ? (
        <div className="hr-corner" data-testid="house-rules">
          {active.map((r) => (
            <span key={r.key} className="hr-rule" title={r.now} data-rule={r.key}>
              <i aria-hidden="true" />
              <b>{r.label}</b>
              <small>{r.now}</small>
            </span>
          ))}
        </div>
      ) : null}
      {first ? (
        <div className="hr-over" role="alertdialog" aria-label="A house rule is over" data-testid="rule-over">
          <span className="hr-over-eyebrow">House rule over</span>
          <b>{first.label}</b>
          <p>{first.over}</p>
          {ask ? (
            <button
              type="button"
              className="btn primary"
              data-testid="rule-over-ok"
              onClick={() => setEnded((e) => e.slice(1))}
            >
              OK
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
