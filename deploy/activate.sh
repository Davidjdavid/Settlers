#!/usr/bin/env bash
# Switch to a release, restart, and roll back if it isn't healthy. Run as root on the server.
# Usage: activate.sh <release-dir-name>
set -euo pipefail
APP=/opt/settlers
NEW="$APP/releases/$1"
PREV=$(readlink -f "$APP/current" 2>/dev/null || true)
log() { echo "[activate] $*"; }

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8080/healthz | grep -q "\"version\":\"$1\""; then return 0; fi
    sleep 1
  done
  return 1
}

ln -sfn "$NEW" "$APP/current.new" && mv -T "$APP/current.new" "$APP/current"
systemctl restart settlers
if healthy "$1"; then
  log "release $1 is live"
  # Keep the 5 newest releases.
  ls -1dt "$APP"/releases/* | tail -n +6 | xargs -r rm -rf
  exit 0
fi

log "release $1 failed its health check; recent logs:"
journalctl -u settlers -n 40 --no-pager || true
if [ -n "$PREV" ] && [ "$PREV" != "$NEW" ]; then
  log "rolling back to $(basename "$PREV")"
  ln -sfn "$PREV" "$APP/current.new" && mv -T "$APP/current.new" "$APP/current"
  systemctl restart settlers
fi
exit 1
