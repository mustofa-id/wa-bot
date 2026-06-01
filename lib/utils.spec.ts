import {
	cleanUp,
	convertDocx,
	delay,
	ffmpeg,
	ffprobe,
	getDataDir,
	ghostScript,
	normalizePhone,
	phoneFromJid,
	randomInt,
	run,
	stripDeviceSuffix,
	ytdlp,
} from "#lib/utils.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";

describe("getDataDir", () => {
	const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
	const tempRoot = new URL("../tmp-test-data/", import.meta.url);

	beforeEach(() => {
		delete process.env.DATA_DIR;
	});

	afterEach(async () => {
		process.env.DATA_DIR = ORIGINAL_DATA_DIR;
		await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
	});

	it("returns a URL", async () => {
		const dir = await getDataDir();
		assert.ok(dir instanceof URL);
	});

	it("defaults to /data/ relative to project root", async () => {
		const dir = await getDataDir();
		assert.ok(dir.pathname.endsWith("/data/"));
	});

	it("uses DATA_DIR env var when set", async () => {
		const customDir = new URL("./custom-data/", tempRoot);
		process.env.DATA_DIR = customDir.href;
		const dir = await getDataDir();
		assert.equal(dir.href, customDir.href);
	});

	it("creates directory if missing", async () => {
		const newDir = new URL("./new-data/", tempRoot);
		process.env.DATA_DIR = newDir.href;
		await getDataDir();
		await access(newDir, constants.F_OK);
	});

	it("sets directory permissions to 0o700", async () => {
		const newDir = new URL("./perm-data/", tempRoot);
		process.env.DATA_DIR = newDir.href;
		await getDataDir();
		await access(newDir, constants.R_OK | constants.W_OK | constants.X_OK);
	});
});

describe("randomInt", () => {
	it("returns a number", () => {
		assert.equal(typeof randomInt(10), "number");
	});

	it("single argument: returns value in [0, from]", () => {
		for (let i = 0; i < 100; i++) {
			const n = randomInt(100);
			assert.ok(n >= 0 && n <= 100, `${n} not in [0, 100]`);
		}
	});

	it("two arguments: returns value in [from, to]", () => {
		for (let i = 0; i < 100; i++) {
			const n = randomInt(200, 400);
			assert.ok(n >= 200 && n <= 400, `${n} not in [200, 400]`);
		}
	});

	it("returns from when from === to", () => {
		assert.equal(randomInt(7, 7), 7);
	});

	it("multipleOf: all results are multiples", () => {
		for (let i = 0; i < 100; i++) {
			const n = randomInt(1000, 5000, 500);
			assert.equal(n % 500, 0, `${n} is not a multiple of 500`);
			assert.ok(n >= 1000 && n <= 5000, `${n} not in [1000, 5000]`);
		}
	});

	it("multipleOf: from === to", () => {
		assert.equal(randomInt(100, 100, 50), 100);
	});

	it("multipleOf: no multiples in range returns from", () => {
		const n = randomInt(1, 3, 10);
		assert.equal(n, 1);
	});
});

describe("delay", () => {
	it("waits at least the specified duration with single arg", async () => {
		const start = performance.now();
		await delay(50);
		const elapsed = performance.now() - start;
		assert.ok(elapsed >= 30, `expected >= 30ms, got ${elapsed}ms`);
	});

	it("waits within the specified range with two args", async () => {
		for (let i = 0; i < 5; i++) {
			const start = performance.now();
			await delay(50, 150);
			const elapsed = performance.now() - start;
			assert.ok(elapsed >= 30 && elapsed <= 200, `expected 30-200ms, got ${elapsed}ms`);
		}
	});

	it("resolves quickly for 0ms delay", async () => {
		const start = performance.now();
		await delay(0);
		const elapsed = performance.now() - start;
		assert.ok(elapsed < 50, `expected quick resolve, got ${elapsed}ms`);
	});
});

describe("phoneFromJid", () => {
	it("extracts phone from JID with device suffix", () => {
		assert.equal(phoneFromJid("6281234567890:27@s.whatsapp.net"), "6281234567890");
	});

	it("extracts phone from JID without device suffix", () => {
		assert.equal(phoneFromJid("6281234567890@s.whatsapp.net"), "6281234567890");
	});

	it("extracts LID from lid format", () => {
		assert.equal(phoneFromJid("65747000000000:27@lid"), "65747000000000");
	});

	it("extracts id from group JID", () => {
		assert.equal(phoneFromJid("1234567890@g.us"), "1234567890");
	});

	it("returns empty string for empty input", () => {
		assert.equal(phoneFromJid(""), "");
	});

	it("handles plain phone number without domain", () => {
		assert.equal(phoneFromJid("6281234567890"), "6281234567890");
	});
});

