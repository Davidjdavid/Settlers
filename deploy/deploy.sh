#!/usr/bin/env bash
# Build a release and ship it to the server. Used by GitHub Actions; also works from a laptop:
#   DEPLOY_HOST=98.83.141.234 DEPLOY_KEY=~/settlers_deploy SITE_PASSPHRASE='...' npm run deploy
# Env: DEPLOY_HOST (required), DEPLOY_USER (default ubuntu), DEPLOY_KEY (optional key file),
#      SITE_PASSPHRASE (required), DEPLOY_DOMAIN (default betteronlinesettlers.com).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DEPLOY_HOST:?set DEPLOY_HOST}"
: "${SITE_PASSPHRASE:?set SITE_PASSPHRASE}"
USER_AT="${DEPLOY_USER:-ubuntu}@$DEPLOY_HOST"
DOMAIN="${DEPLOY_DOMAIN:-betteronlinesettlers.com}"
VERSION="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
SSH=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
SCP=(scp -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
if [ -n "${DEPLOY_KEY:-}" ]; then SSH+=(-i "$DEPLOY_KEY"); SCP+=(-i "$DEPLOY_KEY"); fi
log() { echo "[deploy] $*"; }

log "building $VERSION"
npm run build >/dev/null
REL=$(mktemp -d)
mkdir -p "$REL/$VERSION/server" "$REL/$VERSION/client"
cp packages/server/dist/server.mjs packages/server/dist/server.mjs.map "$REL/$VERSION/server/"
cp -r packages/client/dist/. "$REL/$VERSION/client/"
# The one native dependency, installed for this platform and Node version.
SQLITE_VERSION=$(node -p "require('./node_modules/better-sqlite3/package.json').version")
(cd "$REL/$VERSION/server" && echo '{"type":"module","private":true}' > package.json && npm install --omit=dev --no-audit --no-fund "better-sqlite3@$SQLITE_VERSION" >/dev/null)
tar -C "$REL" -czf "$REL/release.tgz" "$VERSION"
log "release is $(du -h "$REL/release.tgz" | cut -f1)"

log "uploading to $USER_AT"
"${SCP[@]}" "$REL/release.tgz" deploy/provision.sh deploy/activate.sh "$USER_AT:/tmp/"
# Secrets go over ssh stdin, never on a command line.
printf 'SITE_PASSPHRASE=%s\nAPP_VERSION=%s\n' "$SITE_PASSPHRASE" "$VERSION" | "${SSH[@]}" "$USER_AT" 'umask 077 && cat > /tmp/settlers.env.new'

log "provisioning and activating"
"${SSH[@]}" "$USER_AT" "set -e
  sudo bash /tmp/provision.sh
  sudo tar -xzf /tmp/release.tgz -C /opt/settlers/releases
  sudo chown -R root:root /opt/settlers/releases/$VERSION
  sudo bash /tmp/activate.sh $VERSION
  rm -f /tmp/release.tgz /tmp/provision.sh /tmp/activate.sh"

log "checking https://$DOMAIN"
for i in $(seq 1 36); do
  if curl -fsS "https://$DOMAIN/healthz" | grep -q "\"version\":\"$VERSION\""; then
    log "live: https://$DOMAIN ($VERSION)"
    rm -rf "$REL"
    exit 0
  fi
  sleep 5
done
log "the server is running, but https://$DOMAIN didn't answer with the new version yet (DNS or certificate?)"
exit 1
