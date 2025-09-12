// @ts-check

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sqlite from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import qrt from "qrcode-terminal";
import wa from "whatsapp-web.js";

const config = {
	command: "!plz",
	owner: process.env.OWNER_NUMBERS?.split(",") || [],
	data_dir: "data",
	chrome_path: process.env.CHROME_PATH || "",
};

mkdirSync(config.data_dir, { recursive: true });

const db = new sqlite.DatabaseSync(path.join(config.data_dir, "db.sqlite"));

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
	const [command, feature, ...args] = message.body.trim().toLowerCase().split(/\s+/);
	if (command != config.command) return;

	if (!users.includes(message.from.split("@")[0])) {
		await setTimeout(1_000);
		await message.reply(`You're not my bro :(`);
		return;
	}

	await setTimeout(1_000);
	await message.reply("Wait..");

	switch (feature) {
		case "register": {
			let [number, name] = args;
			if (!/^\d{10,13}$/.test(number)) {
				await setTimeout(1_000);
				await message.reply(`Invalid number :|`);
				break;
			}

			number = number.startsWith("62") ? number : "62" + number.slice(1);

			const result = db
				.prepare(`insert into users (number, name) values (?,?)`)
				.run(number, name || null);

			const result_message =
				result.changes > 0 ? `Got it!` : `Register failed successfully, try again!`;

			await setTimeout(1_000);
			await message.reply(result_message);
			break;
		}

		case "convert": {
			await setTimeout(2_000);

			if (!message.hasMedia) {
				await message.reply(`Was the attachment shy or just didn't vibe with the send button?`);
				break;
			}

			if (message.type != wa.MessageTypes.DOCUMENT) {
				await message.reply(`I only accept "document", not digital doodles.`);
				break;
			}

			const media = await message.downloadMedia();
			if (!media) {
				await message.reply(`I opened it, saw nothing but disappointment. Care to try again?`);
				break;
			}

			const is_image = media.mimetype.startsWith("image/");
			const is_video = media.mimetype.startsWith("video/");
			if (!is_image && !is_video) {
				await message.reply(`That file doesn't spark joy. Video or pic only, thanks.`);
				break;
			}

			if (is_video) {
				const video_path = await convert_video(media.data);
				const video_base64 = wa.MessageMedia.fromFilePath(video_path);
				await client.sendMessage(message.from, video_base64);
			}

			if (is_image) {
				await message.reply(`Convert image will support soon`);
			}

			break;
		}

		default:
			await setTimeout(2_000);
			await message.reply(`I think my brain lagged. Can you reboot that sentence?`);
			break;
	}
}

/**
 * @param {string} base64 video file in base64
 * @returns {Promise<string>} file output path
 */
async function convert_video(base64) {
	const id = crypto.randomUUID();
	const dir = await mkdtemp(path.join(tmpdir(), "vid-"));
	const input = path.join(dir, `${id}.bin`);
	const output = path.join(dir, `${id}.mp4`);

	await writeFile(input, Buffer.from(base64, "base64"));

	const args = [
		"-y", // overwrite
		"-hide_banner",
		["-loglevel", "error"],
		["-i", input],

		// Ensure fast-start for web/sosmed
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

		output,
	];

	return new Promise((resolve, reject) => {
		const ffmpeg = spawn(`ffmpeg`, args.flat(), { windowsHide: true });
		let error_output = "";
		ffmpeg.stderr.on("data", (data) => (error_output += data.toString()));
		ffmpeg.on("error", reject);
		ffmpeg.on("close", (code) => {
			if (code != 0) {
				console.error("convert_video:", error_output);
				return reject(new Error(`convert video failed: ${code}`));
			}
			resolve(output);
		});
	});
}
