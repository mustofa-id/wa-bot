import { useSQLiteAuthState } from "#lib/auth.ts";
import { ConversationManager, isPrompt } from "#lib/conversation.ts";
import { getAllPlugins } from "#lib/plugins.ts";
import { checkUserAccess, type UserAccess } from "#lib/users.ts";
import { randomInt, stripDeviceSuffix } from "#lib/utils.ts";
import createWASocket, { downloadMediaMessage, type AnyMessageContent, type WAMessage } from "baileys";
import mime from "mime-types";
import { basename } from "node:path";
import { setTimeout } from "node:timers/promises";
import qrcode from "qrcode";

function getMessageText(msg: WAMessage): string | undefined {
	if (!msg) return undefined;
	return (
		msg.message?.conversation ||
		msg.message?.extendedTextMessage?.text ||
		msg.message?.imageMessage?.caption ||
		msg.message?.videoMessage?.caption ||
		msg.message?.documentMessage?.caption ||
		undefined
	)?.trim();
}

function getAttachmentMeta(msg: WAMessage): { mimeType?: string; fileName?: string; type?: BotAttachment["type"] } {
	if (msg.message?.documentMessage) {
		return {
			mimeType: msg.message?.documentMessage.mimetype || undefined,
			fileName: msg.message?.documentMessage.fileName || undefined,
			type: "document",
		};
	}
	if (msg.message?.videoMessage)
		return {
			mimeType: msg.message.videoMessage.mimetype || undefined,
			type: "video",
		};
	if (msg.message?.imageMessage)
		return {
			mimeType: msg.message.imageMessage.mimetype || undefined,
			type: "image",
		};
	if (msg.message?.audioMessage)
		return {
			mimeType: msg.message.audioMessage.mimetype || undefined,
			type: "audio",
		};

	if (msg.message?.stickerMessage)
		return {
			mimeType: msg.message.stickerMessage.mimetype || undefined,
			type: "sticker",
		};
	return {};
}

const accessMessages: Record<UserAccess, string | undefined> = {
	unregistered:
		"Kamu tidak terdaftar atau tidak diizinkan menggunakan aplikasi ini. \n" +
		"Gunakan perintah `!register` untuk mendaftarkan akun kamu.",
	disabled: "Akun kamu sedang di-nonaktifkan.",
	unapproved: "Akun kamu belum disetujui oleh pemilik. Silakan tunggu persetujuan.",
	ok: undefined,
};

function pluginResultToMessage(result: BotPluginResult): AnyMessageContent {
	switch (result.type) {
		case "text":
			return { text: result.text };
		case "image":
			return { image: { url: result.filePath }, caption: result.caption };
		case "video":
			return { video: { url: result.filePath }, caption: result.caption };
		case "audio":
			return { audio: { url: result.filePath }, caption: result.caption };
		case "sticker":
			return { sticker: { url: result.filePath }, caption: result.caption };
		case "document":
			return {
				document: { url: result.filePath },
				mimetype: mime.lookup(result.filePath) || "application/octet-stream",
				caption: result.caption,
				fileName: basename(result.filePath),
			};
	}
}

