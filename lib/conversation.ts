export const PROMPT = Symbol("prompt");

export function prompt(result: BotPluginResult): BotPluginResult {
	return { ...result, [PROMPT]: true as const } as any;
}

export function isPrompt(value: BotPluginResult): boolean {
	return PROMPT in value;
}

const CONVERSATION_TIMEOUT = 5 * 60_000;

interface Session {
	resolve: (text: string) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class ConversationManager {
	private sessions = new Map<string, Session>();

	async waitForMessage(userId: string): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.sessions.delete(userId);
				reject(new Error("Percakapan berakhir karena tidak ada respon."));
			}, CONVERSATION_TIMEOUT);
			this.sessions.set(userId, { resolve, reject, timer });
		});
	}

	resolve(userId: string, text: string): boolean {
		const session = this.sessions.get(userId);
		if (!session) return false;
		clearTimeout(session.timer);
		this.sessions.delete(userId);
		session.resolve(text);
		return true;
	}

	cleanup(userId: string): void {
		const session = this.sessions.get(userId);
		if (session) {
			clearTimeout(session.timer);
			this.sessions.delete(userId);
		}
	}
}
