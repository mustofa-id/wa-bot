import { prompt } from "#lib/conversation.ts";
import { registerTask } from "#lib/scheduler.ts";
import { useSqlite } from "#lib/utils.ts";
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

function tz(): string {
	return process.env.TZ || "Asia/Jakarta";
}

/** Convert a Date whose UTC components equal the wall-clock time in `tz` to real UTC. */
function toUtc(date: Date, tz: string): Date {
	const y = date.getUTCFullYear();
	const M = date.getUTCMonth();
	const d = date.getUTCDate();
	const h = date.getUTCHours();
	const m = date.getUTCMinutes();
	const s = date.getUTCSeconds();

	const wallClockMs = Date.UTC(y, M, d, h, m, s);

	const tzDateStr = date.toLocaleString("en-CA", { timeZone: tz });
	const tzTimeStr = date.toLocaleString("en-GB", {
		timeZone: tz,
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const [ty, tm, td] = tzDateStr.split("-").map(Number);
	const [th, tMin, ts] = tzTimeStr.split(":").map(Number);
	const tzWallClockMs = Date.UTC(ty, tm - 1, td, th, tMin, ts);

	const tzOffsetMs = tzWallClockMs - date.getTime();

	return new Date(wallClockMs - tzOffsetMs);
}

function parseTime(s: string): { hour: number; minute: number } | null {
	let m = s.match(/^(\d{1,2})[:.](\d{2})$/);
	if (m) {
		const h = parseInt(m[1]);
		const min = parseInt(m[2]);
		if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, minute: min };
	}

	m = s.match(/^(\d{3,4})$/);
	if (m) {
		const ds = m[1];
		if (ds.length === 3) {
			const h = parseInt(ds[0]);
			const min = parseInt(ds.substring(1));
			if (h >= 0 && h <= 9 && min >= 0 && min <= 59) return { hour: h, minute: min };
		} else {
			const h = parseInt(ds.substring(0, 2));
			const min = parseInt(ds.substring(2));
			if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, minute: min };
		}
	}

	return null;
}

function parseDate(s: string): { year: number; month: number; day: number } | null {
	let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (m) return { year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) };

	m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
	if (m) return { year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) };

	m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
	if (m) return { year: parseInt(m[3]), month: parseInt(m[2]), day: parseInt(m[1]) };

	m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (m) return { year: parseInt(m[3]), month: parseInt(m[2]), day: parseInt(m[1]) };

	m = s.match(/^(\d{8})$/);
	if (m) {
		const str = m[1];
		const y1 = parseInt(str.substring(0, 4));
		const m1 = parseInt(str.substring(4, 6));
		const d1 = parseInt(str.substring(6, 8));
		if (y1 >= 2000 && y1 <= 2099 && m1 >= 1 && m1 <= 12 && d1 >= 1 && d1 <= 31) {
			return { year: y1, month: m1, day: d1 };
		}
		const d2 = parseInt(str.substring(0, 2));
		const m2 = parseInt(str.substring(2, 4));
		const y2 = parseInt(str.substring(4, 8));
		if (y2 >= 2000 && y2 <= 2099 && m2 >= 1 && m2 <= 12 && d2 >= 1 && d2 <= 31) {
			return { year: y2, month: m2, day: d2 };
		}
		return null;
	}

	return null;
}

function parseDateTime(timeStr: string, dateStr?: string): Date | null {
	const time = parseTime(timeStr);
	if (!time) return null;

	let date: { year: number; month: number; day: number } | null = null;

	if (dateStr) {
		date = parseDate(dateStr);
		if (!date) return null;
	} else {
		const now = new Date();
		const ds = now.toLocaleString("en-CA", { timeZone: tz() });
		const [y, m, d] = ds.split("-").map(Number);
		date = { year: y, month: m, day: d };
	}

	if (date.month < 1 || date.month > 12) return null;
	if (date.day < 1 || date.day > 31) return null;

	const wallClockMs = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);

	return toUtc(new Date(wallClockMs), tz());
}

const plugin: BotPlugin = {
	command: "!reminder",
	description: "Membuat pengingat. Gunakan: `!reminder <waktu> [tanggal]`",
	queue: "user",
	async *run({ args, user, quoted }) {
		const timeStr = args[0];
		const dateStr = args[1];

		if (!timeStr) {
			return {
				type: "text",
				text: "Gunakan: `!reminder <waktu> [tanggal]`",
				quoted: true,
			};
		}

		const remindAt = parseDateTime(timeStr, dateStr);
		if (!remindAt) {
			return {
				type: "text",
				text:
					"Tidak dapat memahami format waktu. Coba:\n" +
					"- `!reminder 14:30`\n" +
					"- `!reminder 14:30 2026-05-28`\n" +
					"- `!reminder 1430 28052026`",
				quoted: true,
			};
		}

		const reminderText =
			quoted?.text ||
			(yield prompt({
				type: "text",
				text: "Apa yang ingin diingatkan?",
				quoted: true,
			}));

		addReminder(user.lidJid, user.lidJid, reminderText, remindAt);

		const reminderDateTime = remindAt.toLocaleString("id-ID", {
			timeZone: tz(),
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});

		return {
			type: "text",
			text: `Pengingat dibuat untuk: \n> ${reminderDateTime}`,
			quoted: true,
		};
	},
};

export default plugin;
