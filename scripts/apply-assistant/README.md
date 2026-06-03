# Apply Assistant (local one-click apply)

A tiny local server that drives a real Chromium via Playwright to **pre-fill** a
job application form on supported ATS (Greenhouse, Lever, Ashby, Workable). It
**does not submit** — it opens the filled form so you review it and click Submit
yourself. This is what powers the portal's "⚡ Apply now" button and the
`#apply-now=<id>` deep link from the digest email / Telegram alert.

## Run it

```bash
npm run apply-assistant     # starts on http://127.0.0.1:4319
```

The portal shows a status line in the Application Hub tab:
`● Apply Assistant online` (green) or `● Assistant offline — run: npm run apply-assistant` (red).
If it's offline when you click Apply now, the portal falls back to copying your
tailored CV + cover letter and opening the listing, so you're never blocked.

## Keep it always-on (recommended)

So "Apply now" works whenever your Mac is on — without remembering to start it —
install the LaunchAgent:

```bash
which node            # -> note this path (e.g. /opt/homebrew/bin/node)
pwd                   # run in the repo root -> note this absolute path

cp scripts/apply-assistant/com.adejob.apply-assistant.plist ~/Library/LaunchAgents/
# Edit the copy and replace __NODE_PATH__ and __REPO_PATH__ with the two values above.

launchctl load ~/Library/LaunchAgents/com.adejob.apply-assistant.plist
```

It will start at login and restart if it crashes (`RunAtLoad` + `KeepAlive`).
Logs: `/tmp/apply-assistant.out.log` and `/tmp/apply-assistant.err.log`.

To stop / uninstall:

```bash
launchctl unload ~/Library/LaunchAgents/com.adejob.apply-assistant.plist
rm ~/Library/LaunchAgents/com.adejob.apply-assistant.plist
```

## Why local (not cloud)?

You click Submit yourself, so you're at your Mac at submit time anyway. Running
locally shows the real filled form for review, reuses your logged-in ATS
sessions and home IP (far less bot-detection than a datacentre headless
browser), and keeps your CV/PII off third-party browser farms.
