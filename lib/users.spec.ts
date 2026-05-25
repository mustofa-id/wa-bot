import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";

describe("users", () => {
	let tempDir: string;
	let originalDataDir: string | undefined;
	let mod: typeof import("#lib/users.ts");

	before(async () => {
		originalDataDir = process.env.DATA_DIR;
		tempDir = await mkdtemp(join(tmpdir(), "users-test-"));
		process.env.DATA_DIR = `file://${tempDir}/`;
		mod = await import("#lib/users.ts");
	});

	after(async () => {
		process.env.DATA_DIR = originalDataDir;
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	afterEach(() => {
		// remove all users after each test
		for (const u of mod.listUsers()) {
			mod.removeUser(String(u.id));
		}
	});

	it("addUser inserts a user", () => {
		mod.addUser("6281111111111", "Alice");
		const users = mod.listUsers();
		const alice = users.find((u) => u.phone === "6281111111111");
		assert.ok(alice);
		assert.equal(alice.name, "Alice");
		assert.equal(alice.enabled, 1);
	});

	it("addUser with optional name works", () => {
		mod.addUser("6282222222222");
		const users = mod.listUsers();
		const u = users.find((u) => u.phone === "6282222222222");
		assert.ok(u);
		assert.equal(u.name, null);
	});

	it("isUserEnabled returns true for newly added user", () => {
		mod.addUser("6283333333333");
		assert.equal(mod.isUserEnabled("6283333333333"), true);
	});

	it("isUserEnabled returns false for unknown phone", () => {
		assert.equal(mod.isUserEnabled("6289999999999"), false);
	});

	it("disableUser sets enabled to 0", () => {
		mod.addUser("6284444444444");
		mod.disableUser("6284444444444");
		assert.equal(mod.isUserEnabled("6284444444444"), false);
	});

	it("enableUser re-enables a disabled user", () => {
		mod.addUser("6285555555555");
		mod.disableUser("6285555555555");
		mod.enableUser("6285555555555");
		assert.equal(mod.isUserEnabled("6285555555555"), true);
	});

	it("removeUser by phone deletes user", () => {
		mod.addUser("6286666666666");
		mod.removeUser("6286666666666");
		assert.equal(mod.isUserEnabled("6286666666666"), false);
	});

	it("removeUser by id deletes user", () => {
		mod.addUser("6287777777777");
		const users = mod.listUsers();
		const u = users.find((u) => u.phone === "6287777777777");
		assert.ok(u);
		mod.removeUser(String(u.id));
		assert.equal(mod.isUserEnabled("6287777777777"), false);
	});

	it("listUsers returns all users ordered by id", () => {
		mod.addUser("6288888888881", "Z");
		mod.addUser("6288888888882", "A");
		const users = mod.listUsers();
		const z = users.find((u) => u.phone === "6288888888881");
		const a = users.find((u) => u.phone === "6288888888882");
		assert.ok(z);
		assert.ok(a);
		assert.ok(z.id < a.id);
	});

	it("tryUpdateUserName sets name when name is null", () => {
		mod.addUser("6281234500001");
		mod.tryUpdateUserName("6281234500001", "Updated");
		const users = mod.listUsers();
		const u = users.find((u) => u.phone === "6281234500001");
		assert.equal(u?.name, "Updated");
	});

	it("tryUpdateUserName does not overwrite existing name", () => {
		mod.addUser("6281234500002", "Original");
		mod.tryUpdateUserName("6281234500002", "Overwrite");
		const users = mod.listUsers();
		const u = users.find((u) => u.phone === "6281234500002");
		assert.equal(u?.name, "Original");
	});

	it("tryUpdateUserName ignores null name", () => {
		mod.addUser("6281234500003", "Keep");
		mod.tryUpdateUserName("6281234500003", null);
		const users = mod.listUsers();
		const u = users.find((u) => u.phone === "6281234500003");
		assert.equal(u?.name, "Keep");
	});

	it("isUserEnabled returns true for existing user", () => {
		mod.addUser("6281234500004");
		assert.ok(mod.isUserEnabled("6281234500004"));
	});

	it("disableUser by id works", () => {
		mod.addUser("6281234500005");
		const users = mod.listUsers();
		const u = users.find((u) => u.phone === "6281234500005");
		assert.ok(u);
		mod.disableUser(String(u.id));
		assert.equal(mod.isUserEnabled("6281234500005"), false);
	});
});
