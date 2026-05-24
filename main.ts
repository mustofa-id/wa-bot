import { useSQLiteAuthState } from "#lib/auth.ts";
import { getAllPlugins } from "#lib/plugins.ts";
import { isUserEnabled, updateUserName } from "#lib/users.ts";
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
		});
	} else {
		userQueues.set(key, next);
		next.finally(() => {
			if (userQueues.get(key) === next) userQueues.delete(key);
		});
	}
	return next;
}

function mediaTypeOf(content: Record<string, any> | null | undefined): string | undefined {
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

			const user: BotUser = {
				id: msg.key.remoteJid!,
				idAlt: msg.key.remoteJidAlt!,
				username: msg.key.remoteJidUsername,
				fullName: msg.pushName,
			};

			const text =
				msg.message?.conversation ||
				msg.message?.extendedTextMessage?.text ||
				msg.message?.imageMessage?.caption ||
				msg.message?.videoMessage?.caption ||
				msg.message?.documentMessage?.caption;

			console.log(`[${new Date().toLocaleString()}] 💬 ${user.idAlt} (${user.fullName || "<no name>"}): ${text}`);

			if (!text) continue;
			if (!text.trim().startsWith("!")) continue;

			const ownerPhone = phoneFromJid(state.creds.me?.id ?? "");
			const senderPhone = phoneFromJid(user.idAlt ?? user.id);

			const [cmd, ...args] = text.trim().split(/\s+/);
			const plugin = plugins.find((p) => p.command == cmd);

			try {
				await waSocket.readMessages([msg.key]);
				await waSocket.sendPresenceUpdate("composing", user.id);
				await setTimeout(randomInt(2_000, 4_000));

				if (senderPhone !== ownerPhone && !isUserEnabled(senderPhone)) {
					throw new Error("Kamu tidak terdaftar atau tidak diizinkan menggunakan bot ini.");
				}

				if (user.fullName) updateUserName(senderPhone, user.fullName);

				if (!plugin) {
					throw new Error(`Perintah \`${cmd}\` tidak dikenali`);
				}

				if (
					(plugin.queue === "user" && userQueues.has(user.id)) ||
					(plugin.queue === "global" && globalQueue !== null)
				) {
					await waSocket.sendMessage(user.id, {
						text: "Permintaan kamu sedang mengantre, mohon tunggu...",
					});
				}

				const execute = async () => {
					const messageId = msg.key.id!;
					const msgContent = msg.message;
					const quotedContent = msgContent?.extendedTextMessage?.contextInfo?.quotedMessage;

					const mediaContent = mediaTypeOf(msgContent) ? msgContent : quotedContent;
					const hasOwnMedia = !!mediaTypeOf(msgContent);

					const type = mediaContent
						? (mediaTypeOf(mediaContent) as "document" | "image" | "video" | "audio" | "sticker")
						: undefined;

					const downloadAttachment: DownloadAttachment = async () => {
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

					const result = await plugin.run({ args, user, messageId, downloadAttachment, type });

					if (result && Symbol.asyncIterator in (result as any)) {
						for await (const m of result as AsyncGenerator<BotPluginResult>) {
							await waSocket.sendMessage(user.id, pluginResultToMessage(m), {
								quoted: m.quoted ? msg : undefined,
							});
						}
					} else if (result) {
						await waSocket.sendMessage(user.id, pluginResultToMessage(result as BotPluginResult), {
							quoted: (result as BotPluginResult).quoted ? msg : undefined,
						});
					}
				};

				const q = plugin.queue;
				if (q === "user") await enqueue(user.id, execute);
				else if (q === "global") await enqueue("__global__", execute);
				else await execute();
			} catch (error: any) {
				console.error(`Error "${cmd}":`, error);
				await waSocket.sendMessage(user.id, {
					text: `Error: ${error?.message || "Unknown error"}`,
				});
			} finally {
				await waSocket.sendPresenceUpdate("paused", user.id);
			}
		}
	});
}

await startBot();
