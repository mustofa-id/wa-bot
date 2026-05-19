# wa-bot

## Run

```bash
pnpm i
pnpm start
```

No tests, no lint, no typecheck — just a single entry point.

## Stack

- **Runtime**: Node 22+ (uses `node:sqlite`, `node:timers/promises`, `--env-file`). ESM.
- **PM**: `pnpm` only. `pnpm-lock.yaml`, `pnpm-workspace.yaml`.
- **Framework**: [`whatsapp-web.js`](https://wwebjs.dev) (Puppeteer-based, CDP).
- **DB**: SQLite via built-in `node:sqlite` (Node ≥22.5). Migrations auto-run from `migrations/*.sql` on startup.
- **System deps**: `ffmpeg`, `yt-dlp` (must be on `PATH`). Puppeteer bundles Chromium by default or set `CHROME_PATH` in `.env`.
- **Docker**: image `ghcr.io/puppeteer/puppeteer:25.0.4` + `ffmpeg` + `yt-dlp` (pip). Mount `data/` volume for persistent session.

## Architecture

- Single file: `app.js` is the entrypoint and contains everything.
- WhatsApp auth uses `LocalAuth` — session persists in `data/`. QR code printed on first run.
- i18n: `i18n/<lang>.json`. Add a new file + re-export in `i18n/index.js`. Keys must match `en.json`. Set via `APP_LANG` env var.
- Commands defined in `options` array (line 40-49). Dispatched by `handle_message()`.
- `wa` import is the `whatsapp-web.js` namespace: `wa.Client`, `wa.Message`, `wa.MessageMedia`, etc.

## Gotchas

- **Browser disconnects during long ops** — `!dl`, `!cmp`, `!ffmpeg` take minutes. Puppeteer CDP target can close. `msg_reply()` (line 948) handles this: tries `message.reply()`, falls back to `client.sendMessage()`, then triggers `handle_disconnect()` and polls for reconnection before retrying.
- **Reconnection** — both WhatsApp-level (`disconnected` event) and Puppeteer-level (`browser disconnected`, `page close` listeners) feed into `handle_disconnect()`. Exponential backoff up to 30s, max 10 attempts.
- **Never use bare `message.reply()` after a long async gap** — always use `msg_reply(message, ...)`. The old frame is gone after reconnect.
- **`config.ready_at`** — set to `Date` on `ready`, null on disconnect. Entry guard at line 273 rejects messages during reconnection window. Not useful as a pre-send guard (frame can detach mid-op).
- **`reconnecting` flag** — prevents concurrent reconnection attempts. Reset on `ready` and in `reconnect_loop()` finally block.
- **Env vars**: `OWNER_NUMBERS` (comma-separated, with country code), `APP_LANG`, `CHROME_PATH`. See `.env.example`.
- **Commit messages**: prefix (`fix:`, `feat:`, `chore:`, etc), very short first line, explanation on following lines.
- **Never commit or push without asking** — stage and show changes, wait for explicit approval.

## Setup

```bash
cp .env.example .env
# edit .env
pnpm i
pnpm dlx puppeteer browsers install  # optional, default chromium
# set CHROME_PATH in .env if using different browser
pnpm start
```

For long-running service:
```bash
pnpm add -g pm2
pm2 start app.js --name=wa-bot --node-args="--env-file=.env"
pm2 logs wa-bot --out --lines 100  # view QR code
```

Docker:
```bash
docker build -t wa-bot:latest .
docker run -d --cpus="0.7" --env-file .env --name wa-bot -v $(pwd)/data:/app/data wa-bot:latest
```
