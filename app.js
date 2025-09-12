// @ts-check

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sqlite from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import qrt from "qrcode-terminal";
import wa from "whatsapp-web.js";

const config = {
	owner: process.env.OWNER_NUMBERS?.split(",") || [],
	data_dir: "data",
	chrome_path: process.env.CHROME_PATH || "",
};

mkdirSync(config.data_dir, { recursive: true });

const db = new sqlite.DatabaseSync(path.join(config.data_dir, "db.sqlite"));
const features = /** @type {const} */ (["!help", "!register", "!compress"]);

/**
 * @typedef {typeof features[number]} Feature
 */

db.exec(`
	create table if not exists users (
		id integer primary key autoincrement,
		number text unique not null,
		name text
	)
`);

const users = /** @type string[] */ ([]);

const client = new wa.Client({
	puppeteer: {
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
		executablePath: config.chrome_path,
		headless: true,
	},
	authStrategy: new wa.LocalAuth({ dataPath: ".session" }),
});

client.on("ready", async () => {
	const version = await client.pupBrowser?.version();
	console.log(`Bot ready with`, version);
});

client.on("qr", (qr) => {
	qrt.generate(qr, { small: true });
});

client.on("message", (message) => {
	console.log(
		`Receive "${message.type}" from ${message.from} <${message["_data"]?.notifyName || "noname"}>`
	);
	handle_message(message).catch(async (e) => {
		console.error("handle_message error:", e);
		await setTimeout(1_000);
		await message
			.reply(`Mentally, I just blue-screened. \n\n_Error: ${e.message}_`)
			.catch(console.error);
	});
});

client.initialize();
load_users();

function load_users() {
	// load all since we are only small users
	const result = db.prepare(`select * from users`).all();
	users.length = 0;
	users.push(...config.owner, ...result.map((r) => /** @type string */ (r["number"])));
}

/** @param {wa.Message} message */
async function handle_message(message) {
	const [feature, ...args] = /** @type {[Feature, ...string[]]} */ (
		message.body.trim().toLowerCase().split(/\s+/)
	);
	if (!features.includes(feature)) return;

	// in case server reloaded, we skip it
	const info = await message.getInfo();
	if (info?.read) return;

	if (!users.includes(message.from.split("@")[0])) {
		await setTimeout(1_000);
		await message.reply(`You're not registered. Not even a little bit.`);
		return;
	}

	switch (feature) {
		case "!help": {
			await setTimeout(2_000);
			const commands = features.map((f) => `- ${f} <args> \n`).join("");
			const info = `*Personal Bot* \n\nAvailable commands: \n${commands}`;
			await message.reply(info);
			break;
		}

		case "!register": {
			await setTimeout(1_000);
			await message.reply("Please wait..");

			if (!config.owner.includes(message.from.split("@")[0])) {
				await setTimeout(1_000);
				await message.reply(`Whoa there, power trip - you're not the admin.`);
				break;
			}

			let [number, name] = args;
			if (!/^\d{10,13}$/.test(number)) {
				await setTimeout(1_000);
				await message.reply(`No. That number gave me trust issues.`);
				break;
			}

			number = number.startsWith("62") ? number : "62" + number.slice(1);

			const result = db
				.prepare(`insert into users (number, name) values (?,?)`)
				.run(number, name || null);

			if (result.changes > 0) load_users();

			const result_message =
				result.changes > 0 ? `Got it!` : `Register failed successfully, try again!`;

			await setTimeout(1_000);
			await message.reply(result_message);
			break;
		}

		case "!compress": {
			await setTimeout(1_000);
			await message.reply("Please wait..");

			if (!message.hasMedia) {
				await setTimeout(2_000);
				await message.reply(`Was the attachment shy or just didn't vibe with the send button?`);
				break;
			}

			if (message.type != wa.MessageTypes.DOCUMENT) {
				await setTimeout(2_000);
				await message.reply(`I only accept "document", not digital doodles.`);
				break;
			}

			const media = await message.downloadMedia();
			if (!media) {
				await setTimeout(2_000);
				await message.reply(`I opened it, saw nothing but disappointment. Care to try again?`);
				break;
			}

			const is_image = media.mimetype.startsWith("image/");
			const is_video = media.mimetype.startsWith("video/");
			if (!is_image && !is_video) {
				await setTimeout(2_000);
				await message.reply(`That file doesn't spark joy. Video or pic only, thanks.`);
				break;
			}

			await setTimeout(2_000);

			/** @type {wa.Message | undefined} */
			let result_message;
			if (is_video) {
				const result = await convert_video(media.data);
				const video = wa.MessageMedia.fromFilePath(result.output);
				result_message = await client.sendMessage(message.from, video);
				cleanup(result.dir);
			}

			if (is_image) {
				const result = await convert_image(media.data);
				const image = wa.MessageMedia.fromFilePath(result.output);
				result_message = await client.sendMessage(message.from, image, { sendMediaAsHd: true });
				cleanup(result.dir);
			}

			if (result_message) {
				await setTimeout(2_000);
				await result_message.reply(
					`I did my best. Sorry if it wasn't up to your fantasy standards.`
				);
			}

			break;
		}
	}
}

