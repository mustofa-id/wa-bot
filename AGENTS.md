# wa-bot-ts — WhatsApp Bot

## Runtime & Toolchain

- **Node ≥22** required — uses `node:sqlite`, `node:test`, `fs.glob`, `Array.fromAsync`, `--watch`, `--env-file`
- **pnpm@11.2.2** (via corepack) — `pnpm-workspace.yaml` allows native builds for `baileys`, `protobufjs`, `sharp`
- **TypeScript** executed natively (no build step) — `tsconfig.json` has `allowImportingTsExtensions`, `emitDeclarationOnly`, `checkJs: true`
- **Prettier** only — tabs, 4-space tab width, semicolons, 120 print width. Run `pnpm format`.

## Commands

| Command                            | What it does                                                          |
| ---------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev`                         | Start bot with file watching (`node --env-file=.env --watch main.ts`) |
| `pnpm test`                        | Run all `*.spec.ts` tests (Node test runner)                          |
| `pnpm test:watch`                  | Run tests in watch mode                                               |
| `pnpm test:file lib/utils.spec.ts` | Run single test file                                                  |
| `pnpm format`                      | Format all files with Prettier                                        |

## Environment

- `.env` gitignored — copy from `.env.example`. Variables:
    - `DATA_DIR` — data directory (defaults to `<project>/data/`)
    - `FFMPEG_MODE` — ffmpeg mode: `gentle` | `balance` (default) | `performance`
- Tests also require `.env` (commands hardcode `--env-file=.env`)

## Git

- **Never** commit or sync without user confirmation
- `main`: semantic prefixes (`fix:`, `chore:`, `feat:`); other branches: short messages OK (squash-merged)

## Conventions

- **Named parameters for multi-arg functions**: If a function takes more than one parameter, use an object/options parameter instead of positional args. See `lib/utils.ts` (`ffmpeg`, `ghostScript`, `soffice`, etc.) for the pattern.

## Architecture

- **Monolithic**: Baileys (WhatsApp Web library) used directly in `main.ts`. No adapter abstraction.
- **Entrypoint**: `main.ts` — imports via `#lib/*` and `#plugins/*` aliases (Node `imports` map in `package.json`)
- **Plugin auto-discovery**: `lib/plugins.ts:getAllPlugins(ownerId)` globs `plugins/**.ts`, dynamic-imports each; expects `export default BotPlugin`. Called inside `startBot()` in `main.ts` so `ownerId` (derived from auth state) is available.
- **Built-in plugins**: `!help`, `!register`, and `!users` defined as factory functions in `lib/plugins.ts` (not in `plugins/` dir)
- **Plugin shape** (`lib/types.d.ts`): `command` (template literal `!${string}`), `description?`, `queue?` (`"user"`/`"global"`), `run(ctx)`. Plugins use `satisfies BotPlugin` for type safety.
- **Generator plugins**: `run` returns `AsyncGenerator<BotPluginResult>` — yields "Mohon tunggu…" then processed result. Errors after yields still deliver sent messages.
- **Interactive plugins**: `yield prompt({ type: "text", text: "?" })` waits for user text reply — evaluates to the reply string. Non-`!` messages from a user with a pending `prompt()` route to resolve it. In-memory sessions with 5 min inactivity timeout.
- **Queues**: `queue: "user"` serializes per-user; `queue: "global"` serializes all. Users notified while queued.
- **Auth**: SQLite-backed (`data/auth.db`) via `lib/auth.ts` using `node:sqlite`. Owner resolved from `state.creds.me?.lid` (stripped of device suffix via `stripDeviceSuffix()`).
- **Users**: SQLite-backed (`data/users.db`) via `lib/users.ts`. Owner-only commands (`!users approve|ls|rm|on|off`). Owner bypasses user check (always permitted even if not in users table).
- **User identity**: `BotUser.lidJid` = LID-based JID, `BotUser.pnJid` = phone-number JID, `BotUser.pushName` = `msg.pushName`.
- **Media attachment**: `attachment.get()` downloads to Buffer. Falls back to quoted message if the command message has no media. `type` reflects whichever source has media.
- **Auto-reconnect**: On connection close, bot waits 5s and restarts unless statusCode 401 (logout).
- **System deps (per-plugin)**: ffmpeg+ffprobe, ghostscript, yt-dlp, LibreOffice (`soffice`). Wrappers in `lib/utils.ts`.

## Testing

- Node built-in `node:test` + `node:assert` (no Jest/Vitest)
- Test files alongside source: `*.spec.ts`
- `lib/utils.spec.ts` conditionally skips ffmpeg/ffprobe/yt-dlp tests if binary unavailable

## Deployment

- `./deploy.sh docker` — builds Docker image, runs container with `--cpus="0.7"`, mounts `./data:/app/data`
- `./deploy.sh pm2` — installs deps, starts via PM2 with `--env-file=.env`
- Docker image (`Dockerfile`) has system deps (ffmpeg, ghostscript, LibreOffice, yt-dlp) pre-installed

## Gotchas

- Plugin commands include `!` prefix in `command` field (e.g. `"!help"` not `"help"`)
- Command matching is **case-sensitive** — `!Help` won't match `!help`
- `BotHook` in `lib/types.d.ts` is an **unimplemented TODO**
- Error messages are in Indonesian (no i18n yet)
- Plugin temp files cleaned with `cleanUp()` after 3.5s delay (fire-and-forget, errors logged to console.warn)
- Error responses always prefixed with `⚠️`
- Custom cSpell dictionary at `./spelling.dic` — wired in `.vscode/settings.json`
- `/data` and `*.db` are gitignored; SQLite WAL artifacts (`*.db-wal`, `*.db-shm`) covered by `/data` gitignore rule
- No database migrations
- **No "bot" in responses**: Avoid "bot" in user-facing messages. Use "aplikasi", "layanan", or rephrase. Exception: `!help` header shows the project name.
- **Docker**: CMD runs `node main.ts` without `--env-file` — pass env at `docker run --env-file .env`
