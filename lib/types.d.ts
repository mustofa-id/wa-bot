type MaybePromise<T> = Promise<T> | T;

interface BotAttachment {
	type: "document" | "image" | "video" | "audio" | "sticker";
	get: () => Promise<{
		buffer: Buffer;
		mimeType?: string;
		fileName?: string;
	}>;
}

interface BotPluginMessage {
	/** message ID or Key */
	id: string;
	text?: string;
	attachment?: BotAttachment;
}

type BotPluginResult = (
	| {
			type: "text";
			text: string;
	  }
	| {
			type: BotAttachment["type"];
			filePath: string;
			caption?: string;
	  }
) & { quoted?: boolean | BotPluginMessage["id"]; senderId?: string };

type BotPluginResultGenerator = AsyncGenerator<BotPluginResult, BotPluginResult | void, BotPluginMessage>;

type BotPluginRun = (context: {
	id: BotPluginMessage["id"];
	chatId: string;
	isGroup: boolean;
	args: string[];
	user: BotUser;
	attachment?: BotAttachment;
	quoted?: BotPluginMessage;
}) => MaybePromise<BotPluginResult | BotPluginResultGenerator>;

interface BotUser {
	/** LID JID = lid-based identity */
	lidJid: string;
	/** PN JID = phone-number JID */
	pnJid: string;
	username?: string;
	pushName?: string | null;
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
