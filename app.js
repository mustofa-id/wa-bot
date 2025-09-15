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
	data_dir: new URL("data/", import.meta.url),
	migrations_dir: new URL("migrations/", import.meta.url),
	chrome_path: process.env.CHROME_PATH,
};

fs.mkdirSync(config.data_dir, { recursive: true });

const db = new sqlite.DatabaseSync(new URL("db.sqlite", config.data_dir));
const options = /** @type {const} */ ([
	["!help", "Show help"],
	["!register", "Register new user"],
	["!compress", "Compress an attached (or reply sent) document (video or image) for Status."],
	[
		"!ffmpeg",
		"Run the *ffmpeg* command with the attached (or reply sent) document. " +
			"The first argument is the output file extension and " +
			"the remaining arguments are *ffmpeg* parameters. For " +
			"example: *!ffmpeg mp4 -r 30 -preset medium*.",
	],
	[
		"!money",
		"Track your income and expenses. " +
			"Syntax: *!money <amount> <yyyy-mm-dd date?> <description>*. " +
			"Example: *!money -17000 Buy milk* or  *!money 150000 2025-09-24 Got donation*. " +
			"Note: Date is optional that default to current date. Use a minus sign (-) for " +
			"expenses. To get recaps, type: *!money recap*.",
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

// BEGIN MIGRATIONS
try {
	db.exec(`
		create table if not exists _migrations (
			id text not null primary key, 
			occurred_at text not null default (current_timestamp)
		)
	`);

	const migrations = db
		.prepare(`select id from _migrations`)
		.all()
		.map((m) => /** @type {string} */ (m.id));

	db.exec("begin");

	for (const file_name of fs.readdirSync(config.migrations_dir).sort()) {
		if (!file_name.endsWith(".sql")) continue;
		if (migrations.includes(file_name)) continue;

		const file_path = new URL(file_name, config.migrations_dir);
		const sql_content = fs.readFileSync(file_path, "utf8");
		db.exec(sql_content);
		db.prepare(`insert into _migrations (id) values (?)`).run(file_name);
	}
	db.exec("commit");
} catch (error) {
	db.exec("rollback");
	console.error("migrations error:", error);
	process.exit(1);
}
// END MIGRATIONS

const users = /** @type {{ id: number, number: string, name?: string, is_owner: 1 | 0 }[]} */ ([]);

const client = new wa.Client({
	puppeteer: {
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
		executablePath: config.chrome_path || undefined,
		headless: true,
	},
	authStrategy: new wa.LocalAuth({ dataPath: ".session" }),
});

client.on("ready", async () => {
	const version = await client.pupBrowser?.version();
	console.log(`Bot ready with`, version);
	load_users(true);
	schedule_daily("19:00", notify_money_tracker);
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

async function load_users(refresh = false) {
	if (refresh && config.owner?.length) {
		for (const num of config.owner) {
			const contact = await client.getContactById(num + "@c.us").catch((e) => {
				console.warn(`failed to get contact info of "${num}":`, e);
				return undefined;
			});
			const name = contact?.name || contact?.pushname || client.info.pushname || null;
			const query = `
				insert into users (number, name, is_owner) values (?,?,1)
				on conflict (number) do update set is_owner = 1
			`;
			db.prepare(query).run(num, name);
		}

		const placeholder = config.owner.map(() => `?`).join(",");
		const query = `update users set is_owner = 0 where number not in (${placeholder})`;
		db.prepare(query).run(...config.owner);
	}

	// load all since we are only small users
	const result = /** @type {typeof users} */ (db.prepare(`select * from users`).all());
	users.length = 0;
	if (result.length) users.push(...result);
}

function notify_money_tracker() {
	const query = `
		select u.id, u.number
		from users u
		where not exists (
			select 1
			from bookkeeping b
			where b.user_id = u.id
			and b.date = date('now', 'localtime')
		)
	`;

	for (const user of db.prepare(query).all()) {
		const message = `👀 We didn't see any \`!money\` trackers from you today. Wanna add one before the day ends?`;
		client.sendMessage(user["number"] + "@c.us", message);
	}
}

/** @param {wa.Message} message */
async function handle_message(message) {
	const [feature, ...args] = /** @type {[Feature, ...string[]]} */ (
		message.body.trim().toLowerCase().split(/\s+/)
	);
	if (!features.includes(feature)) return;

	const user = users.find((u) => u.number == message.from.split("@")[0]);
	if (!user) {
		await timers.setTimeout(1_000);
		await message.reply(`You're not registered. Not even a little bit.`);
		return;
	}

	if (user.is_owner != 1) {
		await timers.setTimeout(1_000);
		await message.reply(`Account is not active, sorry.`);
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
			if (user.is_owner != 1) {
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

			if (name == "--toggle-active") {
				const result = db
					.prepare(`update users set is_active = not is_active where number = ?`)
					.run(number);
				const result_message =
					result.changes > 0 ? "Gog it!" : "❌ Failed to change user active status";
				if (result.changes > 0) load_users();
				await message.reply(result_message);
				break;
			}

			if (!name) {
				const contact = await client.getContactById(number + "@c.us");
				name = contact.name || contact.pushname || "";
			}

			const result = db
				.prepare(`insert into users (number, name) values (?,?)`)
				.run(number, name || null);

			if (result.changes > 0) load_users();

			const result_message =
				result.changes > 0 ? `Got it!` : `❌ Register failed successfully, try again!`;

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

			try {
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
			} finally {
				clear_long_notifier();
			}

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

			try {
				const result = await ffmpeg({ base64: media.data, ext: `.${ext}`, cmd_args });
				const content = wa.MessageMedia.fromFilePath(result.output);
				await message.reply(content, undefined, {
					sendMediaAsDocument: true,
					caption: "Here you go!",
				});

				cleanup_dir(result.dir);
			} finally {
				clear_long_notifier();
			}

			break;
		}

		case "!money": {
			const [first, ...rest] = args;

			if (/^-?\d+$/.test(first)) {
				if (!rest[0]) {
					await message.reply(`No description? That's wild 😭`);
					break;
				}

				let date = iso_date();
				let description = rest.join(" ");

				if (iso_date_valid(rest[0])) {
					date = rest[0];
					description = rest.slice(1).join(" ");
				}

				const query = `insert into bookkeeping (user_id, amount, date, description) values (?,?,?,?)`;
				const result = db.prepare(query).run(user.id, +first, date, description);
				const info = result.changes > 0 ? `Got it!` : `❌ Uh oh, failed to save the record.`;
				await message.reply(info);
				break;
			}

			if (first == "recap") {
				const result = [
					[
						`This Day`,
						`select 
							date(date) as day,
							sum(case when amount > 0 then amount else 0 end) as income,
							sum(case when amount < 0 then -amount else 0 end) as expense,
							sum(amount) as net
						from bookkeeping
						where user_id = ? and date = date('now', 'localtime')
						group by day
						order by day`,
					],

					[
						`This Month`,
						`select 
							strftime('%Y-%m', date) as month,
							sum(case when amount > 0 then amount else 0 end) as income,
							sum(case when amount < 0 then -amount else 0 end) as expense,
							sum(amount) as net
						from bookkeeping
						where user_id = ? and strftime('%Y-%m', date) = strftime('%Y-%m', 'now', 'localtime')
						group by month
						order by month`,
					],

					[
						`Last Month`,
						`select 
							strftime('%Y-%m', date) as month,
							sum(case when amount > 0 then amount else 0 end) as income,
							sum(case when amount < 0 then -amount else 0 end) as expense,
							sum(amount) as net
						from bookkeeping
						where user_id = ? and strftime('%Y-%m', date) = strftime('%Y-%m', 'now', 'localtime', '-1 month')
						group by month
						order by month`,
					],
				]
					.map(([name, query]) => {
						const summary = db.prepare(query).get(user.id);
						const detail = !summary
							? "_No record yet_"
							: Object.entries(summary)
									.map(([k, v]) => `${k}: *${typeof v == "number" ? rupiah(v) : v}*`)
									.join(" \n");
						return `🗓️ *${name}*: \n${detail}`;
					})
					.join(" \n\n");
				await message.reply(result);
				break;
			}

			await message.reply(`Nah, that argument's sus.`);
			break;
		}

		default:
			await timers.setTimeout(3_000);
			await message.reply(`Hang tight, this command's not working just yet.`);
			break;
	}
}

/**
 * @param {wa.Message} message
 * @param {('video' | 'image' | 'audio' | 'unknown')[]} filters
 * @param {number} delay
 */
async function get_attached_doc(message, filters = [], delay = 2_000) {
	if (delay > 0) await timers.setTimeout(2_000);

	if (!message.hasMedia) {
		if (message.hasQuotedMsg) {
			const quote = await message.getQuotedMessage();
			return get_attached_doc(quote, filters, 0);
		}

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

function iso_date(date = new Date()) {
	return date.toISOString().slice(0, 10);
}

/** @param {string} str  */
function iso_date_valid(str) {
	const regex = /^\d{4}-\d{2}-\d{2}$/;
	if (!regex.test(str)) return false;

	const date = new Date(str);
	return date instanceof Date && !isNaN(date?.getTime()) && str === iso_date(date);
}

/**
 * @param {number | string} value
 * @param {boolean} prefix
 * @returns {string}
 */
function rupiah(value, prefix = true) {
	try {
		const amount = value ? Number(value) : 0;
		return Intl.NumberFormat("id-ID", {
			maximumFractionDigits: 2,
			minimumFractionDigits: 0,
			style: prefix ? "currency" : "decimal",
			currency: "IDR",
		}).format(amount);
	} catch (error) {
		console.warn("helper#rupiah", error?.message);
		return "Err!";
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

/**
 * Schedule a function to run daily at a given time (HH:mm, 24-hour format).
 *
 * @param {string} time - The time of day, e.g. "19:00" for 7 PM.
 * @param {() => MaybePromise<unknown>} task - The function to execute.
 */
function schedule_daily(time, task) {
	function get_delay() {
		const [hours, minutes] = time.split(":").map(Number);
		const now = new Date();
		const next = new Date();

		next.setHours(hours, minutes, 0, 0);

		// If the scheduled time has already passed today, schedule for tomorrow
		if (next <= now) {
			next.setDate(next.getDate() + 1);
		}

		return next.getTime() - now.getTime();
	}

	function schedule_next() {
		const delay = get_delay();
		console.info(`Next run of [${time}] scheduled in ${(delay / 1000 / 60).toFixed(2)} minutes`);

		setTimeout(() => {
			try {
				task();
			} catch (err) {
				console.error("Error in scheduled task:", err);
			}
			schedule_next(); // reschedule for the next day
		}, delay);
	}

	schedule_next();
}
