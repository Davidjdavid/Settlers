/*
 * The crash screen (SPEC 13.1): an error while drawing used to blank the whole page until a
 * reload, with nothing to say why. Now the page says so, offers Reload, and the error goes to the
 * server's log with where it happened.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { client } from './net';

export class CrashCatcher extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    client.reportError('drawing the screen', error, info.componentStack ?? undefined);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center">
        <div className="card" data-testid="crash-screen">
          <h2>Something went wrong on this screen</h2>
          <p className="lede">
            Your game is safe: every move is saved on the server. Reload to carry on where you were.
          </p>
          <p className="small">What went wrong was sent to the server so it can be fixed.</p>
          <button className="btn primary" onClick={() => location.reload()} data-testid="crash-reload">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
