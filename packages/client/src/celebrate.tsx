/*
 * The win celebration (SPEC 5.13): confetti in the winner's colour, a banner, and a short
 * fanfare (game sounds switch). With reduced motion on: just the banner, no confetti.
 */

import { useEffect, useRef } from 'react';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function Celebration({ color, text, onDone }: { color: string; text: string; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const calm = reduced();
  useEffect(() => {
    const done = setTimeout(onDone, calm ? 2200 : 3200);
    if (calm) return () => clearTimeout(done);
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return () => clearTimeout(done);
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    const colors = [color, color, color, '#f4ecd6', '#e9b94a'];
    const bits = Array.from({ length: 160 }, () => ({
      x: Math.random() * c.width,
      y: -20 - Math.random() * c.height * 0.6,
      vx: (Math.random() - 0.5) * 2,
      vy: 2 + Math.random() * 3,
      a: Math.random() * 6,
      va: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      col: colors[Math.floor(Math.random() * colors.length)]!,
    }));
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const b of bits) {
        b.x += b.vx;
        b.y += b.vy;
        b.a += b.va;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        ctx.fillStyle = b.col;
        ctx.strokeStyle = '#0b1418';
        ctx.lineWidth = 1;
        ctx.fillRect(-b.w / 2, -b.w / 4, b.w, b.w / 2);
        ctx.strokeRect(-b.w / 2, -b.w / 4, b.w, b.w / 2);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, []);
  return (
    <div className="celebrate" data-testid="celebration" data-calm={calm ? 1 : 0}>
      {calm ? null : <canvas ref={canvas} data-testid="confetti" />}
      <div className="winbanner" style={{ ['--c' as string]: color }}>
        {text}
      </div>
    </div>
  );
}
