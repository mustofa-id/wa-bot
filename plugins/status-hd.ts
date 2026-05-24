import { cleanUp, ffmpeg, ffprobe, getDataDir } from "#lib/utils.ts";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// actually each video status is 90s length, but this is just for anticipate.
const MAX_VIDEO_DURATION = 89;

const videoConfig = [
	["-movflags", "+faststart"],
	["-vf", "scale=1080:-2:flags=lanczos,fps=30"],
	["-r", "30"],
	["-c:v", "libx264"],
	["-profile:v", "high"],
	["-level", "4.1"],
	["-pix_fmt", "yuv420p"],
	["-crf", "20"],
	["-maxrate", "6M"],
	["-preset", "faster"],
	["-max_muxing_queue_size", "2048"],
	["-bufsize", "4M"],
	["-c:a", "aac"],
	["-b:a", "128k"],
	["-ar", "48000"],
	["-ac", "2"],
].flat();

const imageConfig = [
	["-frames:v", "1"],
	["-vf", `scale=2560:-2:flags=lanczos`],
	["-q:v", "2"],
	["-map_metadata", "-1"],
].flat();

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
			mode: "balance",
			preInputArgs: ["-ss", String(start)],
			args: ["-t", String(segDuration), "-c", "copy"],
			outputPath: segments[i],
		});
	}

	return segments;
}

export default {
	command: "!shd",
	description: "Kompres video/foto dokumen untuk status HD",
	queue: "global",

	async *run({ type, downloadAttachment }) {
		if (type !== "document") {
			throw new Error("Lampirkan dokumen video/foto yang ingin dikompres");
		}

		yield {
			type: "text",
			text: "Mohon tunggu, sedang memproses...",
		};

		const { buffer, mimeType } = await downloadAttachment();
		if (!mimeType) throw new Error("Tidak dapat menentukan tipe media");

		const isImage = mimeType.startsWith("image/");
		const isVideo = mimeType.startsWith("video/");
		if (!isImage && !isVideo) {
			throw new Error("Hanya file video atau gambar yang didukung");
		}

		const dataDir = await getDataDir();
		const workDir = join(dataDir.pathname, "status-hd");
		await mkdir(workDir, { recursive: true });

		const id = randomUUID();
		const ext = isVideo ? ".mp4" : ".jpg";
		const inputPath = join(workDir, `${id}_input${ext}`);

		await writeFile(inputPath, buffer);

		const cleanupPaths: string[] = [inputPath];

		try {
			const outputPath = await ffmpeg(inputPath, {
				mode: "balance",
				args: isVideo ? videoConfig : imageConfig,
			});
			cleanupPaths.push(outputPath);

			if (isVideo) {
				const duration = await getVideoDuration(outputPath);
				if (duration > MAX_VIDEO_DURATION) {
					const segmentPaths = await splitVideo(outputPath, MAX_VIDEO_DURATION, workDir, `${id}_seg`, ext);
					cleanupPaths.push(...segmentPaths);

					for (const [i, seg] of segmentPaths.entries()) {
						yield {
							type: "video",
							filePath: seg,
							quoted: true,
							caption: `Bagian ${i + 1}/${segmentPaths.length}`,
						};
					}
				} else {
					yield { type: "video", filePath: outputPath, quoted: true };
				}
			} else {
				yield { type: "image", filePath: outputPath, quoted: true };
			}

			yield { type: "text", text: "Semoga kamu suka hasilnya" };
		} finally {
			cleanUp(...cleanupPaths);
		}
	},
} satisfies BotPlugin;
