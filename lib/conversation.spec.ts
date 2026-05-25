import { ConversationManager, isPrompt, PROMPT, prompt } from "#lib/conversation.ts";
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

describe("PROMPT", () => {
	it("is a symbol", () => {
		assert.equal(typeof PROMPT, "symbol");
	});
});

describe("prompt()", () => {
	it("preserves original result properties", () => {
		const result = prompt({ type: "text", text: "hello" });
		assert.equal(result.type, "text");
		assert.equal(result.text, "hello");
	});

	it("makes isPrompt return true", () => {
		const result = prompt({ type: "text", text: "hello" });
		assert.ok(isPrompt(result));
	});

	it("isPrompt returns false for plain result", () => {
		assert.ok(!isPrompt({ type: "text", text: "hello" }));
	});
});

describe("ConversationManager", () => {
	it("resolves waitForMessage when resolve is called", async () => {
		const mgr = new ConversationManager();
		const promise = mgr.waitForMessage("user1");
		mgr.resolve("user1", "reply text");
		assert.equal(await promise, "reply text");
	});

	it("resolve returns false for unknown user", () => {
		const mgr = new ConversationManager();
		assert.equal(mgr.resolve("nobody", "hi"), false);
	});

	it("resolve returns true for pending user", () => {
		const mgr = new ConversationManager();
		mgr.waitForMessage("user2");
		assert.equal(mgr.resolve("user2", "ok"), true);
	});

	it("cleanup removes pending session", () => {
		const mgr = new ConversationManager();
		mgr.waitForMessage("user3");
		mgr.cleanup("user3");
		assert.equal(mgr.resolve("user3", "x"), false);
	});

	it("cleanup is no-op for unknown user", () => {
		const mgr = new ConversationManager();
		mgr.cleanup("nobody");
	});

	it("rejects waitForMessage on timeout", async () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const mgr = new ConversationManager();
		try {
			const promise = mgr.waitForMessage("timeout-user");
			mock.timers.tick(300_001);
			await assert.rejects(promise, { message: "Percakapan berakhir karena tidak ada respon." });
		} finally {
			mock.timers.reset();
		}
	});

	it("cleanup abandons the old promise (not rejected)", () => {
		const mgr = new ConversationManager();
		mgr.waitForMessage("user-reuse");
		mgr.cleanup("user-reuse");

		// old session is gone; a new session can be created for the same userId
		mgr.waitForMessage("user-reuse");
		assert.equal(mgr.resolve("user-reuse", "ok"), true);
	});
});
