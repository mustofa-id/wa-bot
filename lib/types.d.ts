type MaybePromise<T> = Promise<T> | T;

interface BotAttachment {
	type: "document" | "image" | "video" | "audio" | "sticker";
	get: () => Promise<{
		buffer: Buffer;
		mimeType?: string;
		fileName?: string;
	}>;
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
) & { quoted?: boolean };

type BotPluginRun = (context: {
	args: string[];
	user: BotUser;
	attachment?: BotAttachment;
	quoted?: {
		text?: string;
		attachment?: BotAttachment;
	};
}) => MaybePromise<BotPluginResult | AsyncGenerator<BotPluginResult>>;

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