async function startBot() {
	const { state, saveCreds } = await useSQLiteAuthState();
	const ownerId = stripDeviceSuffix(state.creds.me?.lid ?? "");
	const plugins = await getAllPlugins(ownerId);
	const userQueues = new Map<string, Promise<void>>();
	let globalQueue: Promise<void> | null = null;

	function enqueue(key: string, fn: () => Promise<void>): Promise<void> {
		const prev =
			key === "__global__" ? (globalQueue ?? Promise.resolve()) : (userQueues.get(key) ?? Promise.resolve());
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

	const cm = new ConversationManager();
	const ws = createWASocket({ auth: state });

	function buildBotAttachment(msg: WAMessage): BotAttachment | undefined {
		const { type, mimeType, fileName } = getAttachmentMeta(msg);
		if (!type) return undefined;
		return {
			type: type,
			get: async () => {
				const buffer = (await downloadMediaMessage(
					msg,
					"buffer",
					{},
					{
						reuploadRequest: ws.updateMediaMessage,
						logger: ws.logger,
					},
				)) as Buffer;
				return { buffer, mimeType, fileName };
			},
		};
	}

	ws.ev.on("creds.update", saveCreds);

	ws.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
		if (connection === "close") {
			const error = lastDisconnect?.error as any;
			const statusCode = error?.output?.statusCode;
			console.warn("closed:", error);

			// don't logout, always reconnect unless explicitly logged out
			const shouldReconnect = statusCode !== 401;
			if (shouldReconnect) {
				// reconnect on pairing restart errors
				await setTimeout(5_000);
				await startBot();
			}
			return;
		}

		if (connection === "open") {
			console.log("connection: open");
		}

		if (qr) {
			const qrh = await qrcode.toString(qr, {
				type: "terminal",
				small: true,
			});
			console.log(qrh);
		}
	});

	ws.ev.on("messages.upsert", async ({ messages, type }) => {
		console.log(`messages.upsert: type=${type}, count=${messages.length}`);
		if (type != "notify") return;

		for (const msg of messages) {
			// if (msg.key.fromMe) continue;
			if (msg.broadcast) continue; // skip broadcast like contact Status update

			const isGroup = msg.key.remoteJid?.trim()?.endsWith("@g.us") || false;
			const user: BotUser = {
				lidJid: isGroup ? msg.key.participant! : msg.key.remoteJid!,
				pnJid: isGroup ? msg.key.participantAlt! : msg.key.remoteJidAlt!,
				username: isGroup ? msg.key.participantUsername : msg.key.remoteJidUsername,
				pushName: msg.pushName,
			};

			const targetJid = msg.key.remoteJid!; // correct for user or group
			const text = getMessageText(msg);
			if (!text) continue;

			console.log(`[${new Date().toLocaleString()}] ->`, { user, text });

			if (cm.resolve(user.lidJid, text)) continue;
			if (!text.startsWith("!")) continue;

			try {
				await ws.readMessages([msg.key]);
				await ws.sendPresenceUpdate("composing", targetJid);
			} catch {}
			await setTimeout(randomInt(2_000, 4_000));

			const senderId = stripDeviceSuffix(user.lidJid);

			const [cmd, ...args] = text.split(/\s+/);
			const plugin = plugins.find((p) => p.command == cmd);

			try {
				if (senderId !== ownerId && cmd !== "!register") {
					const msg = accessMessages[checkUserAccess(senderId)];
					if (msg) throw new Error(msg);
				}

				if (!plugin) {
					throw new Error(`Perintah \`${cmd}\` tidak dikenali`);
				}

				if (
					(plugin.queue === "user" && userQueues.has(user.lidJid)) ||
					(plugin.queue === "global" && globalQueue !== null)
				) {
					await ws.sendMessage(
						targetJid,
						{ text: "Permintaan kamu sedang mengantre, mohon tunggu..." },
						{ quoted: msg },
					);
				}

				const attachment = buildBotAttachment(msg);
				const quotedContent = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
				const buildQuoted = () => {
					if (!quotedContent) return;
					const quotedMsg = { key: msg.key, message: quotedContent };
					return {
						text: getMessageText(quotedMsg),
						attachment: buildBotAttachment(quotedMsg),
					};
				};

				const execute = async () => {
					try {
						const result = await plugin.run({ args, user, attachment, quoted: buildQuoted() });
						if (result && Symbol.asyncIterator in (result as any)) {
							const iter = result as AsyncGenerator<BotPluginResult>;
							let iterResult = await iter.next();
							while (!iterResult.done) {
								const value = iterResult.value;
								await ws.sendMessage(targetJid, pluginResultToMessage(value), {
									quoted: value.quoted ? msg : undefined,
								});

								if (isPrompt(value)) {
									const reply = await cm.waitForMessage(user.lidJid);
									iterResult = await iter.next(reply);
								} else {
									iterResult = await iter.next();
								}
							}
						} else if (result) {
							await ws.sendMessage(targetJid, pluginResultToMessage(result as BotPluginResult), {
								quoted: (result as BotPluginResult).quoted ? msg : undefined,
							});
						}
					} finally {
						cm.cleanup(user.lidJid);
					}
				};

				switch (plugin.queue) {
					case "user":
						await enqueue(user.lidJid, execute);
						break;
					case "global":
						await enqueue("__global__", execute);
						break;
					default:
						await execute();
						break;
				}
			} catch (error: unknown) {
				console.error(`Error "${cmd} ${args}":`, error);
				const msgFmt =
					error instanceof Error
						? error.message.trim().split("\n").filter(Boolean).join("\n> ")
						: "Unknown error";
				await ws.sendMessage(
					targetJid,
					{ text: `⚠️ Perintah Gagal Dijalankan \n\n> ${msgFmt}` },
					{ quoted: msg },
				);
			} finally {
				await ws.sendPresenceUpdate("paused", targetJid);
			}
		}
	});
}

await startBot();
