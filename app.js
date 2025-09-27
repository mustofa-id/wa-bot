// @ts-check

import proc from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sqlite from "node:sqlite";
import timers from "node:timers/promises";
import util from "node:util";
import qrt from "qrcode-terminal";
import wa from "whatsapp-web.js";
import * as i18n from "./i18n/index.js";
import pkg from "./package.json" with { type: "json" };

const config = {
	owner: process.env.OWNER_NUMBERS?.split(",") || [],
	data_dir: new URL("data/", import.meta.url),
	migrations_dir: new URL("migrations/", import.meta.url),
	chrome_path: process.env.CHROME_PATH,
	lang: /** @type {keyof typeof i18n} */ (process.env.APP_LANG || "en"),
	ready_at: /** @type {Date | null} */ (null),
};

fs.mkdirSync(config.data_dir, { recursive: true });

const str = i18n[config.lang];
if (!str) throw new Error(`Invalid "env.APP_LANG" config: "${config.lang}"`);

const fmt_list_conj = new Intl.ListFormat(config.lang, { style: "short", type: "conjunction" });

const db = new sqlite.DatabaseSync(new URL("db.sqlite", config.data_dir));
const options = /** @type {const} */ ([
	// command, alias, description
	["!help", "", str.CMD_HELP],
	["!users", "", str.CMD_USERS],
	["!register", "!reg", str.CMD_REGISTER],
	["!compress", "", str.CMD_COMPRESS],
	["!ffmpeg", "", str.CMD_FFMPEG],
	["!money", "!mn", str.CMD_MONEY],
	["!download", "!dl", str.CMD_DL],
]);

const features = options.map((o) => [o[0], o[1]]).flat();

/**
 * @typedef {typeof features[number]} Feature
 */

/**
 * @template T
 * @typedef {T | Promise<T>} MaybePromise
 */

