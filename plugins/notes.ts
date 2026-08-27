import { useSqlite } from "#lib/utils.ts";
import { prompt } from "../lib/conversation.ts";

const db = await useSqlite("notes");

db.exec(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL,
  message_id TEXT,
  creator_jid TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
)`);

const insertStmt = db.prepare(
	"INSERT INTO notes (jid, message_id, creator_jid, title, content) VALUES (?, ?, ?, ?, ?)",
);
const selectListStmt = db.prepare(
	"SELECT id, title, substr(content, 1, 30) AS excerpt FROM notes WHERE jid = ? ORDER BY id",
);
const selectDetailStmt = db.prepare("SELECT * FROM notes WHERE id = ? AND jid = ?");
const updateContentStmt = db.prepare(
	"UPDATE notes SET content = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ? AND jid = ?",
);
const deleteStmt = db.prepare("DELETE FROM notes WHERE id = ? AND jid = ?");

type NoteRow = {
	id: number;
	jid: string;
	message_id: string | null;
	creator_jid: string;
	title: string;
	content: string;
	updated_by: string | null;
	created_at: string;
	updated_at: string | null;
};

type NoteListItem = { id: number; title: string; excerpt: string };

function createNote(chatId: string, messageId: string | null, creatorJid: string, title: string, content: string) {
	return insertStmt.run(chatId, messageId, creatorJid, title, content);
}

function listNotes(chatId: string) {
	return selectListStmt.all(chatId) as NoteListItem[];
}

function getNote(id: number, chatId: string) {
	return selectDetailStmt.get(id, chatId) as NoteRow | undefined;
}

function updateNote(id: number, chatId: string, content: string, updaterJid: string) {
	return updateContentStmt.run(content, updaterJid, id, chatId);
}

function removeNote(id: number, chatId: string) {
	return deleteStmt.run(id, chatId);
}

export default {
	command: "!notes",
	description: "Kelola catatan. Gunakan: !notes add, !notes ls, !notes <id>, !notes update <id>, !notes rm <id>",
	queue: "user",
	async *run({ args, user, chatId, quoted }) {
		const sub = args[0] || "ls";

		if (sub === "add") {
			const titleResp = yield prompt({
				type: "text",
				text: "Judul catatan:",
			});
			const title = (titleResp.text ?? "").trim();
			if (!title) {
				throw new Error("Judul tidak boleh kosong.");
			}

			const contentResp = yield prompt({
				type: "text",
				text: "Isi catatan:",
			});
			const content = (contentResp.text ?? "").trim();
			if (!content) {
				throw new Error("Isi catatan tidak boleh kosong.");
			}

			const { lastInsertRowid } = createNote(chatId, quoted?.id || null, user.lidJid, title, content);
			return {
				type: "text",
				text: `Catatan \`#${lastInsertRowid}\` *${title}* berhasil ditambahkan.`,
				quoted: true,
			};
		}

		if (sub === "ls") {
			const rows = listNotes(chatId);
			if (!rows.length) {
				return { type: "text", text: "Belum ada catatan.", quoted: true };
			}
			const lines = rows.map((r) => `- #${r.id} *${r.title}* — ${r.excerpt}...`);
			return { type: "text", text: `*Catatan (${rows.length}):*\n${lines.join("\n")}`, quoted: true };
		}

		if (sub === "update") {
			const id = Number(args[1]);
			if (!Number.isFinite(id) || id < 1) {
				throw new Error("Gunakan: `!notes update <id>`");
			}
			const row = getNote(id, chatId);
			if (!row) {
				throw new Error("Catatan tidak ditemukan.");
			}

			const contentResp = yield prompt({
				type: "text",
				text: `*${row.title}*\n\n${row.content}\n\n${"─".repeat(14)}\nMasukkan isi baru:`,
			});
			const newContent = (contentResp.text ?? "").trim();
			if (!newContent) {
				throw new Error("Isi catatan tidak boleh kosong.");
			}

			updateNote(id, chatId, newContent, user.lidJid);
			return { type: "text", text: `Catatan \`#${id}\` *${row.title}* berhasil diperbarui.`, quoted: true };
		}

		if (sub === "rm") {
			const id = Number(args[1]);
			if (!Number.isFinite(id) || id < 1) {
				throw new Error("Gunakan: `!notes rm <id>`");
			}
			const row = getNote(id, chatId);
			if (!row) {
				throw new Error("Catatan tidak ditemukan.");
			}
			removeNote(id, chatId);
			return { type: "text", text: `Catatan \`#${id}\` *${row.title}* berhasil dihapus.`, quoted: true };
		}

		// default: sub === "ls" or !notes <id>
		const id = Number(sub);
		if (Number.isFinite(id) && id >= 1) {
			const row = getNote(id, chatId);
			if (!row) {
				throw new Error("Catatan tidak ditemukan.");
			}
			const lines = [
				`*#${row.id} ${row.title}*`,
				"",
				row.content,
				"",
				`${"─".repeat(14)}`,
				`Dibuat: ${row.created_at}`,
			];
			if (row.updated_at) {
				lines.push(`Diperbarui: ${row.updated_at}`);
			}
			return { type: "text", text: lines.join("\n"), quoted: true };
		}

		// unknown subcommand — show help
		throw new Error(
			"Gunakan: `!notes add`, `!notes ls`, `!notes <id>`, `!notes update <id>`, atau `!notes rm <id>`",
		);
	},
} satisfies BotPlugin;

export { createNote, getNote, listNotes, removeNote, updateNote };
