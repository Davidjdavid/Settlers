# Deploying

The site runs on one EC2 instance (Ubuntu) at **https://betteronlinesettlers.com**:

- **Caddy** terminates HTTPS (certificates from Let's Encrypt, renewed automatically) and proxies to the game server.
- **The game server** (`settlers.service`, systemd) runs as the unprivileged user `settlers` on `127.0.0.1:8080`, and restarts on crash.
- **Data:** `/var/lib/settlers/settlers.db` (SQLite). There's a nightly backup to `/var/backups/settlers/`, keeping 14 days.
- **Releases:** in `/opt/settlers/releases/<version>`, with `/opt/settlers/current` pointing at the live one. The 5 newest are kept.
- **Secrets:** `/etc/settlers.env` (root only), written on each deploy from the GitHub secrets.

## One-command deploy

- **From GitHub:** go to the Actions tab → **Deploy** → **Run workflow** (or push to `main`). It runs `npm run check` first. If anything fails, nothing is deployed.
- **From a laptop:**
  ```
  DEPLOY_HOST=98.83.141.234 DEPLOY_KEY=~/settlers_deploy SITE_PASSPHRASE='...' npm run deploy
  ```

Either way, `deploy/deploy.sh`:

1. builds the release and uploads it;
2. runs `provision.sh`, which is safe to repeat: swap, packages, Node, the service user, systemd units, the Caddyfile;
3. switches `current` to the new release and restarts the server;
4. checks `/healthz` for the new version, and switches back to the previous release if it doesn't come up;
5. checks the public https URL.

## GitHub secrets

| Secret | What |
|---|---|
| `DEPLOY_SSH_KEY` | Private key whose public half is in `~ubuntu/.ssh/authorized_keys` on the server |
| `DEPLOY_HOST` | The Elastic IP |
| `SITE_PASSPHRASE` | The passphrase players type to get in. Changing it logs everyone out. |

## Useful commands on the server

```
sudo systemctl status settlers          # is it running?
sudo journalctl -u settlers -f          # live server logs
sudo journalctl -u caddy -n 50          # HTTPS / certificate problems
ls /var/backups/settlers/               # backups
# Roll back by hand: point current at an older release and restart
sudo ln -sfn /opt/settlers/releases/<older> /opt/settlers/current && sudo systemctl restart settlers
```

## Restoring a backup

```
sudo systemctl stop settlers
sudo cp /var/backups/settlers/settlers-YYYY-MM-DD.db /var/lib/settlers/settlers.db
sudo rm -f /var/lib/settlers/settlers.db-wal /var/lib/settlers/settlers.db-shm
sudo chown settlers:settlers /var/lib/settlers/settlers.db
sudo systemctl start settlers
```
