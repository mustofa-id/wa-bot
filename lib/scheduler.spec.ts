import { registerTask, startScheduler } from "#lib/scheduler.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("scheduler", () => {
	it("calls tick immediately with a working sm function", async () => {
		const calls: { jid: string; text: string }[] = [];
		const tickDone = new Promise<void>((resolve) => {
			registerTask({
				name: "test-tick",
				intervalMs: 10_000,
				async tick(sm) {
					await sm("jid@test", { type: "text", text: "hello" });
					resolve();
				},
			});
		});

		const stop = startScheduler((jid, result) => {
			if (result.type === "text") calls.push({ jid, text: result.text });
		});

		await tickDone;
		assert.equal(calls.length, 1);
		assert.equal(calls[0].jid, "jid@test");
		assert.equal(calls[0].text, "hello");
		stop();
	});

	it("throws when started twice", () => {
		registerTask({
			name: "test-double",
			intervalMs: 10_000,
			tick() {},
		});

		const stop = startScheduler(() => {});
		assert.throws(() => startScheduler(() => {}), /Scheduler already started/);
		stop();
	});

	it("stop function clears intervals and resets started state", () => {
		registerTask({
			name: "test-stop",
			intervalMs: 10_000,
			tick() {},
		});

		const stop = startScheduler(() => {});
		assert.doesNotThrow(() => stop());
		const stop2 = startScheduler(() => {});
		stop2();
	});
});
