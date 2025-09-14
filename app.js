// @ts-check

import proc from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sqlite from "node:sqlite";
import timers from "node:timers/promises";
import qrt from "qrcode-terminal";
import wa from "whatsapp-web.js";

const config = {
	owner: process.env.OWNER_NUMBERS?.split(",") || [],
	data_dir: "data",
	chrome_path: process.env.CHROME_PATH || "",
};

fs.mkdirSync(config.data_dir, { recursive: true });

const db = new sqlite.DatabaseSync(path.join(config.data_dir, "db.sqlite"));
const options = /** @type {const} */ ([
	["!help", "Show help"],
	["!register", "Register new user"],
	["!compress", "Compress a attached document (video or image) for Status"],
	[
		"!ffmpeg",
		"Run the *ffmpeg* command with the attached file. " +
			"The first argument is the output file extension and " +
			"the remaining arguments are *ffmpeg* parameters. For " +
			"example: *!ffmpeg mp4 -r 30 -preset medium*.",
	],
	[
		"!money",
		"Track your income and expenses. " +
			"Syntax: *!money <amount> <description>* " +
			"Example: *!money -17000 Buy milk* or  *!money 150000 Got donation*. " +
			"Note: Use a minus sign (-) for expenses. ",
	],
]);

const features = options.map((o) => o[0]);

/**
 * @typedef {typeof features[number]} Feature
 */

/**
 * @template T
 * @typedef {T | Promise<T>} MaybePromise
 */

const migrations = fs.readFileSync("migrations.sql", { encoding: "utf8" });
db.exec(migrations);

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
		await timers.setTimeout(1_000);
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

	if (!users.includes(message.from.split("@")[0])) {
		await timers.setTimeout(1_000);
		await message.reply(`You're not registered. Not even a little bit.`);
		return;
	}

	if (feature != "!help") {
		await timers.setTimeout(1_000);
		await message.reply("Please wait…");
	}

	switch (feature) {
		case "!help": {
			await timers.setTimeout(2_000);
			const commands = options.map((f) => `- \`${f[0]}\` ${f[1]} \n`).join("");
			const info = `🧰 *Multipurpose Tools*: \n\nAvailable commands: \n${commands}`;
			await client.sendMessage(message.from, info);
			break;
		}

		case "!register": {
			if (!config.owner.includes(message.from.split("@")[0])) {
				await timers.setTimeout(1_000);
				await message.reply(`Whoa there, power trip - you're not the admin.`);
				break;
			}

			let [number, name] = args;
			if (!/^\d{10,13}$/.test(number)) {
				await timers.setTimeout(1_000);
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

			await timers.setTimeout(1_000);
			await message.reply(result_message);
			break;
		}

		case "!compress": {
			const media = await get_attached_doc(message, ["video", "image"]);
			if (!media) break;

			const clear_long_notifier = set_random_interval(
				async () => await message.reply(`Hold up, need a sec to go through this file…`),
				57_000,
				67_000
			);

			/** @type {wa.Message | undefined} */
			let result_message;
			if (media.type == "video") {
				const result = await convert_video(media.data);
				const video = wa.MessageMedia.fromFilePath(result.output);
				result_message = await client.sendMessage(message.from, video);
				cleanup_dir(result.dir);
			}

			if (media.type == "image") {
				const result = await convert_image(media.data);
				const image = wa.MessageMedia.fromFilePath(result.output);
				result_message = await client.sendMessage(message.from, image, { sendMediaAsHd: true });
				cleanup_dir(result.dir);
			}

			clear_long_notifier();

			if (result_message) {
				await timers.setTimeout(2_000);
				await result_message.reply(
					`I did my best. Sorry if it wasn't up to your fantasy standards.`
				);
			} else {
				await message.reply(`Nothing I can do.`);
			}

			break;
		}

		case "!ffmpeg": {
			const media = await get_attached_doc(message);
			if (!media) break;

			const [ext, ...cmd_args] = args;
			if (!ext) {
				await timers.setTimeout(2_000);
				await message.reply(`What's the output file extension again? My memory's on vacation.`);
				break;
			}

			const clear_long_notifier = set_random_interval(
				async () => await message.reply(`Hold up, need a sec to go through this file…`),
				57_000,
				67_000
			);

			const result = await ffmpeg({ base64: media.data, ext: `.${ext}`, cmd_args });
			const content = wa.MessageMedia.fromFilePath(result.output);
			await message.reply(content, undefined, {
				sendMediaAsDocument: true,
				caption: "Here you go!",
			});

			cleanup_dir(result.dir);
			clear_long_notifier();
			break;
		}

		// TODO: !money

		default:
			await timers.setTimeout(3_000);
			await message.reply(`Hang tight, this command's not working just yet.`);
			break;
	}
}

