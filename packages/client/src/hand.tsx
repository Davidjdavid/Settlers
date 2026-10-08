/*
 * The cards in your hand (SPEC 13.2), always in the same spots: with Cities & Knights two rows of
 * four, each commodity under the resource it comes from; otherwise one row of five.
 */

import { COMS, type Card } from '@settlers/engine';
import { CARD_COLOR, CARD_LABEL, cardIcon } from './art';
import { HAND_LAYOUT } from './handorder';

export function HandCards({ res, ck }: { res: Partial<Record<Card, number>>; ck: boolean }) {
  return (
    <div className={`hand slots${ck ? ' four' : ''}`} data-testid="hand">
      {HAND_LAYOUT[ck ? 'ck' : 'base'].map((r, i) => (
        <div key={r} className="hslot" data-slot={i} data-testid={`hand-slot-${i}`}>
          <div
            className={`rcard${res[r] ? '' : ' zero'}${(COMS as readonly string[]).includes(r) ? ' com' : ''}`}
            style={{ ['--c' as string]: CARD_COLOR[r] }}
            title={CARD_LABEL[r]}
            data-res={r}
            data-n={res[r] ?? 0}
          >
            <span dangerouslySetInnerHTML={{ __html: cardIcon(r) }} style={{ display: 'contents' }} />
            <span className="n">{res[r] ?? 0}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
