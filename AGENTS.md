# wa-bot-ts — WhatsApp Bot

## Runtime & Toolchain

- **Node ≥22** required — uses `node:sqlite`, `node:test`, `fs.glob`, `Array.fromAsync`, `--watch`, `--env-file`
- **pnpm@11.2.2** — `pnpm-workspace.yaml` allows native builds for `baileys`, `protobufjs`, `sharp`
- **TypeScript** executed natively (no build step) — `tsconfig.json` has `allowImportingTsExtensions`, `emitDeclarationOnly`
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

- `.env` gitignored — copy from `.env.example`. Only variable: `DATA_DIR` (defaults to `<project>/data/`)
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
- **System deps (per-plugin)**: ffmpeg+ffprobe, ghostscript, yt-dlp, LibreOffice (`soffice`)

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
- No database migrations
