#!/usr/bin/env bash
# Prepare the server. Safe to run on every deploy: each step checks before changing anything.
# Run as root (the deploy script uses sudo). Expects /tmp/settlers.env.new from the deploy script.
set -euo pipefail

NODE_VERSION="22.22.0"
DOMAIN="betteronlinesettlers.com"
APP=/opt/settlers
DATA=/var/lib/settlers
BACKUPS=/var/backups/settlers
log() { echo "[provision] $*"; }

# 1 GB of swap so a small instance can't run out of memory.
if ! swapon --show | grep -q /swapfile; then
  log "adding swap"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
# Caddy comes from Ubuntu's own archive. (An earlier version added Caddy's third-party apt repo,
# whose signing key expired; remove it so it can't break apt.)
rm -f /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg
if ! command -v caddy >/dev/null || ! command -v sqlite3 >/dev/null || ! command -v curl >/dev/null; then
  log "installing packages"
  apt-get update -q
  apt-get install -y -q curl ca-certificates sqlite3 xz-utils caddy
fi

# Node, pinned and checksum-verified. Must match the Node major version the release was built with.
if [ "$(/usr/local/bin/node -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  log "installing node $NODE_VERSION"
  arch=$(uname -m); case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
  tarball="node-v$NODE_VERSION-linux-$arch.tar.xz"
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$tarball" -o "$tmp/$tarball"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "/opt/node-v$NODE_VERSION"
  mkdir -p "/opt/node-v$NODE_VERSION"
  tar -xJf "$tmp/$tarball" -C "/opt/node-v$NODE_VERSION" --strip-components=1
  ln -sfn "/opt/node-v$NODE_VERSION/bin/node" /usr/local/bin/node
  rm -rf "$tmp"
fi

# Service user and folders.
id settlers >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin settlers
mkdir -p "$APP/releases" "$DATA" "$BACKUPS"
chown settlers:settlers "$DATA"
chmod 750 "$DATA"

# Secrets: written by the deploy script, readable only by root (systemd reads it).
if [ -f /tmp/settlers.env.new ]; then
  install -m 600 -o root -g root /tmp/settlers.env.new /etc/settlers.env
  rm -f /tmp/settlers.env.new
fi

cat > /etc/systemd/system/settlers.service <<UNIT
[Unit]
Description=Settlers game server
After=network.target

[Service]
User=settlers
Group=settlers
EnvironmentFile=/etc/settlers.env
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=8080 DATA_DIR=$DATA STATIC_DIR=$APP/current/client
ExecStart=/usr/local/bin/node $APP/current/server/server.mjs
Restart=always
RestartSec=2
TimeoutStopSec=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT

# Nightly database backup, keeping two weeks.
cat > /etc/systemd/system/settlers-backup.service <<UNIT
[Unit]
Description=Back up the Settlers database

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'sqlite3 $DATA/settlers.db ".backup $BACKUPS/settlers-\$(date +%%F).db" && find $BACKUPS -name "settlers-*.db" -mtime +14 -delete'
UNIT
cat > /etc/systemd/system/settlers-backup.timer <<UNIT
[Unit]
Description=Nightly Settlers database backup

[Timer]
OnCalendar=*-*-* 09:17:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

# Caddy: HTTPS certificates from Let's Encrypt, proxying to the game server (WebSockets included).
# Other sites on this server (Sarah Crossing) keep their own files in /etc/caddy/sites/, which
# this file imports, so writing it here never takes them down.
mkdir -p /etc/caddy/sites
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080
}

www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}

import /etc/caddy/sites/*.caddy
CADDY

systemctl daemon-reload
systemctl enable --now settlers-backup.timer >/dev/null
systemctl enable settlers >/dev/null
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy
log "done"