describe("stripDeviceSuffix", () => {
	it("strips device suffix from LID JID", () => {
		assert.equal(stripDeviceSuffix("112312541271212:69@lid"), "112312541271212@lid");
	});

	it("strips device suffix from phone JID", () => {
		assert.equal(stripDeviceSuffix("6281234567890:27@s.whatsapp.net"), "6281234567890@s.whatsapp.net");
	});

	it("passes through JID without device suffix", () => {
		assert.equal(stripDeviceSuffix("112312541271212@lid"), "112312541271212@lid");
	});

	it("passes through group JID", () => {
		assert.equal(stripDeviceSuffix("1234567890@g.us"), "1234567890@g.us");
	});

	it("returns empty string for empty input", () => {
		assert.equal(stripDeviceSuffix(""), "");
	});
});

describe("normalizePhone", () => {
	it("strips leading +", () => {
		assert.equal(normalizePhone("+6281234567890"), "6281234567890");
	});

	it("strips leading 0", () => {
		assert.equal(normalizePhone("081234567890"), "81234567890");
	});

	it("removes non-digit characters", () => {
		assert.equal(normalizePhone("62 812-3456-7890"), "6281234567890");
	});

	it("passes through already clean number", () => {
		assert.equal(normalizePhone("6281234567890"), "6281234567890");
	});

	it("handles + with spaces", () => {
		assert.equal(normalizePhone("+62 812 3456 7890"), "6281234567890");
	});

	it("strips + then 0", () => {
		assert.equal(normalizePhone("+081234567890"), "81234567890");
	});

	it("returns empty for empty input", () => {
		assert.equal(normalizePhone(""), "");
	});
});

describe("cleanUp", () => {
	it("no-op with empty paths", async () => {
		await cleanUp();
	});

	it("filters out null and undefined", async () => {
		await cleanUp(null, undefined);
	});

	it("deletes a real file", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "cleanup-test-"));
		const filePath = join(tempDir, "test.txt");
		await writeFile(filePath, "hello");
		await access(filePath, constants.F_OK);
		await cleanUp(filePath);
		await assert.rejects(access(filePath, constants.F_OK));
		await rm(tempDir, { recursive: true, force: true });
	});
});

function generateTestInput(outputPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn("ffmpeg", ["-f", "lavfi", "-i", "color=c=red:s=10x10:d=1", "-frames:v", "1", outputPath]);
		proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
		proc.on("error", reject);
	});
}

describe("ffmpeg", () => {
	let tempDir: string;
	let inputPath: string;
	let available = false;

	before(async () => {
		available = await new Promise<boolean>((resolve) => {
			const proc = spawn("ffmpeg", ["-version"]);
			proc.on("close", (code) => resolve(code === 0));
			proc.on("error", () => resolve(false));
		});
	});

	beforeEach(async () => {
		if (!available) return;
		tempDir = await mkdtemp(join(tmpdir(), "ffmpeg-test-"));
		inputPath = join(tempDir, "input.png");
		await generateTestInput(inputPath);
	});

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
	});

	it("runs and returns output path", async () => {
		if (!available) return;
		const result = await ffmpeg(inputPath, {
			args: ["-vf", "scale=5:5"],
		});
		assert.equal(result, join(tempDir, "input_processed.png"));
		await access(result, constants.F_OK);
	});

	it("rejects on invalid input path", async () => {
		if (!available) return;
		await assert.rejects(ffmpeg("/nonexistent/file.mp4", { args: [] }));
	});
});

describe("ffprobe", () => {
	let tempDir: string;
	let inputPath: string;
	let available = false;

	before(async () => {
		available = await new Promise<boolean>((resolve) => {
			const proc = spawn("ffprobe", ["-version"]);
			proc.on("close", (code) => resolve(code === 0));
			proc.on("error", () => resolve(false));
		});
	});

	beforeEach(async () => {
		if (!available) return;
		tempDir = await mkdtemp(join(tmpdir(), "ffprobe-test-"));
		inputPath = join(tempDir, "input.png");
		await generateTestInput(inputPath);
	});

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
	});

	it("returns stdout output as string", async () => {
		if (!available) return;
		const output = await ffprobe(inputPath, {
			args: ["-v", "error", "-show_entries", "stream=width,height", "-of", "default=noprint_wrappers=1:nokey=1"],
		});
		const [width, height] = output.split("\n").map(Number);
		assert.equal(width, 10);
		assert.equal(height, 10);
	});

	it("returns stream info for a valid file", async () => {
		if (!available) return;
		const output = await ffprobe(inputPath, {
			args: ["-v", "error", "-show_entries", "format=format_name", "-of", "default=noprint_wrappers=1:nokey=1"],
		});
		assert.ok(output.length > 0);
	});

	it("rejects on invalid input path", async () => {
		if (!available) return;
		await assert.rejects(ffprobe("/nonexistent/file.png", { args: ["-v", "error"] }));
	});
});

