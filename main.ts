import { ConversationManager, isPrompt } from "#lib/conversation.ts";
import { getAllPlugins } from "#lib/plugins.ts";
import { isUserEnabled, tryUpdateUserName } from "#lib/users.ts";
import { createAdapter, phoneFromJid, randomInt } from "#lib/utils.ts";
import { setTimeout } from "node:timers/promises";

const plugins = await getAllPlugins();

const userQueues = new Map<string, Promise<void>>();
let globalQueue: Promise<void> | null = null;

function enqueue(options: { key: string; fn: () => Promise<void> }): Promise<void> {
	const { key, fn } = options;
	const prev = key === "__global__" ? (globalQueue ?? Promise.resolve()) : (userQueues.get(key) ?? Promise.resolve());
	const next = prev.then(fn, fn);
	if (key === "__global__") {
		globalQueue = next;
		next.finally(() => {
			if (globalQueue === next) globalQueue = null;
		}).catch(() => {});
	} else {
		userQueues.set(key, next);
		next.finally(() => {
			if (userQueues.get(key) === next) userQueues.delete(key);
		}).catch(() => {});
	}
	return next;
}

function isAsyncGenerator(value: object): value is AsyncGenerator<BotPluginResult> {
	return value !== null && value !== undefined && Symbol.asyncIterator in value;
}

async function consumePluginResult(options: {
	adapter: BotAdapter;
	conversationManager: ConversationManager;
	msg: AdapterMessage;
	targetJid: string;
	userId: string;
	result: BotPluginResult | AsyncGenerator<BotPluginResult>;
}): Promise<void> {
	const { adapter, conversationManager, msg, targetJid, userId, result } = options;
	if (!result) return;

	if (isAsyncGenerator(result)) {
		let iterResult = await result.next();
		while (!iterResult.done) {
			const value = iterResult.value as BotPluginResult;
			await adapter.sendMessage(targetJid, value, value.quoted ? msg : undefined);

			if (isPrompt(value)) {
				const reply = await conversationManager.waitForMessage(userId);
				iterResult = await result.next(reply);
			} else {
				iterResult = await result.next();
			}
		}
	} else {
		await adapter.sendMessage(targetJid, result, result.quoted ? msg : undefined);
	}
}

async function handlePluginExecution(options: {
	adapter: BotAdapter;
	conversationManager: ConversationManager;
	msg: AdapterMessage;
	targetJid: string;
	user: BotUser;
	args: string[];
	plugin: BotPlugin;
}): Promise<void> {
	const { adapter, conversationManager, msg, targetJid, user, args, plugin } = options;
	const attachment = msg.hasMedia ? { type: msg.mediaType!, get: async () => adapter.downloadMedia(msg) } : undefined;
	try {
		const result = await plugin.run({ args, user, attachment });
		await consumePluginResult({ adapter, conversationManager, msg, targetJid, userId: user.id, result });
	} finally {
		conversationManager.cleanup(user.id);
	}
}

async function startBot() {
	const adapter = await createAdapter();
	const conversationManager = new ConversationManager();

	let ownerPhone = "";

	adapter.onConnectionUpdate((update) => {
		if (update.status === "disconnected") {
			console.warn("closed:", update.reason);
			if (update.shouldReconnect) {
				setTimeout(5_000).then(() => startBot());
			}
			return;
		}

		if (update.status === "connected") {
			console.log("connection: open");
			ownerPhone = update.ownerId ?? "";
		}
	});

	adapter.onMessage(async (msg) => {
		const text = msg.text?.trim();
		if (!text) return;

		const targetJid = msg.chatId;
		const user: BotUser = {
			id: msg.from,
			pnJid: msg.fromPnJid,
			username: msg.username,
			fullName: msg.pushName,
		};

		try {
			await adapter.readMessages(msg);
			await adapter.sendPresenceUpdate(targetJid, "composing");
		} catch {}

		await setTimeout(randomInt(2_000, 4_000));

		if (conversationManager.resolve(user.id, text)) return;
		if (!text.startsWith("!")) return;

		const senderPhone = phoneFromJid(user.pnJid);

		if (senderPhone !== ownerPhone && !isUserEnabled(senderPhone)) {
			await adapter.sendMessage(
				targetJid,
				{ type: "text", text: "Kamu tidak terdaftar atau tidak diizinkan menggunakan aplikasi ini." },
				msg,
			);
			return;
		}

		tryUpdateUserName(senderPhone, user.fullName);

		const [cmd, ...args] = text.split(/\s+/);
		const plugin = plugins.find((p) => p.command == cmd);

		if (!plugin) {
			await adapter.sendMessage(targetJid, { type: "text", text: `Perintah \`${cmd}\` tidak dikenali` }, msg);
			return;
		}

		if (
			(plugin.queue === "user" && userQueues.has(user.id)) ||
			(plugin.queue === "global" && globalQueue !== null)
		) {
			await adapter.sendMessage(
				targetJid,
				{ type: "text", text: "Permintaan kamu sedang mengantre, mohon tunggu..." },
				msg,
			);
		}

		const execute = () =>
			handlePluginExecution({
				adapter,
				conversationManager,
				msg,
				targetJid,
				user,
				args,
				plugin,
			});

		try {
			switch (plugin.queue) {
				case "user":
					await enqueue({ key: user.id, fn: execute });
					break;
				case "global":
					await enqueue({ key: "__global__", fn: execute });
					break;
				default:
					await execute();
					break;
			}
		} catch (error: unknown) {
			console.error(`Error "${cmd}":`, error);
			await adapter.sendMessage(
				targetJid,
				{ type: "text", text: `😵 ${error instanceof Error ? error.message : "Unknown error"}` },
				msg,
			);
		} finally {
			await adapter.sendPresenceUpdate(targetJid, "paused");
		}
	});

	await adapter.start();
}

await startBot();
