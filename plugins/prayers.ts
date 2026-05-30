import { prompt } from "#lib/conversation.ts";
import { registerTask } from "#lib/scheduler.ts";
import { useSqlite } from "#lib/utils.ts";
import type { SQLOutputValue } from "node:sqlite";

interface PrayerConfig extends Record<string, SQLOutputValue> {
	jid: string;
	city: string;
	country: string;
	method: number;
	tune: string;
	enabled: number;
	updated_at: string;
}

const db = await useSqlite("prayers");

db.exec(`CREATE TABLE IF NOT EXISTS prayers_config (
  jid TEXT PRIMARY KEY,
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  method INTEGER NOT NULL DEFAULT 20,
  tune TEXT NOT NULL DEFAULT '0,0,0,0,0,0,0,0,0',
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS prayers_notified (
  jid TEXT NOT NULL,
  date TEXT NOT NULL,
  prayer TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'at',
  PRIMARY KEY (jid, date, prayer, type)
)`);

const upsertConfigStmt = db.prepare(
	"INSERT INTO prayers_config (jid, city, country, method, enabled, tune) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT(jid) DO UPDATE SET city=excluded.city, country=excluded.country, method=excluded.method, tune=excluded.tune, updated_at=datetime('now')",
);
const getConfigStmt = db.prepare("SELECT * FROM prayers_config WHERE jid = ?");
const setEnabledStmt = db.prepare("UPDATE prayers_config SET enabled = ?, updated_at = datetime('now') WHERE jid = ?");
const getAllEnabledStmt = db.prepare("SELECT * FROM prayers_config WHERE enabled = 1");
const updateTuneStmt = db.prepare("UPDATE prayers_config SET tune = ?, updated_at = datetime('now') WHERE jid = ?");
const insertNotifiedStmt = db.prepare(
	"INSERT OR IGNORE INTO prayers_notified (jid, date, prayer, type) VALUES (?, ?, ?, ?)",
);
const clearOldNotifiedStmt = db.prepare("DELETE FROM prayers_notified WHERE date <> ?");

const PRAYER_NAMES: Record<string, string> = {
	Fajr: "Subuh",
	Sunrise: "Terbit",
	Dhuhr: "Dzuhur",
	Asr: "Ashar",
	Maghrib: "Maghrib",
	Isha: "Isya",
};

const NOTIFICATION_PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

const METHODS: Record<number, string> = {
	1: "Karachi",
	2: "ISNA",
	3: "MWL",
	4: "Umm Al-Qura",
	5: "Egypt",
	8: "Gulf",
	9: "Kuwait",
	10: "Qatar",
	11: "Singapore",
	12: "France",
	13: "Turkey",
	14: "Russia",
	15: "Moonsighting",
	16: "Dubai",
	17: "JAKIM",
	18: "Tunisia",
	19: "Algeria",
	20: "KEMENAG",
	21: "Morocco",
	22: "Lisboa",
};

function tz(): string {
	return process.env.TZ || "Asia/Jakarta";
}

function todayStr(): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: tz() }).format(new Date());
}

