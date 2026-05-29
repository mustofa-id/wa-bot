import { cleanUp, ffmpeg, ffprobe, getDataDir, ytdlp } from "#lib/utils.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

// actually each video status is 90s length, but this is just for anticipate.
const MAX_VIDEO_DURATION = 89;
const MAX_URL_ITEMS = 10;

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

const ffmpegModeConfigs = {
	gentle: { threads: "2", preset: "veryfast", bufsize: "1M", maxMuxingQueueSize: "1024" },
	balance: { threads: "4", preset: "faster", bufsize: "4M", maxMuxingQueueSize: "2048" },
	performance: { threads: "0", preset: "ultrafast", bufsize: "8M", maxMuxingQueueSize: "4096" },
} as const;

function getVideoConfig(segmentDuration = 0) {
	const rawMode = process.env.FFMPEG_MODE || "balance";
	const mode = rawMode in ffmpegModeConfigs ? (rawMode as keyof typeof ffmpegModeConfigs) : "balance";
	const c = ffmpegModeConfigs[mode];
	const args = [
		["-movflags", "+faststart"],
		["-vf", "scale=1080:-2:flags=lanczos,fps=30"],
		["-r", "30"],
		["-c:v", "libx264"],
		["-profile:v", "high"],
		["-level", "4.1"],
		["-pix_fmt", "yuv420p"],
		["-crf", "20"],
		["-maxrate", "6M"],
		["-c:a", "aac"],
		["-b:a", "128k"],
		["-ar", "48000"],
		["-ac", "2"],
		["-threads", c.threads],
		["-preset", c.preset],
		["-bufsize", c.bufsize],
		["-max_muxing_queue_size", c.maxMuxingQueueSize],
	];
	if (segmentDuration > 0) {
		args.push(["-force_key_frames", `expr:gte(t,n_forced*${segmentDuration})`]);
	}
	return args;
}

const imageConfig = [
	["-frames:v", "1"],
	["-vf", `scale=2560:-2:flags=lanczos`],
	["-q:v", "2"],
	["-map_metadata", "-1"],
];

async function getVideoDuration(filePath: string): Promise<number> {
	const output = await ffprobe(filePath, {
		args: ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1"],
	});
	return Number(output.trim());
}

async function splitVideo(
	inputPath: string,
	segmentDuration: number,
	outDir: string,
	prefix: string,
	ext: string,
): Promise<string[]> {
	const duration = await getVideoDuration(inputPath);
	const segments: string[] = [];

	for (let start = 0; start < duration; start += segmentDuration) {
		const segPath = join(outDir, `${prefix}_${Math.floor(start)}${ext}`);
		segments.push(segPath);
	}

	for (let i = 0; i < segments.length; i++) {
		const start = i * segmentDuration;
		const segDuration = Math.min(segmentDuration, duration - start);

		await ffmpeg(inputPath, {
			args: ["-ss", String(start), "-t", String(segDuration), "-c", "copy"],
			outputPath: segments[i],
		});
	}

	return segments;
}

async function processFile(
	inputPath: string,
	isImage: boolean,
	workDir: string,
	prefix: string,
): Promise<{ results: BotPluginResult[]; cleanupPaths: string[] }> {
	const cleanupPaths: string[] = [];
	const results: BotPluginResult[] = [];

	if (isImage) {
		const outputPath = join(workDir, `${prefix}_hd.jpg`);
		const result = await ffmpeg(inputPath, { args: imageConfig, outputPath });
		cleanupPaths.push(result);
		results.push({ type: "image", filePath: result, quoted: true } as BotPluginResult);
	} else {
		const outputPath = join(workDir, `${prefix}_hd.mp4`);
		const result = await ffmpeg(inputPath, { args: getVideoConfig(MAX_VIDEO_DURATION), outputPath });
		cleanupPaths.push(result);

		const duration = await getVideoDuration(result);
		if (duration > MAX_VIDEO_DURATION) {
			const segmentPaths = await splitVideo(result, MAX_VIDEO_DURATION, workDir, `${prefix}_seg`, ".mp4");
			cleanupPaths.push(...segmentPaths);

			for (const [i, seg] of segmentPaths.entries()) {
				results.push({
					type: "video",
					filePath: seg,
					quoted: true,
					caption: `Bagian ${i + 1}/${segmentPaths.length}`,
				} as BotPluginResult);
			}
		} else {
			results.push({ type: "video", filePath: result, quoted: true } as BotPluginResult);
		}
	}

	return { results, cleanupPaths };
}

