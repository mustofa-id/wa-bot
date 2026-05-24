# wa-bot-ts — WhatsApp Bot

## Runtime & Toolchain

- **Node ≥22** required — uses `node:sqlite`, `node:test`, `fs.glob`, `Array.fromAsync`, `--watch`, `--env-file`
- **pnpm@11.2.2** — run `pnpm install` after cloning; `pnpm-workspace.yaml` allows native builds for `baileys`, `protobufjs`, `sharp`
- **TypeScript** executed natively (no build step) — `tsconfig.json` has `allowImportingTsExtensions` and `emitDeclarationOnly`
- **No ESLint** — only Prettier for formatting (`pnpm format`). Uses tabs, 4-space tab width, semicolons.
- **No CI/CD, no Docker** - at least for now

## Commands

| Command           | What it does                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `pnpm dev`        | Start bot with file watching (`node --env-file=.env --watch main.ts`) |
| `pnpm test`       | Run all `*.spec.ts` tests (Node test runner)                          |
| `pnpm test:watch` | Run tests in watch mode                                               |
| `pnpm test:file`  | Run single test file                                                  |
| `pnpm format`     | Format all files with Prettier                                        |

## Git

- **Never** commit or sync without user confirmation
- On `main`: semantic commit prefixes (`fix:`, `chore:`, `feat:`, etc.), simple subject line, optional body
- Other branches: short messages OK (squash-merged on GitHub)

## Environment

- `.env` supports several variables
- `.env*` is gitignored (except `.env.example`). Copy `.env` from `.env.example` template.

## Architecture

- **Entrypoint**: `main.ts` — imports `#lib/*` and `#plugins/*` aliases (Node `imports` map in `package.json`)
- **Plugin system**: `lib/plugins.ts:getAllPlugins()` globs `plugins/**.ts`, dynamic-imports each; built-in plugins defined as factory functions (`helpPlugin`, `usersPlugin`) in `lib/plugins.ts`; expects `export default BotPlugin`
- **Plugin interface** (`lib/types.d.ts`):

    ```ts
    type BotPluginResult = (
    	| { type: "text"; text: string }
    	| {
    			type: "document" | "image" | "video";
    			filePath: string;
    			caption?: string;
    	  }
    ) & { quoted?: boolean };

    type BotPluginRun = (ctx: {
    	args: string[];
    	user: BotUser;
    	messageId: string;
    	downloadAttachment: DownloadAttachment;
    	type?: "document" | "image" | "video" | "audio" | "sticker";
    }) => MaybePromise<BotPluginResult | AsyncGenerator<BotPluginResult>>;

    interface BotPlugin {
    	command: `!${string}`; // template literal enforces "!" prefix
    	description?: string;
    	queue?: "user" | "global"; // undefined = no queue
    	run: BotPluginRun;
    }
    ```

- **Generator plugins**: `run` can return an `AsyncGenerator<BotPluginResult>` — the handler iterates and sends each yielded message. Errors propagate to the outer catch; already-sent messages are delivered before the error. Example: `!shd` yields "Mohon tunggu…" then the processed result.
- **Queues**: Plugins with `queue: "user"` are serialized per-user; `queue: "global"` serializes across all users. Notified when queued. In-memory `Map` (no cross-process coordination needed — baileys doesn't support clustering).
- **Command routing**: Incoming messages starting with `!` are split on whitespace; first token matched against `plugin.command`
- **Auth**: WhatsApp session persisted in SQLite (`data/auth.db`) via `lib/auth.ts` using `node:sqlite`. Owner is identified by comparing phone numbers (extracted via `phoneFromJid` from `state.creds.me?.id`). Built-in plugins like `!users` call `useSQLiteAuthState()` directly to resolve the owner phone at runtime.
- **Media fallback**: `downloadAttachment` checks current message first; if no media, falls back to `msg.message.extendedTextMessage.contextInfo.quotedMessage`. `type` reflects whichever has media.

## Testing

- Uses Node built-in `node:test` + `node:assert` (no Jest/Vitest)
- Test files: `*.spec.ts` alongside source files
- Example: `lib/utils.spec.ts` tests `getDataDir`, `randomInt`, `phoneFromJid`, `normalizePhone`, `ffmpeg`, and `ffprobe`

## Gotchas

- Plugin commands must include the `!` prefix in the `command` field (e.g. `"!help"` not `"help"`)
- `BotHook` and `BotAdapter` interfaces in `lib/types.d.ts` are **unimplemented TODOs** — not ready for use
- Error messages to users are in Indonesian for now and planned to use i18n
- Custom cSpell dictionary at `./spelling.dic` (add project-specific words there)
- `gitignore` ignores `/data` and `*.db` files
- There is no database migration for now
