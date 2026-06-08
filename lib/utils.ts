import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import timers from "node:timers/promises";

type RunArgs = readonly (string | readonly string[])[];

export function run(cmd: string, args: RunArgs): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args.flat());
		let stdout = "";
		let stderr = "";
		proc.stdout?.on("data", (d) => (stdout += d.toString()));
		proc.stderr?.on("data", (d) => (stderr += d.toString()));
		proc.on("close", (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`"${cmd}" exited with code ${code}: ${stderr.slice(-500)}`));
		});
		proc.on("error", reject);
	});
}

export async function ffmpeg(
	inputPath: string,
	options: {
		args: RunArgs;
		preInputArgs?: RunArgs;
		outputPath?: string;
	},
): Promise<string> {
	const ext = extname(inputPath);
	const base = basename(inputPath, ext);
	const dir = dirname(inputPath);
	const outputPath = options.outputPath ?? join(dir, `${base}_processed${ext}`);

	const cmd = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
	const args = [
		"-y",
		"-hide_banner",
		["-loglevel", "error"],
		...(options.preInputArgs ?? []),
		["-i", inputPath],
		...options.args,
		outputPath,
	];

	console.log("running ffmpeg:", cmd, args);
	await run(cmd, args);
	return outputPath;
}

/**
 * Run ffprobe with the given input file and options.
 * Returns the trimmed stdout output as a string.
 */
export async function ffprobe(
	inputPath: string,
	options: {
		args: RunArgs;
	},
): Promise<string> {
	const cmd = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
	const { stdout } = await run(cmd, [...options.args, inputPath]);
	return stdout.trim();
}

/**
 * Run yt-dlp with the given URL and options.
 * Returns an array of downloaded file paths parsed from `[download] Destination:` stderr lines.
 */
export async function ytdlp(
	url: string,
	options: {
		args: RunArgs;
	},
): Promise<string[]> {
	const cmd = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
	const { stdout } = await run(cmd, [...options.args, "--print", "after_move:filepath", url]);
	return stdout
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

/**
 * Delete file paths after a short delay (3.5s).
 * Fire-and-forget safe: errors are logged to console.warn.
 */
export async function cleanUp(...paths: (string | null | undefined)[]): Promise<void> {
	try {
		if (paths.length === 0) return;
		await timers.setTimeout(3500);
		for (const path of paths) {
			if (!path) continue;
			await rm(path, { force: true });
		}
	} catch (error) {
		console.warn("cleanUp:", error);
	}
}

/**
 * Run GhostScript with the given input file and options.
 * Returns the output path on success.
 */
export async function ghostScript(
	inputPath: string,
	options: {
		args: RunArgs;
		outputPath: string;
	},
): Promise<string> {
	const cmd = process.platform === "win32" ? "gswin64c.exe" : "gs";
	const args = [
		"-dNOPAUSE",
		"-dBATCH",
		"-dQUIET",
		"-dSAFER",
		...options.args,
		"-sOutputFile=" + options.outputPath,
		"-f",
		inputPath,
	];

	await run(cmd, args);
	return options.outputPath;
}

/**
 * Convert PDF to DOCX using pdf2docx.
 * Returns the converted file path.
 */
export async function convertDocx(
	inputPath: string,
	options: {
		outDir: string;
	},
): Promise<string> {
	const ext = extname(inputPath);
	const base = basename(inputPath, ext);
	const outputPath = join(options.outDir, `${base}.docx`);

	await run("pdf2docx", ["convert", inputPath, outputPath]);
	return outputPath;
}

/**
 * Returns application data directory.
 *
 * Priority:
 *   1. process.env.DATA_DIR
 *   2. {project-root}/data
 *
 * Ensures directory exists with secure permissions.
 */
export async function getDataDir(): Promise<URL> {
	const dataDir = process.env.DATA_DIR ? new URL(process.env.DATA_DIR) : new URL("../data/", import.meta.url);

	try {
		await access(dataDir, constants.R_OK | constants.W_OK);
	} catch {
		await mkdir(dataDir, { recursive: true, mode: 0o700 });
	}

	return dataDir;
}

export async function useSqlite(name: string, wal = true): Promise<DatabaseSync> {
	const dataDir = await getDataDir();
	const db = new DatabaseSync(new URL(`${name}.db`, dataDir));
	if (wal) {
		db.exec("PRAGMA journal_mode=WAL;");
		db.exec("PRAGMA synchronous=NORMAL;");
	}
	return db;
}

export function randomInt(from: number, to?: number, multipleOf?: number): number {
	if (to == null) {
		to = from;
		from = 0;
	}

	if (from == to) return from;

	if (multipleOf && multipleOf > 0) {
		const adjustedFrom = Math.ceil(from / multipleOf) * multipleOf;
		const adjustedTo = Math.floor(to / multipleOf) * multipleOf;

		if (adjustedFrom > adjustedTo) return from;

		const steps = (adjustedTo - adjustedFrom) / multipleOf;
		return adjustedFrom + Math.floor(Math.random() * (steps + 1)) * multipleOf;
	}

	return Math.floor(Math.random() * (to - from + 1)) + from;
}

export async function delay(...params: Parameters<typeof randomInt>) {
	if (!params[1]) {
		return await timers.setTimeout(params[0]);
	}
	await timers.setTimeout(randomInt(...params));
}

/** Extract phone number from a WhatsApp JID. Handles device suffix like `:27`. */
export function phoneFromJid(jid: string): string {
	return jid.split(":")[0].split("@")[0];
}

/** Strip device suffix (`:N`) from a JID. Returns bare `user@domain`. */
export function stripDeviceSuffix(jid: string): string {
	return jid.replace(/:\d+@/, "@");
}

/** Normalize phone input to WhatsApp format: no +, no leading 0, no non-digits. */
export function normalizePhone(input: string): string {
	return input.replace(/^\+/, "").replace(/^0+/, "").replace(/\D/g, "");
}

/** Format milliseconds to a human-readable duration string. */
export function fmtDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	const parts: string[] = [];
	if (h > 0) parts.push(`${h}j`);
	if (m % 60 > 0) parts.push(`${m % 60}m`);
	if (s % 60 > 0 || parts.length === 0) parts.push(`${s % 60}d`);
	return parts.join(" ");
}
