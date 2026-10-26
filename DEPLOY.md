# Deploying Freewise to the Raspberry Pi

Freewise runs on the Pi as a background service on `127.0.0.1:3000`, so it doesn't
clash with Pi-hole on port 80 and isn't reachable on the LAN directly. Tailscale
Funnel gives it a public HTTPS address (`https://<name>.<tailnet>.ts.net`) that works
from anywhere, which is what Google sign-in and the iPhone home-screen app need.

Commands in `PowerShell` blocks run on your Windows PC; everything else runs on the Pi over SSH.

## 0. Push the latest code

Commit and push from the PC so the Pi can download it.

## 1. SSH into the Pi

```powershell
ssh <pi-username>@<pi-ip-address>
```

For example `ssh pi@192.168.1.20`. The Pi's address is the one you use for the
Pi-hole admin page (`http://<pi-ip>/admin`).

If it says **connection refused**, SSH is off. Plug in a keyboard and screen, log in,
run `sudo raspi-config` → Interface Options → SSH → Enable, then try again.

## 2. Check the system

```bash
uname -m          # aarch64 = 64-bit (good). armv7l = 32-bit: see the note at the end
df -h /           # want at least 1 GB free
```

## 3. Install Node.js 22 and git

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential python3
node -v           # v22.x
```

`build-essential` and `python3` are only used if the SQLite library has to be compiled for the Pi.

## 4. Download Freewise and install its packages

```bash
git clone https://github.com/AceoJack/freewise.git ~/freewise
cd ~/freewise
npm ci --omit=dev
npm test          # should end with "# fail 0"; proves SQLite works on the Pi
```

If the repo is private, git asks for your GitHub username and a personal access token as the password.

## 5. Create the production settings

```bash
cd ~/freewise
cat > .env <<EOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
GOOGLE_CLIENT_ID=599629312886-f13s34thrc9qna2u5fd3so707c51o3qp.apps.googleusercontent.com
SESSION_SECRET=$(openssl rand -hex 32)
FREEWISE_USERS=Jack:aceojack@gmail.com;Jaime:jaimewho1011@gmail.com,jaimemorcos@gmail.com
DB_PATH=./data/freewise.db
DEV_LOGIN=false
EOF
chmod 600 .env
```

The session secret is generated fresh on the Pi. Never copy the PC's `.env` here: it has `DEV_LOGIN=true`.

## 6. Run it as a service (starts on boot, restarts if it crashes)

```bash
sudo tee /etc/systemd/system/freewise.service > /dev/null <<EOF
[Unit]
Description=Freewise
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$HOME/freewise
ExecStart=$(command -v node) --env-file=.env server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now freewise
systemctl status freewise --no-pager     # "active (running)"
curl -s localhost:3000/health            # {"ok":true}
```

Logs: `journalctl -u freewise -n 50 --no-pager`

## 7. Tailscale and Funnel

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --accept-dns=false
```

`--accept-dns=false` matters: it stops Tailscale from changing the Pi's own DNS
settings, which would interfere with Pi-hole. `tailscale up` prints a link; open it and
sign in to Tailscale (any account; it's free).

Optional but nicer: in the Tailscale admin console → **Machines** → the Pi → **⋯** →
**Edit machine name**, rename it `freewise`. The machine name becomes the start of the web address.

```bash
sudo tailscale funnel --bg 3000
```

The first time, it prints a link to turn on HTTPS and Funnel for your tailnet. Open it,
approve, and run the command again. Then:

```bash
tailscale funnel status
```

It shows your address, e.g. `https://freewise.tail1234.ts.net`. Funnel settings survive reboots.

## 8. Tell Google about the new address

[Google Cloud console](https://console.cloud.google.com/) → **Google Auth Platform** →
**Clients** → your Freewise web client. Add (exactly, no trailing slash):

- **Authorized JavaScript origins:** `https://freewise.tail1234.ts.net`
- **Authorized redirect URIs:** `https://freewise.tail1234.ts.net/auth/google/callback`

Save. Google says changes can take from 5 minutes to a few hours to apply.

## 9. Use it

On the iPhone, open the address in **Safari**, sign in with Google, then
**Share → Add to Home Screen**. Work through the "After deploying to the Pi" section of `TESTING.md`.

The Pi starts with an empty database: Jack and Jaime exist, but you aren't friends there yet.
Add Jaime from **Friends → +**, then create a group. (To bring your PC data instead: stop
`npm run dev` on the PC, then before step 6 run
`scp data/freewise.db <pi-username>@<pi-ip>:~/freewise/data/` from the project folder in PowerShell.)

## 10. Nightly backups

```bash
mkdir -p ~/freewise-backups
(crontab -l 2>/dev/null; echo "30 3 * * * cd $HOME/freewise && $(command -v node) scripts/backup.js data/freewise.db $HOME/freewise-backups 14 >> $HOME/freewise-backups/backup.log 2>&1") | crontab -
cd ~/freewise && node scripts/backup.js data/freewise.db ~/freewise-backups 14   # try it now
```

Every night at 3:30 it saves a copy and keeps the last 14. These live on the same SD card,
so every so often copy them to the PC:

```powershell
scp -r <pi-username>@<pi-ip>:~/freewise-backups $HOME\Documents\
```

**Restoring a backup:**

```bash
sudo systemctl stop freewise
cp ~/freewise-backups/freewise-<date>.db ~/freewise/data/freewise.db
rm -f ~/freewise/data/freewise.db-wal ~/freewise/data/freewise.db-shm
sudo systemctl start freewise
```

## Updating after you push new code

```bash
cd ~/freewise && git pull && npm ci --omit=dev && sudo systemctl restart freewise
```

Database upgrades run automatically when it starts. Close and reopen the home-screen app to pick up the new version.

## If something's wrong

| Symptom | Check |
| --- | --- |
| Address doesn't load | `systemctl status freewise`, `tailscale funnel status` |
| "The given origin is not allowed" or `redirect_uri_mismatch` on sign-in | Step 8 URLs exactly match `tailscale funnel status`; wait a while after saving |
| "That Google account isn't allowed" | The email isn't in `FREEWISE_USERS` and nobody has added it as a friend |
| Google says the app is in testing / access blocked | Add the Gmail under Google Auth Platform → Audience → Test users |
| Ad-blocking or DNS stops working | `pihole status`; make sure Tailscale was started with `--accept-dns=false` |

**32-bit Pi OS (`armv7l`):** step 3 may fail, or SQLite may need a long compile. Stop there and ask; it's fixable.
