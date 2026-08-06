import { prompt } from "#lib/conversation.ts";
import { registerTask } from "#lib/scheduler.ts";
import { useSqlite } from "#lib/utils.ts";
import type { SQLOutputValue } from "node:sqlite";

interface ReminderRow extends Record<string, SQLOutputValue> {
	id: number;
	jid: string;
	message_id: string | null;
	creator_jid: string;
	text: string;
	remind_at: string;
	done: number;
	created_at: string;
	repeat_type: string | null;
}

const db = await useSqlite("reminders");

db.exec(`CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL,
  message_id TEXT,
  creator_jid TEXT NOT NULL,
  text TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  repeat_type TEXT DEFAULT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const insertStmt = db.prepare(
	"INSERT INTO reminders (jid, message_id, creator_jid, text, remind_at, repeat_type) VALUES (?, ?, ?, ?, ?, ?)",
);
const markDoneStmt = db.prepare("UPDATE reminders SET done = 1 WHERE id = ?");
const updateRemindAtStmt = db.prepare("UPDATE reminders SET remind_at = ? WHERE id = ?");
const selectDueStmt = db.prepare("SELECT * FROM reminders WHERE done = 0 AND remind_at <= datetime('now')");
const selectByCreatorStmt = db.prepare("SELECT * FROM reminders WHERE creator_jid = ? AND done = 0 ORDER BY remind_at");
const deleteStmt = db.prepare("DELETE FROM reminders WHERE id = ? AND creator_jid = ?");

registerTask({
	name: "reminders",
	intervalMs: 15_000,
	tick: async (sendMessage) => {
		const due = selectDueStmt.all() as ReminderRow[];
		for (const r of due) {
			try {
				await sendMessage(r.jid, {
					type: "text",
					text: `⏰ *Pengingat!* \n> ${fmtDateString(r.remind_at)} \n${"─".repeat(16)} \n${r.text}`,
					quoted: r.message_id || undefined,
					senderId: r.creator_jid,
				});
				if (r.repeat_type) {
					const nextDate = nextRemindAt(new Date(r.remind_at + "Z"), r.repeat_type);
					if (nextDate) {
						const nextStr = nextDate
							.toISOString()
							.replace("T", " ")
							.replace(/\.\d{3}Z$/, "");
						updateRemindAtStmt.run(nextStr, r.id);
					} else {
						markDoneStmt.run(r.id);
					}
				} else {
					markDoneStmt.run(r.id);
				}
			} catch (e) {
				console.error("Failed to send reminder", r.id, e);
			}
		}
	},
});

function addReminder(
	chatId: string,
	messageId: string,
	creatorJid: string,
	text: string,
	remindAt: Date,
	repeatType: string | null,
): ReminderRow {
	const remindAtStr = remindAt
		.toISOString()
		.replace("T", " ")
		.replace(/\.\d{3}Z$/, "");
	const { lastInsertRowid } = insertStmt.run(chatId, messageId, creatorJid, text, remindAtStr, repeatType);
	const row = db.prepare("SELECT * FROM reminders WHERE id = ?").get(Number(lastInsertRowid));
	return row as ReminderRow;
}

function tz(): string {
	return process.env.TZ || "Asia/Jakarta";
}

function getPart(parts: Intl.DateTimeFormatPart[], type: string, fallback = 0): number {
	return parseInt(parts.find((p) => p.type === type)?.value ?? String(fallback));
}

function fmtDateString(date: Date | string, locales: Intl.LocalesArgument = "id-ID") {
	const d = typeof date === "string" ? new Date(date.replace(" ", "T") + "Z") : date;
	return d.toLocaleString(locales, {
		timeZone: tz(),
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** Convert a Date whose UTC components equal the wall-clock time in `tz` to real UTC. */
function toUtc(date: Date, tz: string): Date | null {
	if (!Number.isFinite(date.getTime())) return null;
	const y = date.getUTCFullYear();
	const M = date.getUTCMonth();
	const d = date.getUTCDate();
	const h = date.getUTCHours();
	const m = date.getUTCMinutes();
	const s = date.getUTCSeconds();

	const wallClockMs = Date.UTC(y, M, d, h, m, s);

	const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).formatToParts(date);
	const timeParts = new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(date);

	const ty = getPart(dateParts, "year");
	const tm = getPart(dateParts, "month");
	const td = getPart(dateParts, "day");
	const th = getPart(timeParts, "hour");
	const tMin = getPart(timeParts, "minute");
	const ts = getPart(timeParts, "second");

	const tzWallClockMs = Date.UTC(ty, tm - 1, td, th, tMin, ts);
	const tzOffsetMs = tzWallClockMs - date.getTime();
	const result = wallClockMs - tzOffsetMs;

	if (!Number.isFinite(result)) return null;
	return new Date(result);
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

function isDateValid(month: number, day: number): boolean {
	return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function todayInTz(): { year: number; month: number; day: number } {
	const now = new Date();
	const ds = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz(),
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now);
	const [y, m, d] = ds.split("-").map(Number);
	return { year: y, month: m, day: d };
}

function offsetDate(
	date: { year: number; month: number; day: number },
	days: number,
): { year: number; month: number; day: number } {
	const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
	};
}

const dateAliases: Record<string, number> = {
	besok: 1,
	lusa: 2,
	tomorrow: 1,
	dayaftertomorrow: 2,
	dayafter: 2,
};

function parseDate(s: string): { year: number; month: number; day: number } | null {
	let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (m) {
		const [year, month, day] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
		if (isDateValid(month, day)) return { year, month, day };
	}

	m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
	if (m) {
		const [year, month, day] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
		if (isDateValid(month, day)) return { year, month, day };
	}

	m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
	if (m) {
		const [day, month, year] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
		if (isDateValid(month, day)) return { year, month, day };
	}

	m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (m) {
		const [day, month, year] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
		if (isDateValid(month, day)) return { year, month, day };
	}

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
		const alias = dateStr.toLowerCase();
		if (alias in dateAliases) {
			date = offsetDate(todayInTz(), dateAliases[alias]);
		} else {
			date = parseDate(dateStr);
			if (!date) return null;
		}
	} else {
		date = todayInTz();
	}

	if (date.month < 1 || date.month > 12) return null;
	if (date.day < 1 || date.day > 31) return null;

	const wallClockMs = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);

	return toUtc(new Date(wallClockMs), tz());
}

const dayNames = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

function fmtRepeatType(repeatType: string): string {
	if (repeatType === "daily") return "setiap hari";
	const [s, e] = repeatType.split("-").map(Number);
	return `${dayNames[s]}-${dayNames[e]}`;
}

function nextRemindAt(currentDate: Date, repeatType: string): Date | null {
	const tzStr = tz();
	const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: tzStr }).formatToParts(currentDate);
	const timeParts = new Intl.DateTimeFormat("en-GB", {
		timeZone: tzStr,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(currentDate);

	const year = getPart(dateParts, "year");
	const month = getPart(dateParts, "month");
	const day = getPart(dateParts, "day");
	const hour = getPart(timeParts, "hour");
	const minute = getPart(timeParts, "minute");

	if (repeatType === "daily") {
		const nextDay = new Date(Date.UTC(year, month - 1, day + 1, hour, minute));
		return toUtc(nextDay, tzStr);
	}

	const [start, end] = repeatType.split("-").map(Number);
	for (let offset = 1; offset <= 14; offset++) {
		const d = new Date(Date.UTC(year, month - 1, day + offset));
		const isoWd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
		if (isoWd >= start && isoWd <= end) {
			const wallClockMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute);
			return toUtc(new Date(wallClockMs), tzStr);
		}
	}
	return null;
}

function firstRepeatOccurrence(timeStr: string, repeatType: string): Date | null {
	const tzStr = tz();
	const time = parseTime(timeStr);
	if (!time) return null;

	const { year, month, day } = todayInTz();

	if (repeatType === "daily") {
		const wallClockMs = Date.UTC(year, month - 1, day, time.hour, time.minute);
		const todayDate = toUtc(new Date(wallClockMs), tzStr);
		if (todayDate && todayDate.getTime() > Date.now()) return todayDate;
		const nextDay = offsetDate({ year, month, day }, 1);
		const nextWallClock = Date.UTC(nextDay.year, nextDay.month - 1, nextDay.day, time.hour, time.minute);
		return toUtc(new Date(nextWallClock), tzStr);
	}

	const [start, end] = repeatType.split("-").map(Number);
	for (let offset = 0; offset < 14; offset++) {
		const d = offsetDate({ year, month, day }, offset);
		const dow = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
		const isoWd = dow === 0 ? 7 : dow;
		if (isoWd >= start && isoWd <= end) {
			const wallClockMs = Date.UTC(d.year, d.month - 1, d.day, time.hour, time.minute);
			const date = toUtc(new Date(wallClockMs), tzStr);
			if (date && date.getTime() > Date.now()) return date;
		}
	}
	return null;
}

const plugin: BotPlugin = {
	command: "!reminder",
	description:
		"Membuat pengingat dari quoted atau prompt, atau kelola pengingat. " +
		"Gunakan: `!reminder <jam> [tanggal]`, `!reminder <jam> repeat [hari]`, " +
		"`!reminder ls`, `!reminder rm <id>`",
	queue: "user",
	async *run({ args, user, quoted, chatId }) {
		const sub = args[0];

		if (sub === "ls") {
			const reminders = selectByCreatorStmt.all(user.lidJid) as ReminderRow[];
			if (reminders.length === 0) {
				return { type: "text", text: "Tidak ada pengingat yang akan datang.", quoted: true };
			}
			const lines = reminders.map((r) => {
				const timeDesc = r.repeat_type
					? `${fmtRepeatType(r.repeat_type)}, berikutnya: ${fmtDateString(r.remind_at)}`
					: `pada ${fmtDateString(r.remind_at)}`;
				return `- \`#${r.id}\` ${timeDesc}: \n"${r.text}"`;
			});
			return {
				type: "text",
				text: `*Pengingat yang akan datang (${reminders.length}):*\n${lines.join("\n\n")}`,
				quoted: true,
			};
		}

		if (sub === "rm") {
			const id = args[1];
			if (!id) {
				throw new Error("Gunakan: `!reminder rm <id>`");
			}
			const idNum = parseInt(id);
			if (!Number.isFinite(idNum)) {
				throw new Error("ID tidak valid.");
			}
			const { changes } = deleteStmt.run(idNum, user.lidJid);
			if (changes === 0) {
				throw new Error("Pengingat tidak ditemukan.");
			}
			return { type: "text", text: `Pengingat \`#${idNum}\` berhasil dihapus.`, quoted: true };
		}

		const timeStr = sub;
		let dateStr: string | undefined;
		let repeatType: string | null = null;

		if (!timeStr) {
			throw new Error(
				"Gunakan:\n" +
					"- `!reminder <jam> [tanggal]` — buat pengingat baru\n" +
					"- `!reminder <jam> repeat [hari]` — buat pengingat berulang\n" +
					"- `!reminder ls` — lihat semua pengingat\n" +
					"- `!reminder rm <id>` — hapus pengingat",
			);
		}

		if (args[1] === "repeat") {
			repeatType = "daily";
			if (args[2]) {
				if (/^[1-7]-[1-7]$/.test(args[2])) {
					const [s, e] = args[2].split("-").map(Number);
					if (s < e) {
						repeatType = args[2];
					} else {
						throw new Error("Rentang hari tidak valid.");
					}
				} else {
					throw new Error("Format hari tidak valid. Gunakan format seperti `1-5`.");
				}
			}
		} else {
			dateStr = args[1];
		}

		let remindAt: Date | null;
		if (repeatType) {
			remindAt = firstRepeatOccurrence(timeStr, repeatType);
		} else {
			remindAt = parseDateTime(timeStr, dateStr);
		}

		if (!remindAt) {
			throw new Error(
				// \u200B is invisible space char to prevent number being formatted as phone
				"Tidak dapat memahami format waktu.\n\n" +
					"*Format Waktu 24 Jam (wajib):*\n" +
					"- `HH:mm` — 14:30\n" +
					"- `HH.\u200Bmm` — 14.\u200B30\n" +
					"- `HHmm` — 14\u200B30\n\n" +
					"*Format Tanggal (opsional default hari ini):*\n" +
					"- `YYYY-MM-DD` — 2026\u200B-05-28\n" +
					"- `YYYY/MM/DD` — 2026\u200B/05/28\n" +
					"- `YYYYMMDD` — 2026\u200B0528\n" +
					"- `DD-MM-YYYY` — 28\u200B-05-2026\n" +
					"- `DD/MM/YYYY` — 28\u200B/05/2026\n" +
					"- `DDMMYYYY` — 2805\u200B2026\n" +
					"- `besok` / `tomorrow` — besok\n" +
					"- `lusa` / `dayafter` — lusa\n\n" +
					"*Contoh:*\n" +
					"- `!reminder 14:30`\n" +
					"- `!reminder 14.\u200B30 \u200B2026\u200B-05-28`\n" +
					"- `!reminder 1430\u200B 2805\u200B2026`\n" +
					"- `!reminder 14:30 besok`",
			);
		}

		let reminderText = quoted?.text || "";
		let reminderMessageId = quoted?.id || "";
		if (!reminderText) {
			const { text, id } = yield prompt({
				type: "text",
				text: "Apa yang ingin diingatkan?",
				quoted: true,
			});
			reminderText = text || "";
			reminderMessageId = id;
		}

		addReminder(chatId, reminderMessageId, user.lidJid, reminderText, remindAt, repeatType);

		let responseText: string;
		if (repeatType === "daily") {
			const t = parseTime(timeStr);
			const timeFmt = `${String(t!.hour).padStart(2, "0")}.${String(t!.minute).padStart(2, "0")}`;
			responseText = `Pengingat dibuat: setiap hari pukul ${timeFmt}`;
		} else if (repeatType) {
			const t = parseTime(timeStr);
			const timeFmt = `${String(t!.hour).padStart(2, "0")}.${String(t!.minute).padStart(2, "0")}`;
			responseText = `Pengingat dibuat: ${fmtRepeatType(repeatType)} pukul ${timeFmt}`;
		} else {
			responseText = `Pengingat dibuat untuk: \n> ${fmtDateString(remindAt)}`;
		}

		return {
			type: "text",
			text: responseText,
			quoted: reminderMessageId || true,
		};
	},
};

export default plugin;
export {
	dateAliases,
	firstRepeatOccurrence,
	fmtDateString,
	fmtRepeatType,
	nextRemindAt,
	offsetDate,
	parseDate,
	parseDateTime,
	parseTime,
	todayInTz,
	toUtc,
	tz,
};
