# Personal WhatsApp Bot

Uses a plugin-based architecture — commands auto-discover from the `plugins/` directory. Runs on Node.js with native TypeScript (no build step).

## Features

- **Plugin system** — drop a file in `plugins/`, export a `BotPlugin`, and `!your-command` works immediately
- **Status HD** — convert image/video attachments or URLs to HD-ready status with auto-splitting
- **Queues** — per-user or global serialization for long-running plugins
- **Generator plugins** — yield intermediate progress messages and interactive prompts
- And more...

## Requirements

- Node.js ≥ 22
- pnpm 11.2.2 (managed via corepack)
- ffmpeg + ffprobe, ghostscript, yt-dlp (optional — per-plugin)

## How to Run

### Development

```bash
pnpm install
pnpm dev
```

### Production

Run with `./deploy.sh` script (Linux/Unix only) or manually:

With PM2:

```bash
pnpm add -g pm2
pm2 start main.ts --interpreter node --interpreter-args "--env-file=.env" --name wa-bot
```

With Podman:

```bash
podman build -t wa-bot:latest .
podman run -d --env-file .env --name wa-bot -v "$(pwd)/data:/app/data" wa-bot:latest
```

With Docker:

```bash
docker build -t wa-bot:latest .
docker run -d --env-file .env --name wa-bot -v "$(pwd)/data:/app/data" wa-bot:latest
```

## License

MIT
