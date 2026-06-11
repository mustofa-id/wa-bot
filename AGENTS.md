# wa-bot-ts — WhatsApp Bot

## Runtime & Toolchain

- **Node ≥22** required — uses `node:sqlite`, `node:test`, `fs.glob`, `Array.fromAsync`, `--watch`, `--env-file`
- **pnpm@11.2.2** (via corepack) — `pnpm-workspace.yaml` allows native builds for `baileys`, `protobufjs`, `sharp`
- **TypeScript** executed natively (no build step) — `tsconfig.json` has `allowImportingTsExtensions`, `emitDeclarationOnly`, `checkJs: true`
- **Prettier** only — tabs, 4-space tab width, semicolons, 120 print width. Run `pnpm format` after source changes.

## Commands

| Command                 | What it does                                                          |
| ----------------------- | --------------------------------------------------------------------- |
| `pnpm dev`              | Start bot with file watching (`node --env-file=.env --watch main.ts`) |
| `pnpm test`             | Run all `*.spec.ts` tests (Node test runner)                          |
| `pnpm test:watch`       | Run tests in watch mode                                               |
| `pnpm test:file <path>` | Run single test file (e.g. `pnpm test:file lib/utils.spec.ts`)        |
| `pnpm format`           | Format all files with Prettier                                        |

## Environment

- `.env` gitignored — copy from `.env.example`. Variables:
    - `DATA_DIR` — data directory (defaults to `<project>/data/`)
    - `FFMPEG_MODE` — ffmpeg mode: `gentle` | `balance` (default) | `performance`
    - `TZ` — timezone for time parsing and display (default `Asia/Jakarta`)
- Tests also require `.env` (commands hardcode `--env-file=.env`)

## Git

- **Never** commit or sync without user confirmation
- `main`: semantic prefixes (`fix:`, `chore:`, `feat:`); other branches: short messages OK (squash-merged)

## Conventions

- **Named parameters for same-type multi-arg functions**: If a function takes multiple parameters of the same type (e.g., `foo(string, string)`), use an options object instead of positional args. Different-type pairs like `bar(string, number)` are fine positional.

## Architecture