/**
 * @param {wa.Message} message
 * @param {('video' | 'image' | 'audio' | 'unknown')[]} filters
 */
async function get_attached_doc(message, filters = []) {
	await timers.setTimeout(2_000);
	if (!message.hasMedia) {
		await message.reply(`Was the attachment shy or just didn't vibe with the send button?`);
		return;
	}

	if (message.type != wa.MessageTypes.DOCUMENT) {
		await message.reply(`I only accept "document", not digital doodles.`);
		return;
	}

	const media = await message.downloadMedia();
	if (!media) {
		await message.reply(`I opened it, saw nothing but disappointment. Care to try again?`);
		return;
	}

	// there are more types like 'application' or 'text' but we don't use it yet
	const [type] = /** @type {typeof filters} */ (
		media.mimetype.split(";")?.[0]?.trim()?.toLowerCase()?.split("/") || ["unknown"]
	);

	if (filters?.length && !filters.includes(type)) {
		const allowed = filters.map((t) => `'${t}'`).join(" or ");
		await message.reply(`That file doesn't spark joy. Only ${allowed}, Thanks.`);
		return;
	}

	return { ...media, type };
}

/** @param {string} base64 video file in base64 */
async function convert_video(base64) {
	const args = [
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

	return ffmpeg({
		base64,
		ext: ".mp4",
		cmd_args: args.flat(),
	});
}

/** @param {string} base64 image file in base64 */
async function convert_image(base64) {
	const args = [
		// Ensure we output exactly one frame for animated sources (GIF/A-PNG)
		["-frames:v", "1"],

		["-vf", `scale=2560:-2:flags=lanczos`],

		// JPEG quality (lower is higher quality)
		["-q:v", "2"],

		// Strip metadata for smaller/cleaner output (optional)
		["-map_metadata", "-1"],
	];

	return ffmpeg({ base64, ext: ".jpg", cmd_args: args.flat() });
}

/** @param {string} path */
async function cleanup_dir(path) {
	try {
		await fsp.rm(path, { recursive: true, force: true });
	} catch (error) {
		console.warn(`cleanup ${path} failed:`, error);
	}
}

/**
 *
 * @param {() => MaybePromise<unknown>} callback
 * @param {number =} min
 * @param {number =} max
 */
function set_random_interval(callback, min = 1, max = 1) {
	let timer_id;
	let running = true;

	async function run() {
		if (!running) return;

		await callback?.();

		const delay = Math.floor(Math.random() * (max - min + 1) + min);
		timer_id = setTimeout(run, delay);
	}

	run();
	return () => {
		running = false;
		clearTimeout(timer_id);
		timer_id = undefined;
	};
}

/**
 *
 * @param {{ base64: string; ext: `.${string}`; cmd_args?: string[] }} params
 */
async function ffmpeg(params) {
	const id = crypto.randomUUID();
	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "media-"));
	const input = path.join(dir, `${id}.bin`);
	const output = path.join(dir, `${id}${params.ext}`);

	await fsp.writeFile(input, Buffer.from(params.base64, "base64"));

	const default_args = ["-y" /* overwrite */, "-hide_banner", ["-loglevel", "error"]];
	const args = [...default_args, ["-i", input], ...(params.cmd_args || []), output];
	await new Promise((resolve, reject) => {
		const ffmpeg = proc.spawn(`ffmpeg`, args.flat(), { windowsHide: true });
		let error_output = "";
		ffmpeg.stderr.on("data", (data) => (error_output += data.toString()));
		ffmpeg.on("error", reject);
		ffmpeg.on("close", (code) => {
			if (code != 0) {
				console.error("convert_media:", error_output);
				return reject(new Error(`convert failed: ${code}`));
			}
			resolve(void 0);
		});
	});

	return { dir, output };
}
