import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	tz,
	todayStr,
	fmtDate,
	methodName,
	fetchTimings,
	PRAYER_NAMES,
	NOTIFICATION_PRAYERS,
	METHODS,
} from "#plugins/prayers.ts";

describe("prayers utils", () => {
	describe("constants", () => {
		it("PRAYER_NAMES maps English to Indonesian", () => {
			assert.equal(PRAYER_NAMES.Fajr, "Subuh");
			assert.equal(PRAYER_NAMES.Dhuhr, "Dzuhur");
			assert.equal(PRAYER_NAMES.Asr, "Ashar");
			assert.equal(PRAYER_NAMES.Maghrib, "Maghrib");
			assert.equal(PRAYER_NAMES.Isha, "Isya");
			assert.equal(PRAYER_NAMES.Sunrise, "Terbit");
		});

		it("NOTIFICATION_PRAYERS excludes Sunrise", () => {
			assert.deepEqual(NOTIFICATION_PRAYERS, ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]);
		});

		it("METHODS has expected entries", () => {
			assert.equal(METHODS[20], "KEMENAG");
			assert.equal(METHODS[3], "MWL");
			assert.equal(METHODS[2], "ISNA");
		});
	});

	describe("tz", () => {
		it("returns env var when set", () => {
			process.env.TZ = "America/New_York";
			assert.equal(tz(), "America/New_York");
			delete process.env.TZ;
		});

		it("defaults to Asia/Jakarta", () => {
			delete process.env.TZ;
			assert.equal(tz(), "Asia/Jakarta");
		});
	});

	describe("todayStr", () => {
		it("returns YYYY-MM-DD format", () => {
			process.env.TZ = "Asia/Jakarta";
			const result = todayStr();
			assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
			delete process.env.TZ;
		});
	});

	describe("fmtDate", () => {
		it("formats date string to Indonesian locale", () => {
			process.env.TZ = "Asia/Jakarta";
			const result = fmtDate("2026-05-29");
			assert.match(result, /Jumat/);
			assert.match(result, /Mei/);
			assert.match(result, /2026/);
			delete process.env.TZ;
		});
	});

	describe("methodName", () => {
		it("returns name for known method", () => {
			assert.equal(methodName(20), "KEMENAG");
		});

		it("returns fallback for unknown method", () => {
			assert.equal(methodName(99), "Metode 99");
		});
	});

	describe("fetchTimings", () => {
		it("returns timings for Jakarta with KEMENAG method", async () => {
			const timings = await fetchTimings("Jakarta", "Indonesia", 20);
			assert.ok(timings);
			for (const prayer of ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]) {
				assert.ok(timings[prayer], `missing ${prayer}`);
				assert.match(timings[prayer], /^\d{2}:\d{2}$/, `${prayer}: invalid time`);
			}
		});
	});
});
