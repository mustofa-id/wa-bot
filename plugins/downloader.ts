import { cleanUp, getDataDir, ytdlp } from "#lib/utils.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export default {
	command: "!dl",
	description:
		"Download media dari URL (Instagram, YouTube, dll). " +
		"Gunakan `!dl <url> [multi]` untuk galeri/playlist. " +
		"Untuk kebutuhan Status WhatsApp, silakan gunakan `!shd <url>` supaya lebih optimal.",

	async *run({ args }) {
		const url = args[0];
		const isMulti = args[1] === "multi";

		if (!url) throw new Error("Gunakan: `!dl <url> [multi]`");

		yield {
			type: "text",
			text: "Mohon tunggu, sedang mengunduh...",
			quoted: true,
		};

		const dataDir = await getDataDir();
		const workDir = join(dataDir.pathname, "dl");
		await mkdir(workDir, { recursive: true });

		const id = crypto.randomUUID();
		const outputPattern = join(workDir, `${id}_%(id)s.%(ext)s`);

		const ytdlpArgs: string[] = [
			"--no-progress",
			"--no-warnings",
			"--no-mtime",
			"--no-part",
			["--socket-timeout", "30"],
			["--retries", "3"],
			["-o", outputPattern],
		].flat();
		if (!isMulti) ytdlpArgs.push("--no-playlist");

		const paths = await ytdlp(url, { args: ytdlpArgs });

		if (paths.length === 0) throw new Error("Tidak ada media yang diunduh");

		try {
			for (const filePath of paths) {
				yield { type: "document", filePath, quoted: true };
			}
		} finally {
			cleanUp(...paths);
		}
	},
} satisfies BotPlugin;
