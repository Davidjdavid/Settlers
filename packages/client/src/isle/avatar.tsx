/*
 * Avatars (docs/isle.md 4): a friendly round face for each player, on a disc in their colour,
 * so a seat is never told apart by colour alone. Built from a few parts picked per player.
 */

import type { Color } from '@settlers/engine';
import { ICOL, OUTLINE } from './pieces';

export interface Face {
  skin: string;
  hair: string;
  style: 'short' | 'curly' | 'long' | 'cap' | 'bun' | 'spiky';
  beard?: boolean;
  glasses?: boolean;
}

const SKINS = ['#ffd9b8', '#f2c094', '#d89a6a', '#a8693f', '#7b4a2a'];
const HAIRS = ['#3b2a20', '#6b3e1f', '#c98a3a', '#2a2a33', '#a83a24', '#e8c46a'];
const STYLES: Face['style'][] = ['short', 'curly', 'long', 'cap', 'bun', 'spiky'];

/** A face from a name, so the same person always looks the same. */
export function faceFor(name: string): Face {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const pick = <T,>(xs: readonly T[], k: number) => xs[(h >>> k) % xs.length]!;
  return {
    skin: pick(SKINS, 3),
    hair: pick(HAIRS, 7),
    style: pick(STYLES, 11),
    beard: ((h >>> 15) & 7) === 0,
    glasses: ((h >>> 19) & 7) === 1,
  };
}

export function Avatar({
  face,
  color,
  size = 64,
  mood = 'happy',
}: {
  face: Face;
  color: Color;
  size?: number;
  mood?: 'happy' | 'sad' | 'wow' | 'sleep';
}) {
  const k = ICOL[color];
  const hair = face.hair;
  const back =
    face.style === 'long' ? (
      <path d="M-27 4Q-30 -26 0 -28Q30 -26 27 4V24Q14 30 0 28Q-14 30 -27 24Z" fill={hair} />
    ) : face.style === 'bun' ? (
      <circle cx="0" cy="-30" r="10" fill={hair} />
    ) : null;
  const front =
    face.style === 'short' ? (
      <path d="M-22 -6Q-24 -27 0 -27Q24 -27 22 -6Q14 -16 -2 -15Q-14 -15 -22 -6Z" fill={hair} />
    ) : face.style === 'curly' ? (
      <g fill={hair}>
        {[-18, -9, 0, 9, 18].map((x, i) => (
          <circle key={i} cx={x} cy={-19 - (i % 2) * 4} r="9" />
        ))}
        <circle cx="-22" cy="-8" r="6" />
        <circle cx="22" cy="-8" r="6" />
      </g>
    ) : face.style === 'long' ? (
      <path d="M-23 0Q-25 -27 0 -27Q25 -27 23 0Q18 -14 4 -16Q-8 -10 -23 0Z" fill={hair} />
    ) : face.style === 'cap' ? (
      <g>
        <path d="M-23 -8Q-23 -30 0 -30Q23 -30 23 -8Z" fill={k.fill} stroke={OUTLINE} strokeWidth="2.4" />
        <path
          d="M-2 -9H32Q30 -3 -2 -3Z"
          fill={k.dark}
          stroke={OUTLINE}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <circle cx="0" cy="-30" r="3" fill={k.dark} />
      </g>
    ) : face.style === 'bun' ? (
      <path d="M-22 -4Q-24 -27 0 -27Q24 -27 22 -4Q12 -18 0 -17Q-12 -18 -22 -4Z" fill={hair} />
    ) : (
      <path d="M-22 -6L-20 -22L-12 -16L-8 -30L0 -18L8 -30L12 -16L20 -22L22 -6Q10 -14 -22 -6Z" fill={hair} />
    );
  const eyes =
    mood === 'sleep' ? (
      <g stroke={OUTLINE} strokeWidth="2.4" strokeLinecap="round" fill="none">
        <path d="M-12 -1q4 3 8 0M4 -1q4 3 8 0" />
      </g>
    ) : mood === 'wow' ? (
      <g fill={OUTLINE}>
        <ellipse cx="-8" cy="-2" rx="3.2" ry="4.4" />
        <ellipse cx="8" cy="-2" rx="3.2" ry="4.4" />
      </g>
    ) : (
      <g fill={OUTLINE}>
        <ellipse cx="-8" cy="-1" rx="2.8" ry="3.8" />
        <ellipse cx="8" cy="-1" rx="2.8" ry="3.8" />
        <circle cx="-7" cy="-2.4" r="1" fill="#fff" />
        <circle cx="9" cy="-2.4" r="1" fill="#fff" />
      </g>
    );
  const mouth =
    mood === 'sad' ? (
      <path d="M-6 13Q0 8 6 13" fill="none" stroke={OUTLINE} strokeWidth="2.4" strokeLinecap="round" />
    ) : mood === 'wow' ? (
      <ellipse cx="0" cy="12" rx="4" ry="5" fill={OUTLINE} />
    ) : (
      <path d="M-7 9Q0 16 7 9Z" fill="#7a2320" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
    );
  return (
    <svg className="iavatar" viewBox="-40 -40 80 80" width={size} height={size} aria-hidden="true">
      <circle r="38" fill={k.fill} stroke={OUTLINE} strokeWidth="3" />
      <circle r="31" fill={k.light} opacity=".5" />
      <g transform="translate(0 6)">
        {back}
        <path d="M-17 22Q-20 33 0 34Q20 33 17 22Z" fill={k.dark} />
        <rect x="-6" y="14" width="12" height="9" fill={face.skin} />
        <ellipse cx="0" cy="0" rx="22" ry="23" fill={face.skin} stroke={OUTLINE} strokeWidth="2.6" />
        <ellipse cx="-22" cy="2" rx="4" ry="6" fill={face.skin} stroke={OUTLINE} strokeWidth="2.2" />
        <ellipse cx="22" cy="2" rx="4" ry="6" fill={face.skin} stroke={OUTLINE} strokeWidth="2.2" />
        {front}
        {face.beard ? (
          <path d="M-18 6Q-17 24 0 25Q17 24 18 6Q10 14 0 13Q-10 14 -18 6Z" fill={face.hair} />
        ) : null}
        {eyes}
        <ellipse cx="-14" cy="7" rx="4" ry="2.4" fill="#ff8f8f" opacity=".55" />
        <ellipse cx="14" cy="7" rx="4" ry="2.4" fill="#ff8f8f" opacity=".55" />
        {mouth}
        {face.glasses ? (
          <g fill="none" stroke={OUTLINE} strokeWidth="2.2">
            <circle cx="-8" cy="-1" r="6.5" />
            <circle cx="8" cy="-1" r="6.5" />
            <path d="M-1.5 -1H1.5" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}
