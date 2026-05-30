import { useSQLiteAuthState } from "#lib/auth.ts";
import { ConversationManager, isPrompt } from "#lib/conversation.ts";
import { getAllPlugins } from "#lib/plugins.ts";
import { startScheduler } from "#lib/scheduler.ts";
import { checkUserAccess, type UserAccess } from "#lib/users.ts";
import { delay, stripDeviceSuffix } from "#lib/utils.ts";
import createWASocket, { downloadMediaMessage, proto, type AnyMessageContent, type WAMessage } from "baileys";
import mime from "mime-types";
import { basename } from "node:path";
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

let stopScheduler: ReturnType<typeof startScheduler> | null = null;

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

	async function sendMessage(chatId: string, result: BotPluginResult, msg?: WAMessage) {
		const quoted =
			typeof result.quoted == "string"
				? ({
						key: {
							id: result.quoted,
							remoteJid: chatId,
							fromMe: msg?.key?.fromMe || false,
							// `participant` is required for group chat
							participant: result.senderId || msg?.key?.participant,
						},
						// `conversation` is required by Baileys' `generateWAMessageFromContent`
						message: { conversation: "" },
					} satisfies WAMessage)
				: msg;
		await ws.sendMessage(chatId, pluginResultToMessage(result), { quoted });
	}

	stopScheduler?.();
	stopScheduler = startScheduler(sendMessage);

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

	async function simulateComposing(chatId: string, messagesToRead: proto.IMessageKey[] = []) {
		try {
			if (messagesToRead.length) {
				await ws.readMessages(messagesToRead);
			}
			await ws.sendPresenceUpdate("composing", chatId);
			await delay(2_000, 4_000);
		} catch {}
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
				await delay(5_000);
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

			const chatId = msg.key.remoteJid!; // correct for user and group
			const messageId = msg.key.id || "";
			const text = getMessageText(msg);
			if (!text) continue;

			console.log(`[${new Date().toLocaleString()}] ->`, { user: user.pnJid, text });

			const attachment = buildBotAttachment(msg);
			if (cm.resolve(user.lidJid, { id: messageId, text: text, attachment: attachment })) continue;
			if (!text.startsWith("!")) continue;

			await delay(1500, 2500, 500);
			await simulateComposing(chatId, [msg.key]);

			const [cmd, ...args] = text.split(/\s+/);
			const plugin = plugins.find((p) => p.command == cmd);

			try {
				if (stripDeviceSuffix(user.lidJid) !== ownerId && cmd !== "!register") {
					const msg = accessMessages[checkUserAccess(user)];
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
						chatId,
						{ text: "Permintaan kamu sedang mengantre, mohon tunggu..." },
						{ quoted: msg },
					);
				}

				const execute = async () => {
					try {
						const buildQuoted = (): BotPluginMessage | undefined => {
							const quotedInfo = msg.message?.extendedTextMessage?.contextInfo;
							if (!quotedInfo?.quotedMessage) return;
							const quotedMsg = { key: msg.key, message: quotedInfo.quotedMessage };
							return {
								id: quotedInfo.stanzaId || "",
								text: getMessageText(quotedMsg),
								attachment: buildBotAttachment(quotedMsg),
							};
						};

						const result = await plugin.run({
							id: messageId,
							chatId: chatId,
							isGroup: isGroup,
							args: args,
							user: user,
							attachment: attachment,
							quoted: buildQuoted(),
						});

						if (result && Symbol.asyncIterator in result) {
							let iter = await result.next();
							while (!iter.done) {
								await simulateComposing(chatId);
								await sendMessage(chatId, iter.value, msg);
								if (isPrompt(iter.value)) {
									const reply = await cm.waitForMessage(user.lidJid);
									iter = await result.next(reply);
								} else {
									iter = await result.next();
								}
							}
							if (iter.value) await sendMessage(chatId, iter.value, msg);
						} else if (result) {
							await sendMessage(chatId, result, msg);
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
					chatId,
					{ text: `⚠️ Gagal menjalankan perintah \n\n> ${msgFmt}` },
					{ quoted: msg },
				);
			} finally {
				await ws.sendPresenceUpdate("paused", chatId);
			}
		}
	});
}

await startBot();