- **Monolithic**: Baileys (WhatsApp Web library) used directly in `main.ts`. No adapter abstraction.
- **Entrypoint**: `main.ts` — imports via `#lib/*` and `#plugins/*` aliases (Node `imports` map in `package.json`)
- **Plugin auto-discovery**: `lib/plugins.ts:getAllPlugins(ownerId)` globs `plugins/**.ts`, dynamic-imports each; expects `export default BotPlugin`. Called inside `startBot()` in `main.ts` so `ownerId` (derived from auth state) is available.
- **Built-in plugins**: `!help`, `!register`, and `!users` defined as factory functions in `lib/plugins.ts` (not in `plugins/` dir)
- **Plugin shape** (`lib/types.d.ts`): `command` (template literal `!${string}`), `description?`, `queue?` (`"user"`/`"global"`), `run(ctx)`. Plugins use `satisfies BotPlugin` for type safety. All `Bot*` types are global ambient decls — no import needed.
- **Generator plugins**: `run` returns `AsyncGenerator<BotPluginResult>` — yields "Mohon tunggu…" then processed result. Errors after yields still deliver sent messages.
- **Interactive plugins**: `yield prompt({ type: "text", text: "?" })` waits for user text reply — evaluates to the reply string. Non-`!` messages from a user with a pending `prompt()` route to resolve it. In-memory sessions with 5 min inactivity timeout.
- **Queues**: `queue: "user"` serializes per-user; `queue: "global"` serializes all. Users notified while queued.
- **SQLite**: `lib/utils.ts:useSqlite(name)` returns `Promise<DatabaseSync>` with `journal_mode=WAL` and `synchronous=NORMAL`. Called at module top-level (with `await`) in `lib/auth.ts`, `lib/users.ts`, `plugins/reminder.ts`, `plugins/prayers.ts`.
- **Auth**: SQLite-backed (`data/auth.db`) via `lib/auth.ts` using `node:sqlite`. Owner resolved from `state.creds.me?.lid` (stripped of device suffix via `stripDeviceSuffix()`).
- **Users**: SQLite-backed (`data/users.db`) via `lib/users.ts`. Owner-only commands (`!users add|approve|ls|rm|on|off`). `checkUserAccess(user: BotUser)` matches by lidJid first, then falls back to pnJid (updating lidJid on match). Owner bypasses user check. `addUserByPhone(phone)` auto-approves and assigns `PEND#<uuid>` lidJid.
- **User identity**: `BotUser.lidJid` = LID-based JID, `BotUser.pnJid` = phone-number JID, `BotUser.pushName` = `msg.pushName`.
- **Media attachment**: `attachment` from the message's own media only (no fallback). Quoted message media available via `quoted.attachment`.
- **Scheduler**: `lib/scheduler.ts` exports `registerTask({ name, intervalMs, tick })` and `startScheduler(sendMessage)`. Tasks self-register at module load; `main.ts` calls `startScheduler(sendMessage)` once after socket creation (passes the local `sendMessage` helper, not the socket). Used by `plugins/reminder.ts` for periodic polling.
- **Reminders**: `plugins/reminder.ts` — `!reminder <waktu> [tanggal]`, `!reminder ls`, `!reminder rm <id>`. Text from quoted message or prompt. Time parsing via regex (24h `HH:mm`/`HHmm`, date `YYYY-MM-DD`/`DD-MM-YYYY`/etc.) with date aliases (`besok`/`tomorrow` = +1 day, `lusa`/`dayafter` = +2 day, case-insensitive). SQLite-backed, survives restarts.
- **Prayers** (`plugins/prayers.ts`): `!prayers` shows today's prayer times via api.aladhan.com; `!prayers on/off` toggles notifications; `!prayers setup` prompts for city, country, calc method (interactive). Uses native `fetch`. Scheduler ticks every 60s, sends notification when a prayer time matches (caches timings per city/method per day). SQLite-backed config/per-user dedup.
- **Auto-reconnect**: On connection close, bot calls `ws.end()` then waits 5s and restarts unless statusCode 401 (logout). **Concurrent reconnect guard**: `starting` flag prevents duplicate `startBot()` instances.
- **System deps (per-plugin)**: ffmpeg+ffprobe, ghostscript, yt-dlp, gallery-dl, pdf2docx, cpulimit (optional, for PM2 CPU limiting). Wrappers in `lib/utils.ts`.

## Testing

- Node built-in `node:test` + `node:assert` (no Jest/Vitest)
- Test files alongside source: `*.spec.ts`
- `lib/utils.spec.ts` conditionally skips ffmpeg/ffprobe/yt-dlp/pdf2docx/gs tests if binary unavailable
- Tests with SQLite side effects (auth, users) isolate via `DATA_DIR` env override pointing to a temp directory

## Deployment

- `./deploy.sh docker [pct]` — builds Docker image, runs container with `--cpus` = cores × pct/100 (default 100), mounts `./data:/app/data`
- `./deploy.sh pm2 [pct]` — installs deps, starts via PM2 with `--env-file=.env`. Uses `cpulimit` if installed to cap CPU to cores × pct% (e.g. `pm2 80` = 320% on 4 cores)
- Docker image (`Dockerfile`) has system deps (ffmpeg, ghostscript, yt-dlp, gallery-dl, pdf2docx) pre-installed

## Gotchas

- Plugin commands include `!` prefix in `command` field (e.g. `"!help"` not `"help"`)
- Command matching is **case-sensitive** — `!Help` won't match `!help`
- `BotHook` in `lib/types.d.ts` is an **unimplemented TODO**
- Error messages are in Indonesian (no i18n yet)
- Plugin temp files cleaned with `cleanUp()` after 3.5s delay (fire-and-forget, errors logged to console.warn)
- Error responses always prefixed with `⚠️`
- Plugin temp file IDs use `crypto.randomUUID()` — no sequential or timestamp-based IDs
- Custom cSpell dictionary at `./spelling.dic` — wired in `.vscode/settings.json`
- `/data` and `*.db` are gitignored; SQLite WAL artifacts (`*.db-wal`, `*.db-shm`) covered by `/data` gitignore rule
- No database migrations
- **No "bot" in responses**: Avoid "bot" in user-facing messages. Use "aplikasi", "layanan", or rephrase. Exception: `!help` header shows the project name.
- **Docker**: CMD runs `node main.ts` without `--env-file` — pass env at `docker run --env-file .env`
