import { phoneFromJid } from "#lib/utils.ts";
import createWASocket, {
	DisconnectReason,
	downloadMediaMessage,
	type AnyMessageContent,
	type WAMessage,
	type WAMessageContent,
} from "baileys";
import mime from "mime-types";
import { basename } from "node:path";
import qrcode from "qrcode";
import { useSQLiteAuthState } from "./auth.ts";

function mediaTypeOf(content: WAMessageContent | null | undefined): BotAttachmentType | undefined {
	if (content?.documentMessage) return "document";
	if (content?.videoMessage) return "video";
	if (content?.imageMessage) return "image";
	if (content?.audioMessage) return "audio";
	if (content?.stickerMessage) return "sticker";
	return undefined;
}

export default class BaileysAdapter implements BotAdapter {
	private ws: ReturnType<typeof createWASocket> | null = null;
	private authState: { creds: any; keys: any } | null = null;
	private messageHandler: ((msg: AdapterMessage) => void) | null = null;
	private connectionHandler: ((update: AdapterConnectionUpdate) => void) | null = null;

	readonly name = "baileys";

	async start(): Promise<void> {
		const { state, saveCreds } = await useSQLiteAuthState();
		this.authState = state;
		this.ws = createWASocket({ auth: state });

		this.ws.ev.on("creds.update", saveCreds);
		this.ws.ev.on("connection.update", this.handleConnectionUpdate);
		this.ws.ev.on("messages.upsert", this.handleMessagesUpsert);
	}

	async stop(): Promise<void> {
		this.ws?.end(new Error("adapter stopped"));
		this.ws = null;
	}

	onMessage(handler: (msg: AdapterMessage) => void): void {
		this.messageHandler = handler;
	}

	onConnectionUpdate(handler: (update: AdapterConnectionUpdate) => void): void {
		this.connectionHandler = handler;
	}

	async sendMessage(jid: string, content: BotPluginResult, quoted?: AdapterMessage): Promise<void> {
		const message = this.pluginResultToAnyMessageContent(content);
		await this.ws!.sendMessage(jid, message, {
			quoted: quoted ? (quoted._raw as WAMessage) : undefined,
		});
	}

	async sendPresenceUpdate(jid: string, type: "composing" | "paused"): Promise<void> {
		await this.ws!.sendPresenceUpdate(type, jid);
	}

	async readMessages(msg: AdapterMessage): Promise<void> {
		await this.ws!.readMessages([(msg._raw as WAMessage).key]);
	}

	async downloadMedia(msg: AdapterMessage): Promise<{ buffer: Buffer; mimeType?: string; fileName?: string }> {
		const raw = msg._raw as WAMessage;
		const msgContent = raw.message;
		const quotedContent = msgContent?.extendedTextMessage?.contextInfo?.quotedMessage as WAMessageContent | null;
		const mediaContent = mediaTypeOf(msgContent) || !mediaTypeOf(quotedContent) ? msgContent : quotedContent;
		const hasOwnMedia = !!mediaTypeOf(msgContent);

		if (!mediaContent) throw new Error("Tidak ada lampiran media");

		const targetMsg = hasOwnMedia ? raw : ({ message: mediaContent } as WAMessage);
		const buffer = await downloadMediaMessage(
			targetMsg,
			"buffer",
			{},
			{
				reuploadRequest: this.ws!.updateMediaMessage,
				logger: this.ws!.logger,
			},
		);

		let mimeType: string | undefined;
		let fileName: string | undefined;
		if (mediaContent.documentMessage) {
			mimeType = mediaContent.documentMessage.mimetype!;
			fileName = mediaContent.documentMessage.fileName!;
		} else if (mediaContent.videoMessage) {
			mimeType = mediaContent.videoMessage.mimetype!;
		} else if (mediaContent.imageMessage) {
			mimeType = mediaContent.imageMessage.mimetype!;
		} else if (mediaContent.audioMessage) {
			mimeType = mediaContent.audioMessage.mimetype!;
		}

		return { buffer, mimeType, fileName };
	}

	private handleConnectionUpdate = async ({
		connection,
		lastDisconnect,
		qr,
	}: {
		connection?: string;
		lastDisconnect?: { error?: any; date?: Date };
		qr?: string;
	}) => {
		if (!this.connectionHandler) return;

		if (connection === "close") {
			const lastError = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
			const statusCode = lastError?.output?.statusCode;
			console.warn("closed:", lastDisconnect?.error);

			this.connectionHandler({
				status: "disconnected",
				reason: lastDisconnect?.error?.toString(),
				shouldReconnect: statusCode !== DisconnectReason.loggedOut,
			});
			return;
		}

		if (connection === "open") {
			console.log("connection: open");
			this.connectionHandler({
				status: "connected",
				shouldReconnect: false,
				ownerId: phoneFromJid(this.authState?.creds?.me?.id ?? ""),
			});
		}

		if (qr) {
			const qrh = await qrcode.toString(qr, {
				type: "terminal",
				small: true,
			});
			console.log(qrh);
			this.connectionHandler({
				status: "qr",
				qr,
				shouldReconnect: false,
			});
		}
	};

	private handleMessagesUpsert = async ({ messages, type }: { messages: WAMessage[]; type: string }) => {
		if (type !== "notify" || !this.messageHandler) return;

		for (const raw of messages) {
			if (raw.broadcast) continue;

			const msg = this.waMessageToAdapterMessage(raw);
			if (!msg) continue;

			this.messageHandler(msg);
		}
	};

	private waMessageToAdapterMessage(raw: WAMessage): AdapterMessage {
		const isGroup = raw.key.remoteJid?.trim()?.endsWith("@g.us") ?? false;
		const text = this.extractText(raw);

		const msgContent = raw.message;
		const quotedContent = msgContent?.extendedTextMessage?.contextInfo?.quotedMessage as WAMessageContent | null;
		const mediaContent = mediaTypeOf(msgContent) ? msgContent : quotedContent;
		const attachmentType = mediaContent ? mediaTypeOf(mediaContent) : undefined;

		return {
			id: raw.key.id!,
			from: isGroup ? raw.key.participant! : raw.key.remoteJid!,
			chat: raw.key.remoteJid!,
			isGroup,
			text,
			pushName: raw.pushName,
			timestamp: Number(raw.messageTimestamp),
			hasMedia: !!attachmentType,
			mediaType: attachmentType,
			_raw: raw,
		};
	}

	private extractText(raw: WAMessage): string | undefined | null {
		return (
			raw.message?.conversation ||
			raw.message?.extendedTextMessage?.text ||
			raw.message?.imageMessage?.caption ||
			raw.message?.videoMessage?.caption ||
			raw.message?.documentMessage?.caption
		);
	}

	private pluginResultToAnyMessageContent(result: BotPluginResult): AnyMessageContent {
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
}