function fmtDate(dateStr: string): string {
	const [y, m, d] = dateStr.split("-").map(Number);
	const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
	return date.toLocaleDateString("id-ID", {
		timeZone: tz(),
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function methodName(m: number): string {
	return METHODS[m] || `Metode ${m}`;
}

const timingsCache = new Map<string, { date: string; timings: Record<string, string> }>();

async function fetchTimings(
	city: string,
	country: string,
	method: number,
	tune?: string,
): Promise<Record<string, string> | null> {
	const key = `${city.toLowerCase()}|${country.toLowerCase()}|${method}|${tune || ""}`;
	const today = todayStr();
	const cached = timingsCache.get(key);
	if (cached?.date === today) return cached.timings;

	try {
		const params = new URLSearchParams({ city, country, method: String(method) });
		if (tune) params.set("tune", tune);
		const url = `https://api.aladhan.com/v1/timingsByCity?${params}`;
		const res = await fetch(url);
		if (!res.ok) return null;
		const json = await res.json();
		if (json.code !== 200) return null;
		const timings = json.data.timings as Record<string, string>;
		timingsCache.set(key, { date: today, timings });
		return timings;
	} catch (err) {
		console.log("prayers-times:", err);
		return null;
	}
}

registerTask({
	name: "prayers",
	intervalMs: 60_000,
	tick: async (sendMessage) => {
		const configs = getAllEnabledStmt.all() as PrayerConfig[];
		if (!configs.length) return;

		const today = todayStr();
		clearOldNotifiedStmt.run(today);

		const now = new Date();
		const currentMinutes = now.getHours() * 60 + now.getMinutes();

		for (const cfg of configs) {
			if (!cfg.city) continue;

			const timings = await fetchTimings(cfg.city, cfg.country, cfg.method, cfg.tune);
			if (!timings) continue;

			for (const prayer of NOTIFICATION_PRAYERS) {
				const timeStr = timings[prayer];
				if (!timeStr) continue;

				const [h, m] = timeStr.split(":").map(Number);
				const prayerMinutes = h * 60 + m;

				// "at time" notification
				if (Math.abs(currentMinutes - prayerMinutes) <= 1) {
					const { changes } = insertNotifiedStmt.run(cfg.jid, today, prayer, "at");
					if (changes > 0) {
						const name = PRAYER_NAMES[prayer] || prayer;
						try {
							await sendMessage(cfg.jid, {
								type: "text",
								text: `🕌 Waktu *${name}* telah tiba.\n⏰ ${timeStr}`,
							});
						} catch (e) {
							console.error("Failed to send prayer notification", cfg.jid, prayer, e);
						}
					}
				}

				// "10 min before" notification
				const beforeMinutes = prayerMinutes - 10;
				if (beforeMinutes >= 0 && Math.abs(currentMinutes - beforeMinutes) <= 1) {
					const { changes } = insertNotifiedStmt.run(cfg.jid, today, prayer, "before");
					if (changes > 0) {
						const name = PRAYER_NAMES[prayer] || prayer;
						try {
							await sendMessage(cfg.jid, {
								type: "text",
								text: `🕌 Waktu *${name}* akan tiba dalam 10 menit (${timeStr}).`,
							});
						} catch (e) {
							console.error("Failed to send prayer before notification", cfg.jid, prayer, e);
						}
					}
				}
			}
		}
	},
});

export default {
	command: "!prayers",
	description:
		"Menampilkan jadwal sholat, mengaktifkan/mematikan notifikasi, " +
		"mengatur kota, atau menyesuaikan waktu. Gunakan: `!prayers`, " +
		"`!prayers on/off`, `!prayers setup`, `!prayers tune`, `!prayers test`",
	queue: "user",
	async *run({ args, user }) {
		const sub = args[0];

		if (sub === "setup") {
			const existing = getConfigStmt.get(user.lidJid) as PrayerConfig | undefined;

			const cityResp = yield prompt({
				type: "text",
				text: existing?.city
					? `Masukkan nama kota (saat ini: ${existing.city}):`
					: "Masukkan nama kota (contoh: Jakarta):",
			});
			const city = (cityResp.text ?? "").trim() || existing?.city || "";
			if (!city) throw new Error("Kota tidak boleh kosong.");

			const countryResp = yield prompt({
				type: "text",
				text: existing?.country
					? `Masukkan nama negara (saat ini: ${existing.country}):`
					: "Masukkan nama negara (default: Indonesia):",
			});
			const country = (countryResp.text ?? "").trim() || existing?.country || "Indonesia";

			const methodList = Object.entries(METHODS)
				.map(([id, name]) => `- ${id}. ${name}`)
				.join("\n");
			const methodDefault = existing?.method ?? 20;
			const methodResp = yield prompt({
				type: "text",
				text: existing?.method
					? `Pilih metode kalkulasi (saat ini: ${methodDefault} ${methodName(methodDefault)}):\n${methodList}`
					: `Pilih metode kalkulasi (default: ${methodDefault} ${methodName(methodDefault)}):\n${methodList}`,
			});
			const methodInput = (methodResp.text ?? "").trim();
			const method = methodInput ? parseInt(methodInput) : methodDefault;
			if (!Number.isFinite(method) || !(method in METHODS)) {
				throw new Error(`Metode tidak valid. Pilih angka dari daftar:\n${methodList}`);
			}

			upsertConfigStmt.run(user.lidJid, city, country, method, existing?.tune || "0,0,0,0,0,0,0,0,0");

			return {
				type: "text",
				text: `Pengaturan jadwal sholat berhasil disimpan.\n📍 ${city}, ${country}\n🕌 Metode: ${methodName(method)}`,
				quoted: true,
			};
		}

		if (sub === "on" || sub === "off") {
			const config = getConfigStmt.get(user.lidJid) as PrayerConfig | undefined;
			if (!config || !config.city) {
				throw new Error("Silakan atur kota terlebih dahulu dengan `!prayers setup`.");
			}
			const enabled = sub === "on" ? 1 : 0;
			setEnabledStmt.run(enabled, user.lidJid);
			return {
				type: "text",
				text: enabled ? "Notifikasi jadwal sholat *diaktifkan*." : "Notifikasi jadwal sholat *di-nonaktifkan*.",
				quoted: true,
			};
		}

		if (sub === "tune") {
			const config = getConfigStmt.get(user.lidJid) as PrayerConfig | undefined;
			if (!config || !config.city) {
				throw new Error("Silakan atur kota terlebih dahulu dengan `!prayers setup`.");
			}

			const resp = yield prompt({
				type: "text",
				text:
					"Masukkan penyesuaian waktu (dalam menit, pisahkan dengan koma): \n\n" +
					"> Format: `Imsak,Subuh,Terbit,Dzuhur,Ashar,Maghrib,Terbenam,Isya,Malam` \n\n" +
					`Saat ini: \`${config.tune || "0,0,0,0,0,0,0,0,0"}\` \n` +
					"Contoh: `0,-2,0,0,0,0,0,0,0` \n\n" +
					"Ketik `reset` untuk mengembalikan ke nilai default.",
			});

			const input = (resp.text ?? "").trim();
			let tune: string;
			if (!input || input === "reset") {
				tune = "0,0,0,0,0,0,0,0,0";
			} else {
				const parts = input.split(",").map((s) => s.trim());
				if (parts.length !== 9) {
					throw new Error(
						"Jumlah nilai harus 9 (Imsak,Subuh,Terbit,Dzuhur,Ashar,Maghrib,Terbenam,Isya,Malam).",
					);
				}
				const numbers = parts.map((s) => {
					const n = Number(s);
					if (!Number.isFinite(n)) throw new Error(`"${s}" bukan angka yang valid.`);
					return n;
				});
				tune = numbers.join(",");
			}

			updateTuneStmt.run(tune, user.lidJid);
			return {
				type: "text",
				text: `Penyesuaian waktu berhasil disimpan: \n> ${tune}`,
				quoted: true,
			};
		}

		if (sub === "test") {
			const config = getConfigStmt.get(user.lidJid) as PrayerConfig | undefined;
			if (!config || !config.city) {
				throw new Error("Silakan atur kota terlebih dahulu dengan `!prayers setup`.");
			}

			const timings = await fetchTimings(config.city, config.country, config.method, config.tune);
			if (!timings) {
				throw new Error("Gagal mengambil jadwal sholat. Coba lagi nanti.");
			}

			const lines: string[] = ["🔔 *Test Notifikasi Jadwal Sholat*\n"];
			for (const prayer of NOTIFICATION_PRAYERS) {
				const timeStr = timings[prayer];
				if (!timeStr) continue;
				const name = PRAYER_NAMES[prayer] || prayer;
				lines.push(
					`*${name}* (${timeStr}):`,
					`- 10 menit sebelum: "Waktu *${name}* akan tiba dalam 10 menit (${timeStr})."`,
					`- Tepat waktu: "Waktu *${name}* telah tiba."\n`,
				);
			}

			return {
				type: "text",
				text: lines.join("\n"),
				quoted: true,
			};
		}

		if (!sub) {
			const config = getConfigStmt.get(user.lidJid) as PrayerConfig | undefined;
			if (!config || !config.city) {
				throw new Error("Silakan atur kota terlebih dahulu dengan `!prayers setup`.");
			}

			const timings = await fetchTimings(config.city, config.country, config.method, config.tune);
			if (!timings) {
				throw new Error("Gagal mengambil jadwal sholat. Coba lagi nanti.");
			}

			const today = todayStr();
			const lines = Object.entries(PRAYER_NAMES)
				.filter(([key]) => timings[key])
				.map(([key, name]) => {
					const time = timings[key];
					return `- \`${time}\` *${name}*`;
				})
				.join("\n");

			return {
				type: "text",
				text:
					`*Jadwal Sholat Hari Ini*\n${"─".repeat(14)} \n` +
					`📍 ${config.city}, ${config.country} \n` +
					`🗓️ ${fmtDate(today)} \n${"─".repeat(14)} \n` +
					`${lines} \n${"─".repeat(14)} \n` +
					`> Metode: ${methodName(config.method)} \n` +
					`> Pengingat: ${config.enabled ? "Aktif" : "Nonaktif"} \n` +
					`> Tune: ${config.tune}`,
				quoted: true,
			};
		}

		throw new Error(
			"Sub-perintah tidak dikenal. Gunakan:\n" +
				"- `!prayers` — lihat jadwal hari ini\n" +
				"- `!prayers on` — aktifkan notifikasi\n" +
				"- `!prayers off` — nonaktifkan pengingat\n" +
				"- `!prayers setup` — atur kota dan metode\n" +
				"- `!prayers tune` — sesuaikan waktu sholat\n" +
				"- `!prayers test` — uji notifikasi",
		);
	},
} satisfies BotPlugin;

export { fetchTimings, fmtDate, methodName, METHODS, NOTIFICATION_PRAYERS, PRAYER_NAMES, todayStr, tz };
