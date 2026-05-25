import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

describe("useSQLiteAuthState", () => {
	let tempDir: string;
	let originalDataDir: string | undefined;
	let mod: typeof import("#lib/auth.ts");

	before(async () => {
		originalDataDir = process.env.DATA_DIR;
		tempDir = await mkdtemp(join(tmpdir(), "auth-test-"));
		process.env.DATA_DIR = `file://${tempDir}/`;
		mod = await import("#lib/auth.ts");
	});

	after(async () => {
		process.env.DATA_DIR = originalDataDir;
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	it("returns state with creds, keys, and saveCreds", async () => {
		const { state, saveCreds } = await mod.useSQLiteAuthState();
		assert.ok(state.creds);
		assert.equal(typeof state.keys.get, "function");
		assert.equal(typeof state.keys.set, "function");
		assert.equal(typeof saveCreds, "function");
	});

	it("creds have a registrationId from initAuthCreds", async () => {
		const { state } = await mod.useSQLiteAuthState();
		assert.ok(state.creds.registrationId);
		assert.equal(typeof state.creds.registrationId, "number");
	});

	it("keys.get returns empty object for unknown keys", async () => {
		const { state } = await mod.useSQLiteAuthState();
		const result = await state.keys.get("sender-key", ["nonexistent-id"]);
		assert.deepEqual(result, {});
	});

	it("keys.set and keys.get round-trip for sender-key", async () => {
		const { state } = await mod.useSQLiteAuthState();
		const data = { hello: "world", num: 42 };
		await state.keys.set({ "sender-key": { "test-key-1": data } as any });
		const result = await state.keys.get("sender-key", ["test-key-1"]);
		assert.deepEqual(result["test-key-1"], data);
	});

	it("keys.set and keys.get round-trip for session", async () => {
		const { state } = await mod.useSQLiteAuthState();
		const data = { sessionData: true };
		await state.keys.set({ session: { "session-key-1": data } as any });
		const result = await state.keys.get("session", ["session-key-1"]);
		assert.deepEqual(result["session-key-1"], data);
	});

	it("keys.set with null value deletes existing key", async () => {
		const { state } = await mod.useSQLiteAuthState();
		await state.keys.set({ "sender-key": { "delete-me": { val: 1 } as any } });

		await state.keys.set({ "sender-key": { "delete-me": null } });
		const result = await state.keys.get("sender-key", ["delete-me"]);
		assert.deepEqual(result, {});
	});

	it("saveCreds persists creds to database", async () => {
		const { state, saveCreds } = await mod.useSQLiteAuthState();
		const regId = state.creds.registrationId;

		await saveCreds();
		const { state: state2 } = await mod.useSQLiteAuthState();
		assert.equal(state2.creds.registrationId, regId);
	});
});
