# wa-bot-ts — WhatsApp Bot

## Runtime & Toolchain

- **Node ≥22** required — uses `node:sqlite`, `node:test`, `fs.glob`, `Array.fromAsync`, `--watch`, `--env-file`
- **pnpm@11.2.2** — `pnpm-workspace.yaml` allows native builds for `baileys`, `protobufjs`, `sharp`
- **TypeScript** executed natively (no build step) — `tsconfig.json` has `allowImportingTsExtensions`, `emitDeclarationOnly`, `checkJs: true`
- **Only Prettier** for formatting — tabs, 4-space tab width, semicolons, 120 print width. Run `pnpm format`.
- **No ESLint, no CI/CD**

## Commands

| Command                  | What it does                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| `pnpm dev`               | Start bot with file watching (`node --env-file=.env --watch main.ts`) |
| `pnpm test`              | Run all `*.spec.ts` tests (Node test runner) via `*/**.spec.ts`       |
| `pnpm test:watch`        | Run tests in watch mode                                               |
| `pnpm test:file file.ts` | Run single test file                                                  |
| `pnpm format`            | Format all files with Prettier                                        |

## Environment

- `.env` gitignored — copy from `.env.example`. Variables:
    - `DATA_DIR` — data directory (defaults to `<project>/data/`)
    - `FFMPEG_MODE` — ffmpeg CPU mode: `gentel` | `balance` (default) | `performance`
- Tests also require `.env` (commands hardcode `--env-file=.env`)

## Git

- **Never** commit or sync without user confirmation
- `main`: semantic prefixes (`fix:`, `chore:`, `feat:`); other branches: short messages OK (squash-merged)

## Architecture

- **Entrypoint**: `main.ts` — imports via `#lib/*` and `#plugins/*` aliases (Node `imports` map in `package.json`)
- **Plugin auto-discovery**: `lib/plugins.ts:getAllPlugins()` globs `plugins/**.ts`, dynamic-imports each; expects `export default BotPlugin`
- **Built-in plugins**: `!help` and `!users` defined as factory functions in `lib/plugins.ts` (not in `plugins/` dir)
- **Plugin shape** (`lib/types.d.ts`): `command` (template literal `!${string}`), `description?`, `queue?` (`"user"`/`"global"`), `run(ctx)`. Plugins use `satisfies BotPlugin` for type safety.
- **Generator plugins**: `run` returns `AsyncGenerator<BotPluginResult>` — yields "Mohon tunggu…" then processed result. Errors after yields still deliver sent messages.
- **Queues**: `queue: "user"` serializes per-user; `queue: "global"` serializes all; in-memory `Map`. Users notified while queued.
- **Auth**: SQLite-backed (`data/auth.db`) via `lib/auth.ts` using `node:sqlite`. Owner resolved at runtime via `phoneFromJid(state.creds.me?.id)`.
- **Users**: SQLite-backed (`data/users.db`) via `lib/users.ts`. Owner-only commands (`!users add|ls|rm|on|off`).
- **Media fallback**: `downloadAttachment` checks message first, falls back to quoted message. `type` reflects whichever has media.
- **Auto-reconnect**: On `connection.update` close, bot waits 5s and restarts unless statusCode 401 (logout).
- **System deps (per-plugin)**: ffmpeg+ffprobe, ghostscript, yt-dlp, LibreOffice (`soffice`)
- **Interactive plugins**: `run()` can be an async generator. Use `yield prompt({ type: "text", text: "?" })` to send a message and wait for the user's text reply — the `yield` evaluates to the reply string. `yield` without `prompt()` is fire-and-forget. Non-`!` messages from a user with a pending `prompt()` are routed to resolve it. In-memory sessions with 5 min inactivity timeout.

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
- `BotHook` and `BotAdapter` in `lib/types.d.ts` are **unimplemented TODOs**
- Error messages are in Indonesian (no i18n yet)
- Custom cSpell dictionary at `./spelling.dic` — wired in `.vscode/settings.json`
- `/data` and `*.db` are gitignored
- SQLite databases use WAL mode — `*.db-wal` and `*.db-shm` are expected artifacts (covered by `*.db` gitignore)
- No database migrations
- **Owner bypasses user check**: owner is always permitted even if not in users table
- **No "bot" in responses**: Avoid "bot" in user-facing messages. Use "aplikasi", "layanan", or rephrase. Exception: `!help` header shows the project name.
- **Docker**: CMD runs `node main.ts` without `--env-file` — pass env at `docker run --env-file .env`