/**
 * @typedef {{
 * 	id: number;
 * 	number: string;
 * 	name?: string;
 * 	is_owner: 1 | 0;
 * 	is_active: 1 | 0;
 * 	created_at: string;
 * }} User
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

const client = new wa.Client({
	puppeteer: {
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
		executablePath: config.chrome_path || undefined,
		headless: true,
	},
	authStrategy: new wa.LocalAuth({ dataPath: ".session" }),
});

client.on("ready", async () => {
	config.ready_at = new Date();
	init_users();
	schedule_daily("19:00", run_money_tracker_reminder);
	const version = await client.pupBrowser?.version();
	console.log(`Bot ready with`, version);
});

client.on("qr", (qr) => {
	qrt.generate(qr, { small: true });
});

client.on("message_create", (message) => {
	handle_message(message).catch(async (e) => {
		console.error("handle_message error:", e);
		await timers.setTimeout(1_000);
		await message //
			.reply(str.MSG_HANDLE_ERR + ` \n\n_Error: ${e.message}`)
			.catch(console.error);
	});
});

client.initialize();

async function init_users() {
	if (!config.owner?.length) return;
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

function run_money_tracker_reminder() {
	const query = `select u.id, u.number
		from users u
		left join user_settings s on s.user_id = u.id
		where u.is_active = 1 
			and s.money_daily_reminder = 1 
			and not exists (
				select 1
				from bookkeeping b
				where b.user_id = u.id
				and b.date = date('now', 'localtime')
			)`;

	for (const user of db.prepare(query).all()) {
		client.sendMessage(user["number"] + "@c.us", str.MSG_NO_MONEY_TODAY);
	}
}

/** @param {wa.Message} message */
async function handle_message(message) {
	// @ts-expect-error The _data is actually exists
	const notify_name = message["_data"]?.notifyName || "noname";
	console.log(`Receive "${message.type}" from ${message.from} <${notify_name}>`);

	// check if client ready
	if (!config.ready_at) return;

	// don't handle expired message
	const expired = new Date(message.timestamp * 1000) < config.ready_at;
	if (expired) return;

	// check if cmd valid
	const [feature, ...args] = message.body.trim().split(/\s+/);
	if (!features.includes(/** @type {Feature} */ (feature)) || !message.from) return;

	// avoid loop if from group and it's me
	const [contact, chat] = await Promise.all([message.getContact(), message.getChat()]);
	if (chat.isGroup && (contact.isMe || message.fromMe)) return;

	const number = chat.isGroup ? contact.number : message.from.split("@")[0];
	const user = /** @type {User} */ (db.prepare(`select * from users where number = ?`).get(number));

	chat.sendStateTyping();

	if (!user) {
		await timers.setTimeout(1_000);
		await message.reply(str.MSG_UNREGISTERED);
		return;
	}

	if (user.is_active != 1) {
		await timers.setTimeout(1_000);
		await message.reply(str.MSG_INACTIVATED_ACCOUNT);
		return;
	}

	switch (/** @type {Feature} */ (feature)) {
		case "!help": {
			await timers.setTimeout(2_000);
			const commands = options
				.map((f) => `- \`${f[0]}\`${f[1] ? ` | \`${f[1]}\`` : ""} ${f[2]} \n`)
				.join("");
			const info = `🧰 ${str.APP_DESC} \n${commands} \n© 2025 • v${pkg.version}`;
			await client.sendMessage(message.from, info);
			break;
		}

		case "!users": {
			await timers.setTimeout(5_000);
			if (user.is_owner != 1) {
				await message.reply(str.MSG_ADMIN_ONLY);
				break;
			}

			let limit = 10;
			let filters = "";

			// check positive number, gt 0, and allow leading 0.
			if (/^0*[1-9]\d*$/.test(args[0])) {
				limit = +args[0];
			} else if (args.length > 0) {
				filters = args.join(" ");
			}

			const where = filters ? ` where lower(name) like ? ` : "";
			const params = filters ? [`%${filters.toLowerCase()}%`, limit] : [limit];
			const result = db
				.prepare(`select id, name, number, is_active from users ${where} limit ?`)
				.all(...params);
			const info = result.length
				? result
						.map(
							(u) =>
								"👤 " +
								Object.entries(u)
									.map(([k, v]) => `${k}: ${v}`)
									.join(" \n")
						)
						.join("\n\n")
				: str.MSG_NO_RESULT;
			await message.reply(info);
			break;
		}

		case "!reg":
		case "!register": {
			if (user.is_owner != 1) {
				await timers.setTimeout(1_000);
				await message.reply(str.MSG_ADMIN_ONLY);
				break;
			}

			const [user_num, ...rest] = args;

			// simple international phone validation
			if (!/^[1-9]\d{5,14}$/.test(user_num)) {
				await timers.setTimeout(1_000);
				await message.reply(str.MSG_INVALID_NUMBER);
				break;
			}

			if (rest[0] == "--toggle-active") {
				const result = db
					.prepare(`update users set is_active = not is_active where number = ?`)
					.run(user_num);
				const result_message = result.changes > 0 ? str.MSG_SUCCESS : str.MSG_TOGGLE_ACTIVE_FAILED;
				await timers.setTimeout(3_000);
				await message.reply(result_message);
				break;
			}

			let name = rest.join(" ").trim();
			if (!name) {
				const contact = await client.getContactById(user_num + "@c.us");
				name = contact.name || contact.pushname || "";
			}

			const result = db
				.prepare(`insert into users (number, name) values (?,?)`)
				.run(user_num, name || null);
			const result_message = result.changes > 0 ? str.MSG_SUCCESS : str.MSG_REGISTER_FAILED;
			await timers.setTimeout(3_000);
			await message.reply(result_message);
			break;
		}

		case "!compress": {
			const media = await get_attached_doc(message, ["video", "image"]);
			if (!media) break;

			const clear_long_notifier = set_random_interval(
				async () => await message.reply(str.MSG_NEED_MORE_TIME),
				90_000,
				360_000
			);

			/** @type {wa.Message | undefined} */
			let result_message;

			await timers.setTimeout(2_000);
			await message.reply(str.MSG_WAIT);
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
				await result_message.reply(str.MSG_COMPRESS_OK);
			} else {
				await message.reply(str.MSG_COMPRESS_INVALID_ARGS);
			}

			break;
		}

		case "!ffmpeg": {
			const media = await get_attached_doc(message);
			if (!media) break;

			const [ext, ...cmd_args] = args;
			if (!ext) {
				await timers.setTimeout(2_000);
				await message.reply(str.MSG_FFMPEG_INVALID_EXT);
				break;
			}

			const clear_long_notifier = set_random_interval(
				async () => await message.reply(str.MSG_NEED_MORE_TIME),
				180_000,
				520_000
			);

			await timers.setTimeout(2_000);
			await message.reply(str.MSG_WAIT);
			try {
				const result = await ffmpeg({ base64: media.data, ext: `.${ext}`, cmd_args });
				const content = wa.MessageMedia.fromFilePath(result.output);
				if (media.filename) content.filename = `${path.parse(media.filename).name}.${ext}`;
				await message.reply(content, undefined, {
					sendMediaAsDocument: true,
					caption: str.MSG_FFMPEG_OK,
				});

				cleanup_dir(result.dir);
			} finally {
				clear_long_notifier();
			}

			break;
		}

		case "!mn":
		case "!money": {
			await timers.setTimeout(3_000);
			const [first, ...rest] = args;

			if (/^-?\d+$/.test(first)) {
				if (!rest[0]) {
					await message.reply(str.MSG_MONEY_INVALID_DESC);
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
				const info = result.changes > 0 ? str.MSG_SUCCESS : str.MSG_MONEY_SAVE_FAILED;
				await message.reply(info);
				break;
			}

			if (first == "reminder") {
				if (!rest[0]) {
					const settings = db
						.prepare(`select money_daily_reminder from user_settings where user_id = ?`)
						.get(user.id);
					const reminder_state =
						settings?.["money_daily_reminder"] == 1
							? str.MSG_SETTING_ENABLED
							: str.MSG_SETTING_DISABLED;
					await message.reply(reminder_state);
					break;
				}

				const state = { disabled: 0, 0: 0, enabled: 1, 1: 1 }[rest[0]];
				if (state == undefined) {
					await message.reply(str.MSG_INVALID_SETTING_VAL);
					break;
				}

				const result = db.prepare(`update user_settings set money_daily_reminder = ?`).run(state);
				await message.reply(result?.changes > 0 ? str.MSG_SUCCESS : str.MSG_NO_CHANGES);
				break;
			}

			if (first == "recap") {
				const recap_user_ids = [user.id];
				if (rest[0] == "with" && /\d+/.test(rest[1])) {
					if (user.is_owner != 1) {
						await message.reply(str.MSG_ADMIN_ONLY);
						break;
					}
					recap_user_ids.push(+rest[1]);
				}

				if (rest[0] == "all" && chat.isGroup) {
					const gc = /** @type {wa.GroupChat} */ (chat);
					const gp_numbers = gc.participants
						.map((p) => p.id.user)
						.filter((p) => p != client.info.wid.user);

					const placeholder = gp_numbers.map(() => `?`).join(",");
					db.prepare(`select id from users where number in (${placeholder})`)
						.all(...gp_numbers)
						.forEach((r) => {
							recap_user_ids.push(/** @type {number} */ (r.id));
						});
				}

				const in_user_ids = ` in (${recap_user_ids.map(() => `?`).join(",")})`;
				const result = [
					[
						str.L_TODAY,
						`select 
							date(date) as day,
							sum(case when amount > 0 then amount else 0 end) as income,
							sum(case when amount < 0 then -amount else 0 end) as expense,
							sum(amount) as net
						from bookkeeping
						where date = date('now', 'localtime') 
							and user_id ${in_user_ids}
						group by day
						order by day`,
					],

					[
						str.L_THIS_MONTH,
						`select 
							strftime('%Y-%m', date) as month,
							sum(case when amount > 0 then amount else 0 end) as income,
							sum(case when amount < 0 then -amount else 0 end) as expense,
							sum(amount) as net
						from bookkeeping
						where strftime('%Y-%m', date) = strftime('%Y-%m', 'now', 'localtime') 
							and user_id ${in_user_ids}
						group by month
						order by month`,
					],

					[
						str.L_LAST_MONTH,
						`select 
							strftime('%Y-%m', date) as month,
							sum(case when amount > 0 then amount else 0 end) as income,
							sum(case when amount < 0 then -amount else 0 end) as expense,
							sum(amount) as net
						from bookkeeping
						where strftime('%Y-%m', date) = strftime('%Y-%m', 'now', 'localtime', '-1 month') 
							and user_id ${in_user_ids}
						group by month
						order by month`,
					],
				]
					.map(([name, query]) => {
						const summary = db.prepare(query).get(...recap_user_ids);
						const detail = !summary
							? str.MSG_MONEY_RECAP_EMPTY
							: Object.entries(summary)
									.map(([k, v]) => `${k}: *${typeof v == "number" ? rupiah(v) : v}*`)
									.join(" \n");
						return `🗓️ *${name}*: \n${detail}`;
					})
					.join(" \n\n");

				const user_names = db
					.prepare(`select coalesce(name, number) as display from users where id ${in_user_ids}`)
					.all(...recap_user_ids)
					.map((r) => /** @type {string} */ (r.display));

				const icon = user_names.length > 1 ? "🧑‍🧑‍🧒‍🧒" : "👤";
				await message.reply(`${icon} *${fmt_list_conj.format(user_names)}* \n\n${result}`);
				break;
			}

			await message.reply(str.MSG_MONEY_INVALID_ARGS);
			break;
		}

		case "!dl":
		case "!download": {
			const [url, type] = args;

			if (!url || !URL.canParse(url)) {
				await timers.setTimeout(1_000);
				await message.reply(str.MSG_INVALID_URL);
				break;
			}

			const clear_long_notifier = set_random_interval(
				async () => await message.reply(str.MSG_NEED_MORE_TIME),
				250_000,
				410_000
			);

			await timers.setTimeout(2_000);
			await message.reply(str.MSG_WAIT);

			try {
				const result_path = await dl_video(url);
				if (!result_path) {
					await timers.setTimeout(1_000);
					await message.reply(str.MSG_DL_FAILED);
					break;
				}

				if (type == "file") {
					const content = wa.MessageMedia.fromFilePath(result_path);
					await message.reply(content, undefined, {
						sendMediaAsDocument: true,
						caption: str.MSG_FFMPEG_OK,
					});
					cleanup_dir(result_path);
					break;
				}

				const compressed = await ffmpeg({
					file_path: result_path,
					ext: ".mp4",
					cmd_args: get_video_status_config().flat(),
				});
				const video = wa.MessageMedia.fromFilePath(compressed.output);
				await client.sendMessage(message.from, video);
				cleanup_dir(compressed.dir);
			} finally {
				clear_long_notifier();
			}

			break;
		}

		default:
			await timers.setTimeout(3_000);
			await message.reply(str.MSG_UNKNOWN_CMD);
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

		await message.reply(str.MSG_DOC_NOT_ATTACHED);
		return;
	}

	if (message.type != wa.MessageTypes.DOCUMENT) {
		await message.reply(str.MSG_DOC_INVALID_ATTACHMENT);
		return;
	}

	const media = await message.downloadMedia();
	if (!media) {
		await message.reply(str.MSG_MEDIA_DOWNLOAD_FAILED);
		return;
	}

	// there are more types like 'application' or 'text' but we don't use it yet
	const [type] = /** @type {typeof filters} */ (
		media.mimetype.split(";")?.[0]?.trim()?.toLowerCase()?.split("/") || ["unknown"]
	);

	if (filters?.length && !filters.includes(type)) {
		const allowed = filters.map((t) => `'${t}'`).join(" or ");
		await message.reply(`${str.MSG_MEDIA_INVALID_TYPE} ${allowed}`);
		return;
	}

	return { ...media, type };
}

function get_video_status_config() {
	return [
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
}

/** @param {string} base64 video file in base64 */
async function convert_video(base64) {
	const args = get_video_status_config();
	return ffmpeg({
		base64,
		ext: ".mp4",
		cmd_args: args.flat(),
	});
}

/** @param {string} url */
async function dl_video(url) {
	// TODO: cache based on url
	const output = path.join(os.tmpdir(), `%(title)s.%(ext)s`);
	const { stdout } = await yt_dlp(
		[
			url, //
			["-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]"],
			["--merge-output-format", "mp4"],
			["-o", output],
			["--print", "after_move:filepath"],
			"--no-part", // don’t leave .part files
			"--no-cache-dir", // avoid cache in tmp scenarios
			"--no-playlist", // treat URL as single video
			"--quiet",
			"--no-warnings",
			"--no-progress",
		].flat()
	);
	return stdout.split(/\r?\n/).filter(Boolean).pop();
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
	return `${date.getFullYear()}-${lead0(date.getMonth() + 1)}-${lead0(date.getDate())}`;
}

/**
 * Leading zero
 * @param {string | number} val
 * @param {number =} length
 * @returns {string}
 */
function lead0(val, length = 2) {
	return String(val).padStart(length, "0");
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
		console.warn("helper#rupiah", error);
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
	/** @type {NodeJS.Timeout | undefined} */
	let timer_id;
	let running = true;

	async function run() {
		if (!running) return;
		if (timer_id) await callback?.();
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
 * @param {({file_path: string;} | {base64: string;}) & { ext: `.${string}`; cmd_args?: string[] }} params
 */
async function ffmpeg(params) {
	const id = crypto.randomUUID();
	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "media-"));
	const output = path.join(dir, `${id}${params.ext}`);

	let input = "";
	if ("base64" in params) {
		input = path.join(dir, `${id}.bin`);
		await fsp.writeFile(input, Buffer.from(params.base64, "base64"));
	} else {
		input = params.file_path;
	}

	const default_args = ["-y" /* overwrite */, "-hide_banner", ["-loglevel", "error"]];
	const args = [...default_args, ["-i", input], ...(params.cmd_args || []), output];
	await new Promise((resolve, reject) => {
		const ffmpeg = proc.spawn(`ffmpeg`, args.flat(), { windowsHide: true });
		let error_output = "";
		ffmpeg.stderr.on("data", (data) => (error_output += data.toString()));
		ffmpeg.on("error", reject);
		ffmpeg.on("close", (code) => {
			if (code != 0) {
				console.error("ffmpeg error:", error_output);
				return reject(new Error(`convert failed: ${code}`));
			}
			resolve(void 0);
		});
	});

	return { dir, output };
}

const exec_file_async = util.promisify(proc.execFile);

/**
 * Run yt-dlp with given arguments.
 * @param {string[]} args - Arguments to pass to yt-dlp (like ['-f', 'best', url])
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export async function yt_dlp(args) {
	try {
		const { stdout, stderr } = await exec_file_async("yt-dlp", args, {
			maxBuffer: 1024 * 1024 * 10, // increase buffer if needed (10MB)
			windowsHide: true,
		});

		return { stdout, stderr };
	} catch (/** @type {any} */ err) {
		// child_process error includes stdout/stderr if available
		throw new Error(`yt-dlp failed: ${err.message}\n${err.stdout || ""}\n${err.stderr || ""}`);
	}
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
