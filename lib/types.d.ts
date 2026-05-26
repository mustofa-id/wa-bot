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
