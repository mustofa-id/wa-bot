type MaybePromise<T> = Promise<T> | T;

type GetAttachment = () => Promise<{
	buffer: Buffer;
	mimeType?: string;
	fileName?: string;
}>;

type BotAttachmentType = "document" | "image" | "video" | "audio" | "sticker";

type BotPluginResult = (
	| {
			type: "text";
			text: string;
	  }
	| {
			type: BotAttachmentType;
			filePath: string;
			caption?: string;
	  }
) & { quoted?: boolean };

type BotPluginRun = (context: {
	args: string[];
	user: BotUser;
	attachment?: {
		type: BotAttachmentType;
		get: GetAttachment;
	};
}) => MaybePromise<BotPluginResult | AsyncGenerator<BotPluginResult>>;

interface BotUser {
	/** LID JID = lid-based identity */
	id: string;
	/** PN JID = phone-number JID */
	pnJid: string;
	username?: string;
	fullName?: string | null;
}

interface BotPlugin {
	command: `!${string}`;
	description?: string;
	queue?: "user" | "global";
	run: BotPluginRun;
}

// TODO not yet implemented. Hooks before or after processing message
interface BotHook {
	handle: () => MaybePromise<void>;
}

interface AdapterMessage {
	id: string;
	from: string;
	fromPnJid: string;
	chatId: string;
	isGroup: boolean;
	text?: string | null;
	username?: string;
	pushName?: string | null;
	timestamp: number;
	hasMedia: boolean;
	mediaType?: BotAttachmentType;
	_raw: unknown;
	_mediaPayload?: Record<string, any>;
}

interface AdapterConnectionUpdate {
	status: "connecting" | "connected" | "disconnected" | "qr";
	qr?: string;
	reason?: string;
	shouldReconnect: boolean;
	ownerId?: string;
}

interface BotAdapter {
	readonly name: string;
	start(): Promise<void>;
	stop(): Promise<void>;
	onMessage(handler: (msg: AdapterMessage) => void): void;
	onConnectionUpdate(handler: (update: AdapterConnectionUpdate) => void): void;
	sendMessage(jid: string, content: BotPluginResult, quoted?: AdapterMessage): Promise<void>;
	sendPresenceUpdate(jid: string, type: "composing" | "paused"): Promise<void>;
	readMessages(msg: AdapterMessage): Promise<void>;
	downloadMedia(msg: AdapterMessage): Promise<{
		buffer: Buffer;
		mimeType?: string;
		fileName?: string;
	}>;
}
