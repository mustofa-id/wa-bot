import { prompt } from "#lib/conversation.ts";
import { registerTask } from "#lib/scheduler.ts";
import { useSqlite } from "#lib/utils.ts";
import * as chrono from "chrono-node";
import type { SQLOutputValue } from "node:sqlite";

interface ReminderRow extends Record<string, SQLOutputValue> {
	id: number;
	jid: string;
	creator_jid: string;
	text: string;
	remind_at: string;
	done: number;
	created_at: string;
}

const db = await useSqlite("reminders");

db.exec(`CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL,
  creator_jid TEXT NOT NULL,
  text TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const insertStmt = db.prepare("INSERT INTO reminders (jid, creator_jid, text, remind_at) VALUES (?, ?, ?, ?)");
const markDoneStmt = db.prepare("UPDATE reminders SET done = 1 WHERE id = ?");
const selectDueStmt = db.prepare("SELECT * FROM reminders WHERE done = 0 AND remind_at <= datetime('now')");

registerTask({
	name: "reminders",
	intervalMs: 15_000,
	tick: async (ws) => {
		const due = selectDueStmt.all() as ReminderRow[];
		for (const r of due) {
			try {
				await ws.sendMessage(r.jid, {
					text: `⏰ *Pengingat!*\n${r.text}`,
				});
				markDoneStmt.run(r.id);
			} catch (e) {
				console.error("Failed to send reminder", r.id, e);
			}
		}
	},
});

function addReminder(jid: string, creatorJid: string, text: string, remindAt: Date): ReminderRow {
	const { lastInsertRowid } = insertStmt.run(jid, creatorJid, text, remindAt.toISOString());
	const row = db.prepare("SELECT * FROM reminders WHERE id = ?").get(Number(lastInsertRowid));
	return row as ReminderRow;
}

function normalizeIndonesian(input: string): string {
	let s = input;

	s = s.replace(/\b(\d+)\s*malam\b/gi, "$1 pm");
	s = s.replace(/\b(\d+)\s*pagi\b/gi, "$1 am");
	s = s.replace(/\b(\d+)\s*siang\b/gi, "$1 pm");
	s = s.replace(/\b(\d+)\s*sore\b/gi, "$1 pm");

	s = s.replace(/\bbesok\b/gi, "tomorrow");
	s = s.replace(/\blusa\b/gi, "day after tomorrow");
	s = s.replace(/\bkemarin\b/gi, "yesterday");

	s = s.replace(/\bnanti\b/gi, "later");
	s = s.replace(/\bsekarang\b/gi, "now");
	s = s.replace(/\bjam\b/gi, "");

	const numberWords: Record<string, string> = {
		satu: "1",
		dua: "2",
		tiga: "3",
		empat: "4",
		lima: "5",
		enam: "6",
		tujuh: "7",
		delapan: "8",
		sembilan: "9",
		sepuluh: "10",
	};
	for (const [id, en] of Object.entries(numberWords)) {
		s = s.replace(new RegExp(`\\b${id}\\b`, "gi"), en);
	}

	s = s.replace(/\bpagi\b/gi, "morning");
	s = s.replace(/\bsiang\b/gi, "afternoon");
	s = s.replace(/\bsore\b/gi, "evening");
	s = s.replace(/\bmalam\b/gi, "night");

	return s.replace(/\s+/g, " ").trim();
}

function parseDateTime(input: string): Date | null {
	const text = input.trim();
	if (!text) return null;

	const ref = new Date();
	const opts: chrono.ParsingOption = { forwardDate: true };

	const direct = chrono.parseDate(text, ref, opts);
	if (direct) return direct;

	const normalized = normalizeIndonesian(text);
	const parsed = chrono.parseDate(normalized, ref, opts);
	if (parsed) return parsed;

	return null;
}

const plugin: BotPlugin = {
	command: "!reminder",
	description: "Membuat pengingat. Gunakan: `!reminder <waktu> [tanggal]`",
	queue: "user",
	async *run({ args, user, quoted }) {
		const reminderText = quoted?.text || (yield prompt({ type: "text", text: "Apa yang ingin diingatkan?" }));

		const timeInput = args.join(" ");
		if (!timeInput) {
			return { type: "text", text: "Gunakan: `!reminder <waktu> [tanggal]`", quoted: true };
		}

		const remindAt = parseDateTime(timeInput);
		if (!remindAt) {
			return {
				type: "text",
				text:
					"Tidak dapat memahami format waktu. Coba:\n" +
					"- `!reminder 07:30 2026-05-28`\n" +
					"- `!reminder 7 pm tomorrow`\n" +
					"- `!reminder 8 malam besok`",
				quoted: true,
			};
		}

		addReminder(user.lidJid, user.lidJid, reminderText, remindAt);

		const tgl = remindAt.toLocaleString("id-ID", {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});

		return { type: "text", text: `Pengingat dibuat untuk:\n${tgl}`, quoted: true };
	},
};

export default plugin;