export default {
	command: "!shd",
	description:
		"Kompres video/foto untuk status HD dari URL atau dokumen. Multi-item didukung (Instagram carousel, dll).",
	queue: "global",

	async *run({ args, attachment, quoted }) {
		const url = args[0];

		if (url?.startsWith("http")) {
			yield {
				type: "text",
				text: "Mohon tunggu, sedang mengunduh...",
				quoted: true,
			};

			const dataDir = await getDataDir();
			const workDir = join(dataDir.pathname, "status-hd");
			await mkdir(workDir, { recursive: true });

			const id = crypto.randomUUID();
			const outputPattern = join(workDir, `${id}_%(id)s.%(ext)s`);

			const paths = await ytdlp(url, {
				args: [
					"--no-progress",
					"--no-warnings",
					"--no-mtime",
					"--no-part",
					["--socket-timeout", "30"],
					["--retries", "3"],
					["--format", "bestvideo[vcodec*=avc1]+bestaudio[ext=m4a]/best"],
					["-o", outputPattern],
				],
			});

			if (paths.length === 0) throw new Error("Tidak ada media yang diunduh");

			const cleanupPaths = [...paths];
			const items = paths.slice(0, MAX_URL_ITEMS);
			const totalItems = items.length;

			try {
				yield {
					type: "text",
					text: "Unduhan selesai. Mohon tunggu, sedang mengompres...",
					quoted: true,
				};

				let processedCount = 0;
				for (const filePath of items) {
					const ext = extname(filePath).toLowerCase();
					const isImage = IMAGE_EXTS.has(ext);
					const isVideo = VIDEO_EXTS.has(ext);

					if (!isImage && !isVideo) {
						console.warn("!shd: skipping unknown type:", filePath);
						continue;
					}

					const { results, cleanupPaths: cp } = await processFile(
						filePath,
						isImage,
						workDir,
						`${id}_${processedCount}`,
					);
					cleanupPaths.push(...cp);
					for (const r of results) {
						if (totalItems > 1 && r.type !== "text" && !r.caption) {
							r.caption = `Bagian ${processedCount + 1}/${totalItems}`;
						}
						yield r;
					}
					processedCount++;
				}

				yield { type: "text", text: "Semoga kamu suka hasilnya" };
			} finally {
				cleanUp(...cleanupPaths);
			}
			return;
		}

		const media = attachment ?? quoted?.attachment;
		if (media?.type !== "document") {
			throw new Error("Gunakan: `!shd <url>` atau lampirkan dokumen video/foto");
		}

		yield {
			type: "text",
			text: "Mohon tunggu, sedang memproses...",
			quoted: true,
		};

		const { buffer, mimeType } = await media.get();
		if (!mimeType) throw new Error("Tidak dapat menentukan tipe media");

		const isImage = mimeType.startsWith("image/");
		const isVideo = mimeType.startsWith("video/");
		if (!isImage && !isVideo) {
			throw new Error("Hanya file video atau gambar yang didukung");
		}

		const dataDir = await getDataDir();
		const workDir = join(dataDir.pathname, "status-hd");
		await mkdir(workDir, { recursive: true });

		const id = crypto.randomUUID();
		const ext = isVideo ? ".mp4" : ".jpg";
		const inputPath = join(workDir, `${id}_input${ext}`);

		await writeFile(inputPath, buffer);

		const cleanupPaths: string[] = [inputPath];

		try {
			const { results, cleanupPaths: cp } = await processFile(inputPath, isImage, workDir, id);
			cleanupPaths.push(...cp);
			for (const r of results) yield r;

			yield { type: "text", text: "Semoga kamu suka hasilnya" };
		} finally {
			cleanUp(...cleanupPaths);
		}
	},
} satisfies BotPlugin;
