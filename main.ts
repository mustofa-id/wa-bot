import { useSQLiteAuthState } from "#lib/auth.ts";
import { ConversationManager, isPrompt } from "#lib/conversation.ts";
import { getAllPlugins } from "#lib/plugins.ts";
import { isUserEnabled, tryUpdateUserName } from "#lib/users.ts";
import { phoneFromJid, randomInt } from "#lib/utils.ts";
import createWASocket, { downloadMediaMessage, type AnyMessageContent } from "baileys";
import mime from "mime-types";
import { basename } from "node:path";
import { setTimeout } from "node:timers/promises";
import qrcode from "qrcode";

const plugins = await getAllPlugins();

const userQueues = new Map<string, Promise<void>>();
let globalQueue: Promise<void> | null = null;

function enqueue(key: string, fn: () => Promise<void>): Promise<void> {
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

function mediaTypeOf(content: Record<string, any> | null | undefined): BotAttachmentType | undefined {
	if (content?.documentMessage) return "document";
	if (content?.videoMessage) return "video";
	if (content?.imageMessage) return "image";
	if (content?.audioMessage) return "audio";
	if (content?.stickerMessage) return "sticker";
	return undefined;
}

function mediaMetaOf(content: Record<string, any> | null | undefined): { mimeType?: string; fileName?: string } {
	if (content?.documentMessage) {
		return { mimeType: content.documentMessage.mimetype, fileName: content.documentMessage.fileName };
	}
	if (content?.videoMessage) return { mimeType: content.videoMessage.mimetype };
	if (content?.imageMessage) return { mimeType: content.imageMessage.mimetype };
	if (content?.audioMessage) return { mimeType: content.audioMessage.mimetype };
	return {};
}

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
	const waSocket = createWASocket({ auth: state });
	const conversationManager = new ConversationManager();

	waSocket.ev.on("creds.update", saveCreds);

	waSocket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
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

	waSocket.ev.on("messages.upsert", async ({ messages, type }) => {
		console.log(`messages.upsert: type=${type}, count=${messages.length}`);
		if (type != "notify") return;

		for (const msg of messages) {
			// if (msg.key.fromMe) continue;
			if (msg.broadcast) continue; // skip broadcast like contact Status update

			const isGroup = msg.key.remoteJid?.trim()?.endsWith("@g.us") || false;

			const user: BotUser = {
				id: isGroup ? msg.key.participant! : msg.key.remoteJid!,
				idAlt: isGroup ? msg.key.participantAlt! : msg.key.remoteJidAlt!,
				username: isGroup ? msg.key.participantUsername : msg.key.remoteJidUsername,
				fullName: msg.pushName,
			};

			const targetJid = msg.key.remoteJid!; // correct for user or group

			const text =
				msg.message?.conversation ||
				msg.message?.extendedTextMessage?.text ||
				msg.message?.imageMessage?.caption ||
				msg.message?.videoMessage?.caption ||
				msg.message?.documentMessage?.caption;

			console.log(`[${new Date().toLocaleString()}] 💬 ${user.idAlt} (${user.fullName || "<no name>"}): ${text}`);

			if (!text) continue;

			const trimmed = text.trim();

			try {
				await waSocket.readMessages([msg.key]);
				await waSocket.sendPresenceUpdate("composing", targetJid);
			} catch {}
			await setTimeout(randomInt(2_000, 4_000));

			if (conversationManager.resolve(user.id, trimmed)) continue;
			if (!trimmed.startsWith("!")) continue;

			const ownerPhone = phoneFromJid(state.creds.me?.id ?? "");
			const senderPhone = phoneFromJid(user.idAlt ?? user.id);

			const [cmd, ...args] = trimmed.split(/\s+/);
			const plugin = plugins.find((p) => p.command == cmd);

			try {
				if (senderPhone !== ownerPhone && !isUserEnabled(senderPhone)) {
					throw new Error("Kamu tidak terdaftar atau tidak diizinkan menggunakan aplikasi ini.");
				}

				tryUpdateUserName(senderPhone, user.fullName);

				if (!plugin) {
					throw new Error(`Perintah \`${cmd}\` tidak dikenali`);
				}

				if (
					(plugin.queue === "user" && userQueues.has(user.id)) ||
					(plugin.queue === "global" && globalQueue !== null)
				) {
					await waSocket.sendMessage(
						targetJid,
						{ text: "Permintaan kamu sedang mengantre, mohon tunggu..." },
						{ quoted: msg },
					);
				}

				const execute = async () => {
					try {
						const msgContent = msg.message;
						const quotedContent = msgContent?.extendedTextMessage?.contextInfo?.quotedMessage;

						const mediaContent = mediaTypeOf(msgContent) ? msgContent : quotedContent;
						const hasOwnMedia = !!mediaTypeOf(msgContent);
						const attachmentType = mediaContent ? mediaTypeOf(mediaContent) : undefined;

						const getAttachment: GetAttachment = async () => {
							if (!mediaContent) throw new Error("Tidak ada lampiran media");

							const targetMsg = hasOwnMedia ? msg : { message: mediaContent };
							const buffer = (await downloadMediaMessage(
								targetMsg as any,
								"buffer",
								{},
								{
									reuploadRequest: waSocket.updateMediaMessage,
									logger: waSocket.logger,
								},
							)) as Buffer;

							const { mimeType, fileName } = mediaMetaOf(mediaContent);

							return { buffer, mimeType, fileName };
						};

						const attachment =
							attachmentType && mediaContent ? { type: attachmentType, get: getAttachment } : undefined;

						const result = await plugin.run({ args, user, attachment });

						if (result && Symbol.asyncIterator in (result as any)) {
							const iter = result as AsyncGenerator<BotPluginResult>;
							let iterResult = await iter.next();
							while (!iterResult.done) {
								const value = iterResult.value;
								await waSocket.sendMessage(targetJid, pluginResultToMessage(value), {
									quoted: value.quoted ? msg : undefined,
								});

								if (isPrompt(value)) {
									const reply = await conversationManager.waitForMessage(user.id);
									iterResult = await iter.next(reply);
								} else {
									iterResult = await iter.next();
								}
							}
						} else if (result) {
							await waSocket.sendMessage(targetJid, pluginResultToMessage(result as BotPluginResult), {
								quoted: (result as BotPluginResult).quoted ? msg : undefined,
							});
						}
					} finally {
						conversationManager.cleanup(user.id);
					}
				};

				switch (plugin.queue) {
					case "user":
						await enqueue(user.id, execute);
						break;
					case "global":
						await enqueue("__global__", execute);
						break;
					default:
						await execute();
						break;
				}
			} catch (error: any) {
				console.error(`Error "${cmd}":`, error);
				await waSocket.sendMessage(
					targetJid,
					{ text: `😵 ${error?.message || "Unknown error"}` },
					{ quoted: msg },
				);
			} finally {
				await waSocket.sendPresenceUpdate("paused", targetJid);
			}
		}
	});
}

await startBot();
