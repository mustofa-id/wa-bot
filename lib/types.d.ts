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
	messageId: string;
	getAttachment: GetAttachment;
	attachmentType?: BotAttachmentType;
}) => MaybePromise<BotPluginResult | AsyncGenerator<BotPluginResult>>;

interface BotUser {
	id: string;
	idAlt?: string;
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

// TODO not yet implemented. So we can switch between WhatsApp API/lib easily.
interface BotAdapter {}
