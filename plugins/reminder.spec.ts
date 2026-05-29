import { parseDate, parseDateTime, parseTime, toUtc } from "#plugins/reminder.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

describe("reminder utils", () => {
	let modTz: () => string;
	let tempDir: string;
	let originalDataDir: string | undefined;

	before(async () => {
		originalDataDir = process.env.DATA_DIR;
		tempDir = await mkdtemp(join(tmpdir(), "reminder-test-"));
		process.env.DATA_DIR = `file://${tempDir}/`;
		const mod = await import("#plugins/reminder.ts");
		modTz = mod.tz;
	});

	after(async () => {
		process.env.DATA_DIR = originalDataDir;
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
	});

	describe("tz", () => {
		it("returns env var when set", () => {
			process.env.TZ = "America/New_York";
			assert.equal(modTz(), "America/New_York");
			delete process.env.TZ;
		});

		it("defaults to Asia/Jakarta", () => {
			delete process.env.TZ;
			assert.equal(modTz(), "Asia/Jakarta");
		});
	});
});

describe("parseTime", () => {
	it("HH:mm — 14:30", () => {
		assert.deepEqual(parseTime("14:30"), { hour: 14, minute: 30 });
	});

	it("H:mm — 9:05", () => {
		assert.deepEqual(parseTime("9:05"), { hour: 9, minute: 5 });
	});

	it("HH.mm dot separator — 14.30", () => {
		assert.deepEqual(parseTime("14.30"), { hour: 14, minute: 30 });
	});

	it("HHmm — 1430", () => {
		assert.deepEqual(parseTime("1430"), { hour: 14, minute: 30 });
	});

	it("Hmm — 905 (3-digit)", () => {
		assert.deepEqual(parseTime("905"), { hour: 9, minute: 5 });
	});

	it("midnight — 00:00", () => {
		assert.deepEqual(parseTime("00:00"), { hour: 0, minute: 0 });
	});

	it("max valid — 23:59", () => {
		assert.deepEqual(parseTime("23:59"), { hour: 23, minute: 59 });
	});

	it("returns null for hour > 23", () => {
		assert.equal(parseTime("24:00"), null);
	});

	it("returns null for minute > 59", () => {
		assert.equal(parseTime("14:60"), null);
	});

	it("returns null for 4-digit with hour > 23", () => {
		assert.equal(parseTime("2400"), null);
	});

	it("returns null for dot separator with hour > 23", () => {
		assert.equal(parseTime("24.00"), null);
	});

	it("returns null for empty string", () => {
		assert.equal(parseTime(""), null);
	});

	it("returns null for non-numeric input", () => {
		assert.equal(parseTime("abc"), null);
	});

	it("returns null for partial input", () => {
		assert.equal(parseTime("14:"), null);
	});
});

describe("parseDate", () => {
	it("YYYY-MM-DD — 2026-05-28", () => {
		assert.deepEqual(parseDate("2026-05-28"), { year: 2026, month: 5, day: 28 });
	});

	it("YYYY/MM/DD — 2026/05/28", () => {
		assert.deepEqual(parseDate("2026/05/28"), { year: 2026, month: 5, day: 28 });
	});

	it("DD-MM-YYYY — 28-05-2026", () => {
		assert.deepEqual(parseDate("28-05-2026"), { year: 2026, month: 5, day: 28 });
	});

	it("DD/MM/YYYY — 28/05/2026", () => {
		assert.deepEqual(parseDate("28/05/2026"), { year: 2026, month: 5, day: 28 });
	});

	it("YYYYMMDD — 20260528", () => {
		assert.deepEqual(parseDate("20260528"), { year: 2026, month: 5, day: 28 });
	});

	it("DDMMYYYY — 28052026", () => {
		assert.deepEqual(parseDate("28052026"), { year: 2026, month: 5, day: 28 });
	});

	it("YYYYMMDD prefers year-first for 8-digit", () => {
		assert.deepEqual(parseDate("20261231"), { year: 2026, month: 12, day: 31 });
	});

	it("returns null for month > 12", () => {
		assert.equal(parseDate("2026-13-01"), null);
	});

	it("returns null for day > 31", () => {
		assert.equal(parseDate("2026-01-32"), null);
	});

	it("returns null for empty string", () => {
		assert.equal(parseDate(""), null);
	});

	it("returns null for random text", () => {
		assert.equal(parseDate("not-a-date"), null);
	});
});

describe("toUtc", () => {
	it("converts Jakarta wall-clock to UTC (UTC+7)", () => {
		const wallClock = new Date("2026-05-28T17:30:00Z");
		const result = toUtc(wallClock, "Asia/Jakarta");
		assert.ok(result);
		assert.equal(result.toISOString(), "2026-05-28T10:30:00.000Z");
	});

	it("handles midnight crossing (Jakarta ahead of UTC)", () => {
		const wallClock = new Date("2026-05-28T00:30:00Z");
		const result = toUtc(wallClock, "Asia/Jakarta");
		assert.ok(result);
		assert.equal(result.toISOString(), "2026-05-27T17:30:00.000Z");
	});

	it("returns null for invalid input Date", () => {
		const result = toUtc(new Date(NaN), "Asia/Jakarta");
		assert.equal(result, null);
	});
});

describe("parseDateTime", () => {
	it("time with explicit date — 14:30 2026-05-28 in Jakarta", () => {
		process.env.TZ = "Asia/Jakarta";
		const result = parseDateTime("14:30", "2026-05-28");
		assert.ok(result);
		assert.equal(result.toISOString(), "2026-05-28T07:30:00.000Z");
		delete process.env.TZ;
	});

	it("dot separator time — 14.30 2026-05-28", () => {
		process.env.TZ = "Asia/Jakarta";
		const result = parseDateTime("14.30", "2026-05-28");
		assert.ok(result);
		assert.equal(result.toISOString(), "2026-05-28T07:30:00.000Z");
		delete process.env.TZ;
	});

	it("compact time and date — 1430 20260528", () => {
		process.env.TZ = "Asia/Jakarta";
		const result = parseDateTime("1430", "20260528");
		assert.ok(result);
		assert.equal(result.toISOString(), "2026-05-28T07:30:00.000Z");
		delete process.env.TZ;
	});

	it("DD-MM-YYYY date format — 14:30 28-05-2026", () => {
		process.env.TZ = "Asia/Jakarta";
		const result = parseDateTime("14:30", "28-05-2026");
		assert.ok(result);
		assert.equal(result.toISOString(), "2026-05-28T07:30:00.000Z");
		delete process.env.TZ;
	});

	it("compact time without date — 1830 defaults to current date", () => {
		process.env.TZ = "Asia/Jakarta";
		const result = parseDateTime("1830");
		assert.ok(result);
		assert.equal(result.getUTCHours(), 11);
		assert.equal(result.getUTCMinutes(), 30);

		const todayJakarta = new Date().toLocaleString("en-CA", { timeZone: "Asia/Jakarta" });
		const resultJakarta = result.toLocaleString("en-CA", { timeZone: "Asia/Jakarta" });
		assert.equal(resultJakarta.split(",")[0], todayJakarta.split(",")[0]);
		delete process.env.TZ;
	});

	it("returns null for invalid time", () => {
		assert.equal(parseDateTime("abc"), null);
	});

	it("returns null for invalid date", () => {
		assert.equal(parseDateTime("14:30", "not-a-date"), null);
	});

	it("returns null for empty time", () => {
		assert.equal(parseDateTime(""), null);
	});

	it("returns null for empty strings after trim", () => {
		assert.equal(parseDateTime("   "), null);
	});
});
