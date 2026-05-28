import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";

export async function ffmpeg(
	inputPath: string,
	options: {
		args: string[];
		outputPath?: string;
		preInputArgs?: string[];
	},
): Promise<string> {
	const ext = extname(inputPath);
	const base = basename(inputPath, ext);
	const dir = dirname(inputPath);
	const outputPath = options.outputPath ?? join(dir, `${base}_processed${ext}`);

	const isWin = process.platform === "win32";
	const cmd = isWin ? "ffmpeg.exe" : "ffmpeg";
	const ffmpegArgs = [
		"-y",
		"-hide_banner",
		["-loglevel", "error"],
		...(options.preInputArgs ?? []),
		["-i", inputPath],
		...options.args,
		outputPath,
	].flat();

	console.log("running ffmpeg:", cmd, ffmpegArgs);

	await new Promise<void>((resolve, reject) => {
		const proc = spawn(cmd, ffmpegArgs);
		let stderr = "";
		proc.stderr.on("data", (d) => (stderr += d.toString()));
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
		});
		proc.on("error", reject);
	});

	return outputPath;
}

/**
 * Run ffprobe with the given input file and options.
 * Returns the trimmed stdout output as a string.
 */
export async function ffprobe(
	inputPath: string,
	options: {
		args: string[];
	},
): Promise<string> {
	const isWin = process.platform === "win32";
	const cmd = isWin ? "ffprobe.exe" : "ffprobe";
	const args = [...options.args, inputPath];

	return await new Promise<string>((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const proc = spawn(cmd, args);
		proc.stdout.on("data", (d) => {
			stdout += d.toString();
		});
		proc.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		proc.on("close", (code) => {
			if (code === 0) resolve(stdout.trim());
			else reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-500)}`));
		});
		proc.on("error", reject);
	});
}

/**
 * Run yt-dlp with the given URL and options.
 * Returns an array of downloaded file paths parsed from `[download] Destination:` stderr lines.
 */
export async function ytdlp(
	url: string,
	options: {
		args: string[];
	},
): Promise<string[]> {
	const isWin = process.platform === "win32";
	const cmd = isWin ? "yt-dlp.exe" : "yt-dlp";
	const allArgs = [...options.args, "--print", "after_move:filepath", url];

	return await new Promise<string[]>((resolve, reject) => {
		const proc = spawn(cmd, allArgs);
		let stdout = "";
		let stderr = "";
		proc.stdout?.on("data", (d) => {
			stdout += d.toString();
		});
		proc.stderr?.on("data", (d) => {
			stderr += d.toString();
		});
		proc.on("close", (code) => {
			if (code === 0) {
				const paths = stdout
					.split("\n")
					.map((l) => l.trim())
					.filter(Boolean);
				resolve(paths);
			} else {
				reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-500)}`));
			}
		});
		proc.on("error", reject);
	});
}

/**
 * Delete file paths after a short delay (3.5s).
 * Fire-and-forget safe: errors are logged to console.warn.
 */
export async function cleanUp(...paths: (string | null | undefined)[]): Promise<void> {
	try {
		if (paths.length === 0) return;
		await setTimeout(3500);
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
		args: string[];
		outputPath: string;
	},
): Promise<string> {
	const isWin = process.platform === "win32";
	const cmd = isWin ? "gswin64c.exe" : "gs";
	const gsArgs = [
		"-dNOPAUSE",
		"-dBATCH",
		"-dQUIET",
		"-dSAFER",
		...options.args,
		"-sOutputFile=" + options.outputPath,
		"-f",
		inputPath,
	];

	await new Promise<void>((resolve, reject) => {
		const proc = spawn(cmd, gsArgs);
		let stderr = "";
		proc.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`gs exited with code ${code}: ${stderr.slice(-500)}`));
		});
		proc.on("error", reject);
	});

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

	await new Promise<void>((resolve, reject) => {
		const proc = spawn("pdf2docx", ["convert", inputPath, outputPath]);
		let stderr = "";
		proc.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`pdf2docx exited with code ${code}: ${stderr.slice(-500)}`));
		});
		proc.on("error", reject);
	});

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