/** @param {string} base64 video file in base64 */
async function convert_video(base64) {
	const args = [
		"-y", // overwrite
		"-hide_banner",
		["-loglevel", "error"],

		// Ensure fast-start for web/social media
		["-movflags", "+faststart"],

		// Scale to width 1080, keep AR, even dimensions; cap fps to 30
		["-vf", "scale=1080:-2:flags=lanczos,fps=30"],

		["-r", "30"], // 30 fps target (fits the 24–30fps ask)
		["-c:v", "libx264"],
		["-profile:v", "high"],
		["-level", "4.1"],
		["-pix_fmt", "yuv420p"],
		["-preset", "medium"],
		["-crf", "20"], // quality (lower = higher quality); 18–23 typical
		["-maxrate", "6M"], // cap to ~6 Mbps (good for most social platforms)
		["-bufsize", "12M"],

		// Audio: AAC stereo 128k @ 48kHz (very standard)
		["-c:a", "aac"],
		["-b:a", "128k"],
		["-ar", "48000"],
		["-ac", "2"],
	];

	return convert_media({
		base64,
		ext: ".mp4",
		cmd_args: args.flat(),
	});
}

/** @param {string} base64 image file in base64 */
async function convert_image(base64) {
	const args = [
		"-y",
		"-hide_banner",
		["-loglevel", "error"],

		// Ensure we output exactly one frame for animated sources (GIF/A-PNG)
		["-frames:v", "1"],

		["-vf", `scale=2560:-2:flags=lanczos`],

		// JPEG quality (lower is higher quality)
		["-q:v", "2"],

		// Strip metadata for smaller/cleaner output (optional)
		["-map_metadata", "-1"],
	];

	return convert_media({ base64, ext: ".jpg", cmd_args: args.flat() });
}

/** @param {string} dir */
async function cleanup(dir) {
	try {
		await rm(dir, { recursive: true, force: true });
	} catch (error) {
		console.warn(`cleanup ${dir} failed:`, error);
	}
}

/**
 *
 * @param {{ base64: string; ext: `.${string}`; cmd_args: string[] }} params
 */
async function convert_media(params) {
	const id = crypto.randomUUID();
	const dir = await mkdtemp(path.join(tmpdir(), "media-"));
	const input = path.join(dir, `${id}.bin`);
	const output = path.join(dir, `${id}${params.ext}`);

	await writeFile(input, Buffer.from(params.base64, "base64"));

	const args = [["-i", input], ...(params.cmd_args || []), output];
	await new Promise((resolve, reject) => {
		const ffmpeg = spawn(`ffmpeg`, args.flat(), { windowsHide: true });
		let error_output = "";
		ffmpeg.stderr.on("data", (data) => (error_output += data.toString()));
		ffmpeg.on("error", reject);
		ffmpeg.on("close", (code) => {
			if (code != 0) {
				console.error("convert_media:", error_output);
				return reject(new Error(`convert failed: ${code}`));
			}
			resolve("");
		});
	});

	return { dir, output };
}
