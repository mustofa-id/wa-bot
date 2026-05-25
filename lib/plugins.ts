import { useSQLiteAuthState } from "#adapters/baileys/auth.ts";
import { addUser, disableUser, enableUser, listUsers, removeUser } from "#lib/users.ts";
import { normalizePhone, phoneFromJid } from "#lib/utils.ts";
import { glob } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pkg from "../package.json" with { type: "json" };

function helpPlugin(modules: BotPlugin[]): BotPlugin {
	return {
		command: "!help",
		description: "Menampilkan bantuan dan perintah yang tersedia",
		run() {
			const lines = modules.map((p) => {
				const description = p.description ? ` — ${p.description}` : "";
				return `- \`${p.command}\`${description}`;
			});
			return {
				type: "text",
				quoted: true,
				text:
					`WA-Bot v${pkg.version} ©2026 \n` +
					`Source: https://github.com/mustofa-id/wa-bot \n` +
					`${"─".repeat(16)} \n` +
					`*Daftar Perintah:* \n` +
					`${lines.join("\n\n")}`,
			};
		},
	};
}

function usersPlugin(): BotPlugin {
	return {
		command: "!users",
		description: "Mengelola pengguna. Sub-perintah: add, ls, rm, on, off",
		async run({ args, user }) {
			const { state } = await useSQLiteAuthState();
			const ownerPhone = phoneFromJid(state.creds.me?.id ?? "");
			const senderPhone = phoneFromJid(user.pnJid ?? user.id);

			let message: string;

			if (senderPhone !== ownerPhone) {
				message = "Hanya pemilik yang dapat menggunakan perintah ini";
			} else {
				const [sub, ...rest] = args;
				switch (sub) {
					case "add": {
						const raw = rest[0];
						const name = rest.slice(1).join(" ") || undefined;
						if (!raw) {
							message = "Usage: !users add <phone> [name]";
						} else {
							const phone = normalizePhone(raw);
							if (!phone || phone.length < 8) {
								message = "Nomor telepon tidak valid";
							} else {
								try {
									addUser(phone, name);
									message = `Pengguna ${phone}${name ? ` (${name})` : ""} berhasil ditambahkan`;
								} catch (e: any) {
									message = `Gagal menambahkan: ${e.message}`;
								}
							}
						}
						break;
					}

					case "ls": {
						const users = listUsers();
						if (!users.length) {
							message = "Belum ada pengguna terdaftar";
						} else {
							const lines = users.map(
								(u) =>
									`- #${u.id} ${u.phone}${u.name ? ` (${u.name})` : ""} [${u.enabled ? "aktif" : "nonaktif"}]`,
							);
							message = `*Pengguna Terdaftar:*\n${lines.join("\n")}`;
						}
						break;
					}

					case "rm": {
						const target = rest[0];
						if (!target) {
							message = "Usage: !users rm <phone_number|id>";
						} else {
							removeUser(target);
							message = `Pengguna ${target} berhasil dihapus`;
						}
						break;
					}

					case "on": {
						const target = rest[0];
						if (!target) {
							message = "Usage: !users on <phone_number|id>";
						} else {
							enableUser(target);
							message = `Pengguna ${target} telah diaktifkan`;
						}
						break;
					}

					case "off": {
						const target = rest[0];
						if (!target) {
							message = "Usage: !users off <phone_number|id>";
						} else {
							disableUser(target);
							message = `Pengguna ${target} telah di-nonaktifkan`;
						}
						break;
					}

					default:
						message =
							`Sub-perintah tidak dikenali. Gunakan:\n` +
							`- !users add <phone>\n` +
							`- !users ls\n` +
							`- !users rm <phone|id>\n` +
							`- !users on <phone|id>\n` +
							`- !users off <phone|id>`;
				}
			}

			return { type: "text", text: message, quoted: true };
		},
	};
}

/** Returns all plugins — both user-defined from plugins/ and built-ins. */
export async function getAllPlugins() {
	const pluginsDir = new URL("../plugins/", import.meta.url);
	const plugins = await Array.fromAsync(glob(pluginsDir.pathname + "/**.ts"));
	const modules = await Promise.all(
		plugins.map(async (p) => {
			const modUrl = pathToFileURL(p).href;
			const mod = await import(modUrl);
			return mod.default as BotPlugin;
		}),
	);

	modules.push(usersPlugin());
	modules.push(helpPlugin(modules));

	const seen = new Set<string>();
	for (const plugin of modules) {
		if (seen.has(plugin.command)) {
			throw new Error(`Duplicate plugin command: ${plugin.command}`);
		}
		seen.add(plugin.command);
	}

	return modules;
}
