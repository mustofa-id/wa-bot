import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

describe("notes CRUD", () => {
	let createNote: typeof import("#plugins/notes.ts").createNote;
	let listNotes: typeof import("#plugins/notes.ts").listNotes;
	let getNote: typeof import("#plugins/notes.ts").getNote;
	let updateNote: typeof import("#plugins/notes.ts").updateNote;
	let removeNote: typeof import("#plugins/notes.ts").removeNote;
	let tempDir: string;
	let originalDataDir: string | undefined;

	before(async () => {
		originalDataDir = process.env.DATA_DIR;
		tempDir = await mkdtemp(join(tmpdir(), "notes-test-"));
		process.env.DATA_DIR = `file://${tempDir}/`;
		const mod = await import("#plugins/notes.ts");
		createNote = mod.createNote;
		listNotes = mod.listNotes;
		getNote = mod.getNote;
		updateNote = mod.updateNote;
		removeNote = mod.removeNote;
	});

	after(async () => {
		process.env.DATA_DIR = originalDataDir;
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	const chatId = "123456@g.us";
	const creatorJid = "creator@s.whatsapp.net";

	it("createNote inserts a note and returns lastInsertRowid", () => {
		const result = createNote(chatId, null, creatorJid, "Title", "Content here");
		assert.ok(Number(result.lastInsertRowid) >= 1);
	});

	it("getNote returns the note with all fields", () => {
		const row = getNote(1, chatId);
		assert.ok(row);
		assert.equal(row.id, 1);
		assert.equal(row.jid, chatId);
		assert.equal(row.title, "Title");
		assert.equal(row.content, "Content here");
		assert.equal(row.creator_jid, creatorJid);
		assert.equal(row.updated_by, null);
		assert.equal(row.updated_at, null);
		assert.ok(row.created_at);
	});

	it("listNotes returns items with excerpt truncated to 30 chars", () => {
		createNote(chatId, null, creatorJid, "Second", "A".repeat(50));
		const rows = listNotes(chatId);
		assert.equal(rows.length, 2);
		assert.equal(rows[0].id, 1);
		assert.equal(rows[0].title, "Title");
		assert.equal(rows[0].excerpt, "Content here");
		assert.equal(rows[1].id, 2);
		assert.equal(rows[1].excerpt.length, 30);
	});

	it("listNotes scopes by jid — different jid returns empty", () => {
		const rows = listNotes("99999@g.us");
		assert.equal(rows.length, 0);
	});

	it("updateNote sets content, updated_by, and updated_at", () => {
		const updaterJid = "updater@s.whatsapp.net";
		updateNote(1, chatId, "Updated content", updaterJid);
		const row = getNote(1, chatId);
		assert.ok(row);
		assert.equal(row.content, "Updated content");
		assert.equal(row.updated_by, updaterJid);
		assert.ok(row.updated_at);
	});

	it("updateNote scopes by jid — wrong jid has no effect", () => {
		updateNote(1, "wrong@g.us", "Nope", "x@s.whatsapp.net");
		const row = getNote(1, chatId);
		assert.equal(row?.content, "Updated content");
	});

	it("getNote returns undefined for nonexistent id", () => {
		const row = getNote(999, chatId);
		assert.equal(row, undefined);
	});

	it("removeNote deletes a note", () => {
		removeNote(1, chatId);
		const row = getNote(1, chatId);
		assert.equal(row, undefined);
		const rows = listNotes(chatId);
		assert.equal(rows.length, 1);
	});

	it("removeNote scopes by jid — wrong jid does not delete", () => {
		removeNote(2, "wrong@g.us");
		const row = getNote(2, chatId);
		assert.ok(row);
	});
});