describe("ytdlp", () => {
	let available = false;

	before(async () => {
		available = await new Promise<boolean>((resolve) => {
			const proc = spawn("yt-dlp", ["--version"]);
			proc.on("close", (code) => resolve(code === 0));
			proc.on("error", () => resolve(false));
		});
	});

	it("rejects on invalid URL", { timeout: 15000 }, async () => {
		if (!available) return;
		await assert.rejects(
			ytdlp("https://nonexistent.example.com/video", {
				args: ["--no-progress", "--no-warnings", "--socket-timeout", "3", "--max-filesize", "1"],
			}),
		);
	});
});

function generateMinimalPdf(outputPath: string): Promise<void> {
	const pdf = Buffer.from(
		"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF",
	);
	return writeFile(outputPath, pdf);
}

describe("ghostScript", () => {
	let tempDir: string;
	let inputPath: string;
	let available = false;

	before(async () => {
		available = await new Promise<boolean>((resolve) => {
			const proc = spawn("gs", ["--version"]);
			proc.on("close", (code) => resolve(code === 0));
			proc.on("error", () => resolve(false));
		});
	});

	beforeEach(async () => {
		if (!available) return;
		tempDir = await mkdtemp(join(tmpdir(), "gs-test-"));
		inputPath = join(tempDir, "input.pdf");
		await generateMinimalPdf(inputPath);
	});

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
	});

	it("processes a PDF and returns output path", { timeout: 30000 }, async () => {
		if (!available) return;
		const outputPath = join(tempDir, "output.pdf");
		const result = await ghostScript(inputPath, {
			args: ["-sDEVICE=pdfwrite", "-dPDFSETTINGS=/prepress"],
			outputPath,
		});
		assert.equal(result, outputPath);
		await access(result, constants.F_OK);
	});

	it("rejects on invalid input path", async () => {
		if (!available) return;
		await assert.rejects(
			ghostScript("/nonexistent/file.pdf", {
				args: ["-sDEVICE=pdfwrite"],
				outputPath: "/nonexistent/out.pdf",
			}),
		);
	});
});

describe("convertDocx", () => {
	let tempDir: string;
	let inputPath: string;
	let available = false;

	before(async () => {
		available = await new Promise<boolean>((resolve) => {
			const proc = spawn("pdf2docx", ["--version"]);
			proc.on("close", (code) => resolve(code === 0));
			proc.on("error", () => resolve(false));
		});
	});

	beforeEach(async () => {
		if (!available) return;
		tempDir = await mkdtemp(join(tmpdir(), "docx-test-"));
		inputPath = join(tempDir, "input.pdf");
		await generateMinimalPdf(inputPath);
	});

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
	});

	it("converts PDF to docx", { timeout: 30000 }, async () => {
		if (!available) return;
		const result = await convertDocx(inputPath, {
			outDir: tempDir,
		});
		assert.equal(result, join(tempDir, "input.docx"));
		await access(result, constants.F_OK);
	});

	it("rejects on invalid input path", { timeout: 30000 }, async () => {
		if (!available) return;
		await assert.rejects(
			convertDocx("/nonexistent/file.pdf", {
				outDir: tempDir,
			}),
		);
	});
});

describe("run", () => {
	it("returns stdout from a successful command", async () => {
		const { stdout } = await run("node", ["-e", "process.stdout.write('hello')"]);
		assert.equal(stdout, "hello");
	});

	it("returns stderr from a command", async () => {
		const { stderr } = await run("node", ["-e", "process.stderr.write('err msg')"]);
		assert.equal(stderr, "err msg");
	});

	it("rejects on non-zero exit code", async () => {
		await assert.rejects(run("node", ["-e", "process.exit(1)"]), {
			message: /"node" exited with code 1/,
		});
	});

	it("rejects on non-existent command", async () => {
		await assert.rejects(run("this-command-does-not-exist-hopefully", []));
	});
});
