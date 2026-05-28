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
		for (const u of mod.listUsers()) {
			mod.removeUser(u.id);
		}
	});

	it("addUser inserts a user", () => {
		mod.addUser("6281111111111@s.whatsapp.net", "6281111111111:0@lid", "Alice");
		const users = mod.listUsers();
		const alice = users.find((u) => u.lidJid === "6281111111111:0@lid");
		assert.ok(alice);
		assert.equal(alice.pushName, "Alice");
		assert.equal(alice.pnJid, "6281111111111@s.whatsapp.net");
		assert.equal(alice.enabled, 1);
	});

	it("addUser with optional pushName and username works", () => {
		mod.addUser("6282222222222@s.whatsapp.net", "6282222222222:0@lid");
		const users = mod.listUsers();
		const u = users.find((u) => u.lidJid === "6282222222222:0@lid");
		assert.ok(u);
		assert.equal(u.pushName, null);
		assert.equal(u.username, null);
	});

	it("addUser stores username when provided", () => {
		mod.addUser("6283333333333@s.whatsapp.net", "6283333333333:0@lid", "Bob", "bob_user");
		const users = mod.listUsers();
		const u = users.find((u) => u.lidJid === "6283333333333:0@lid");
		assert.ok(u);
		assert.equal(u.pushName, "Bob");
		assert.equal(u.username, "bob_user");
	});

	it("addUser throws when pnJid is empty", () => {
		assert.throws(() => mod.addUser("", "lid:0@lid"), /pnJid and lidJid are required/);
	});

	it("addUser throws when lidJid is empty", () => {
		assert.throws(() => mod.addUser("pn@s.whatsapp.net", ""), /pnJid and lidJid are required/);
	});

	it("addUser enforces unique lidJid", () => {
		mod.addUser("6281111111111@s.whatsapp.net", "6281111111111:0@lid");
		assert.throws(() => mod.addUser("6284444444444@s.whatsapp.net", "6281111111111:0@lid"), /UNIQUE/);
	});

	it("disableUser sets enabled to 0", () => {
		mod.addUser("6284444444444@s.whatsapp.net", "6284444444444:0@lid");
		const users = mod.listUsers();
		const u = users.find((x) => x.lidJid === "6284444444444:0@lid")!;
		mod.disableUser(u.id);
		assert.equal(
			mod.checkUserAccess({ lidJid: "6284444444444:0@lid", pnJid: "6284444444444@s.whatsapp.net" }),
			"disabled",
		);
	});

	it("enableUser clears disabled status (approval still required)", () => {
		mod.addUser("6285555555555@s.whatsapp.net", "6285555555555:0@lid");
		const users = mod.listUsers();
		const u = users.find((x) => x.lidJid === "6285555555555:0@lid")!;
		mod.disableUser(u.id);
		mod.enableUser(u.id);
		assert.equal(
			mod.checkUserAccess({ lidJid: "6285555555555:0@lid", pnJid: "6285555555555@s.whatsapp.net" }),
			"unapproved",
		);
	});

	it("removeUser by id deletes user", () => {
		mod.addUser("6286666666666@s.whatsapp.net", "6286666666666:0@lid");
		const users = mod.listUsers();
		const u = users.find((x) => x.lidJid === "6286666666666:0@lid")!;
		mod.removeUser(u.id);
		assert.equal(
			mod.checkUserAccess({ lidJid: "6286666666666:0@lid", pnJid: "6286666666666@s.whatsapp.net" }),
			"unregistered",
		);
	});

	it("removeUser throws for invalid id", () => {
		assert.throws(() => mod.removeUser(-1), /Invalid user id/);
		assert.throws(() => mod.removeUser(0), /Invalid user id/);
	});

	it("listUsers returns all users ordered by id", () => {
		mod.addUser("6288888888881@s.whatsapp.net", "6288888888881:0@lid", "Z");
		mod.addUser("6288888888882@s.whatsapp.net", "6288888888882:0@lid", "A");
		const users = mod.listUsers();
		const z = users.find((u) => u.lidJid === "6288888888881:0@lid");
		const a = users.find((u) => u.lidJid === "6288888888882:0@lid");
		assert.ok(z);
		assert.ok(a);
		assert.ok(z!.id < a!.id);
	});

	it("approveUser sets approved_at", () => {
		mod.addUser("6289999999991@s.whatsapp.net", "6289999999991:0@lid");
		const before = mod.listUsers().find((u) => u.lidJid === "6289999999991:0@lid")!;
		assert.equal(before.approved_at, null);

		mod.approveUser(before.id);
		const after = mod.listUsers().find((u) => u.lidJid === "6289999999991:0@lid")!;
		assert.ok(after.approved_at);
	});

	it("approveUser throws for invalid id", () => {
		assert.throws(() => mod.approveUser(-1), /Invalid user id/);
	});

	it("enableUser throws for invalid id", () => {
		assert.throws(() => mod.enableUser(0), /Invalid user id/);
	});

	it("disableUser throws for invalid id", () => {
		assert.throws(() => mod.disableUser(-5), /Invalid user id/);
	});

	it("addUserByPhone creates user with PEND# lidJid and auto-approves", () => {
		const row = mod.addUserByPhone("6287777777777");
		assert.equal(row.pnJid, "6287777777777@s.whatsapp.net");
		assert.match(row.lidJid, /^PEND#\d+$/);
		assert.equal(row.enabled, 1);
		assert.ok(row.approved_at);
	});

	it("addUserByPhone throws on duplicate phone", () => {
		mod.addUserByPhone("6288888888888");
		assert.throws(() => mod.addUserByPhone("6288888888888"), /UNIQUE/);
	});

	it("checkUserAccess matches by pnJid and updates lidJid when lidJid unknown", () => {
		mod.addUser("6289999999990@s.whatsapp.net", "OLD#1");
		const user = mod.listUsers().find((u) => u.lidJid === "OLD#1")!;
		mod.approveUser(user.id);

		const result = mod.checkUserAccess({
			lidJid: "PEND#999",
			pnJid: "6289999999990@s.whatsapp.net",
			pushName: "Updated",
		});
		assert.equal(result, "ok");

		const updated = mod.listUsers().find((u) => u.pnJid === "6289999999990@s.whatsapp.net")!;
		assert.equal(updated.lidJid, "PEND#999");
		assert.equal(updated.pushName, "Updated");
	});

	describe("checkUserAccess", () => {
		it("returns unregistered for unknown lidJid", () => {
			assert.equal(
				mod.checkUserAccess({ lidJid: "unknown:0@lid", pnJid: "" }),
				"unregistered",
			);
		});

		it("returns unapproved for newly registered user", () => {
			mod.addUser("6281111111117@s.whatsapp.net", "6281111111117:0@lid");
			assert.equal(
				mod.checkUserAccess({ lidJid: "6281111111117:0@lid", pnJid: "6281111111117@s.whatsapp.net" }),
				"unapproved",
			);
		});

		it("returns ok for approved user", () => {
			mod.addUser("6281111111118@s.whatsapp.net", "6281111111118:0@lid");
			const u = mod.listUsers().find((x) => x.lidJid === "6281111111118:0@lid")!;
			mod.approveUser(u.id);
			assert.equal(
				mod.checkUserAccess({ lidJid: "6281111111118:0@lid", pnJid: "6281111111118@s.whatsapp.net" }),
				"ok",
			);
		});

		it("returns disabled for disabled user", () => {
			mod.addUser("6281111111119@s.whatsapp.net", "6281111111119:0@lid");
			const u = mod.listUsers().find((x) => x.lidJid === "6281111111119:0@lid")!;
			mod.disableUser(u.id);
			assert.equal(
				mod.checkUserAccess({ lidJid: "6281111111119:0@lid", pnJid: "6281111111119@s.whatsapp.net" }),
				"disabled",
			);
		});
	});
});
