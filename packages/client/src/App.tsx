import { useEffect } from 'react';
import { Flights } from './anim';
import { Game } from './Game';
import { Home } from './home';
import { Lobby, Login } from './Lobby';
import { client, useClient } from './net';
import { MapEditorPage, MapsPage } from './maps';
import { CpusPage } from './cpus';
import { StatsPage } from './stats';

function roomFromPath(): string | null {
  const m = /^\/r\/([A-Za-z0-9]{4,8})\/?$/.exec(location.pathname);
  return m ? m[1]!.toUpperCase() : null;
}

export function App() {
  const st = useClient();

  useEffect(() => {
    void client.checkAuth();
    const onPop = () => {
      const code = roomFromPath();
      if (code) client.openRoom(code);
      else if (client.state.roomCode) client.leaveRoom();
      client.popped();
    };
    const nudge = () => client.nudge();
    window.addEventListener('popstate', onPop);
    window.addEventListener('online', nudge);
    window.addEventListener('focus', nudge);
    document.addEventListener('visibilitychange', nudge);
    const beat = setInterval(nudge, 15_000);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('online', nudge);
      window.removeEventListener('focus', nudge);
      document.removeEventListener('visibilitychange', nudge);
      clearInterval(beat);
    };
  }, []);

  // Open the room in the URL once we're connected.
  useEffect(() => {
    if (st.auth !== 'ok' || st.status !== 'live') return;
    const code = roomFromPath();
    if (code && st.roomCode !== code) client.openRoom(code);
  }, [st.auth, st.status, st.roomCode]);

  let body;
  if (st.auth === 'checking') body = <div className="center">Loading…</div>;
  else if (st.auth === 'needed') body = <Login />;
  else if (!st.roomCode && st.path.startsWith('/stats')) body = <StatsPage />;
  else if (!st.roomCode && /^\/maps\/?$/.test(st.path)) body = <MapsPage />;
  else if (!st.roomCode && /^\/cpus\/?$/.test(st.path)) body = <CpusPage />;
  else if (!st.roomCode && st.path.startsWith('/maps/')) {
    const id = decodeURIComponent(st.path.split('/')[2] ?? 'new');
    body = <MapEditorPage key={id} id={id} />;
  } else if (!st.roomCode || st.roomError) body = <Home error={st.roomError} />;
  else if (!st.room) body = <div className="center">Joining room {st.roomCode}…</div>;
  else if (!st.game) body = <Lobby room={st.room} />;
  else
    body = (
      <Game
        v={st.game}
        room={st.room}
        log={st.log}
        status={st.status}
        pending={st.pending}
        dice={st.dice}
        stats={st.stats}
      />
    );

  return (
    <>
      {body}
      <Flights />
      <div className="toasts" aria-live="polite">
        {st.toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'err' ? ' err' : ''}`} data-testid="toast">
            {t.text}
          </div>
        ))}
      </div>
      {st.auth === 'ok' && st.status === 'offline' ? (
        <div className="offline" data-testid="offline">
          Reconnecting…
        </div>
      ) : null}
    </>
  );
}
