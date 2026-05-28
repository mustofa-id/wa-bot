import { addUser, addUserByPhone, approveUser, disableUser, enableUser, listUsers, removeUser } from "#lib/users.ts";
import { normalizePhone, stripDeviceSuffix } from "#lib/utils.ts";
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

function registerPlugin(): BotPlugin {
	return {
		command: "!register",
		description: "Mendaftarkan diri untuk menggunakan aplikasi",
		async run({ user }) {
			if (!user.pnJid || !user.lidJid) {
				return {
					type: "text",
					text: "Tidak dapat mendaftar: data pengguna tidak lengkap.",
					quoted: true,
				};
			}

			try {
				addUser(user.pnJid, user.lidJid, user.pushName, user.username);
				return {
					type: "text",
					text: "Pendaftaran berhasil. Silakan tunggu persetujuan dari pemilik.",
					quoted: true,
				};
			} catch (e: any) {
				if (e.message?.includes("UNIQUE constraint failed")) {
					return {
						type: "text",
						text: "Kamu sudah terdaftar.",
						quoted: true,
					};
				}
				return {
					type: "text",
					text: `Gagal mendaftar: ${e.message}`,
					quoted: true,
				};
			}
		},
	};
}

function usersPlugin(ownerId: string): BotPlugin {
	return {
		command: "!users",
		description: "Mengelola pengguna. Sub-perintah: `add`, `approve`, `ls`, `rm`, `on`, `off`",
		async run({ args, user }) {
			const senderId = stripDeviceSuffix(user.lidJid);

			let message: string;

			if (senderId !== ownerId) {
				message = "Hanya pemilik yang dapat menggunakan perintah ini";
			} else {
				const [sub, ...rest] = args;
				switch (sub) {
					case "add": {
						const raw = rest[0];
						if (!raw) {
							message = "Usage: !users add <phone>";
						} else {
							try {
								const phone = normalizePhone(raw);
								const row = addUserByPhone(phone);
								message = `Pengguna #${row.id} berhasil ditambahkan (${row.pnJid}, ${row.lidJid})`;
							} catch (e: any) {
								if (e.message?.includes("UNIQUE constraint failed")) {
									message = `Nomor ${raw} sudah terdaftar`;
								} else {
									message = `Gagal menambahkan: ${e.message}`;
								}
							}
						}
						break;
					}

					case "approve": {
						const raw = rest[0];
						if (!raw) {
							message = "Usage: !users approve <id>";
						} else {
							const id = Number(raw);
							if (!Number.isFinite(id) || id < 1) {
								message = "ID tidak valid";
							} else {
								try {
									approveUser(id);
									message = `Pengguna #${id} telah disetujui`;
								} catch (e: any) {
									message = `Gagal menyetujui: ${e.message}`;
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
							const lines = users.map((u) => {
								const name = u.pushName ? ` (${u.pushName})` : "";
								const status = u.enabled ? "aktif" : "nonaktif";
								const approved = u.approved_at ? "✅" : "❌";
								return `- #${u.id} ${u.pnJid}${name} [${status}] ${approved}`;
							});
							message = `*Pengguna Terdaftar:*\n${lines.join("\n")}`;
						}
						break;
					}

					case "rm": {
						const raw = rest[0];
						if (!raw) {
							message = "Usage: !users rm <id>";
						} else {
							const id = Number(raw);
							if (!Number.isFinite(id) || id < 1) {
								message = "ID tidak valid";
							} else {
								removeUser(id);
								message = `Pengguna #${id} berhasil dihapus`;
							}
						}
						break;
					}

					case "on": {
						const raw = rest[0];
						if (!raw) {
							message = "Usage: !users on <id>";
						} else {
							const id = Number(raw);
							if (!Number.isFinite(id) || id < 1) {
								message = "ID tidak valid";
							} else {
								enableUser(id);
								message = `Pengguna #${id} telah diaktifkan`;
							}
						}
						break;
					}

					case "off": {
						const raw = rest[0];
						if (!raw) {
							message = "Usage: !users off <id>";
						} else {
							const id = Number(raw);
							if (!Number.isFinite(id) || id < 1) {
								message = "ID tidak valid";
							} else {
								disableUser(id);
								message = `Pengguna #${id} telah di-nonaktifkan`;
							}
						}
						break;
					}

					default:
						message =
							`Sub-perintah tidak dikenali. Gunakan:\n` +
							`- !users add <phone>\n` +
							`- !users approve <id>\n` +
							`- !users ls\n` +
							`- !users rm <id>\n` +
							`- !users on <id>\n` +
							`- !users off <id>`;
				}
			}

			return { type: "text", text: message, quoted: true };
		},
	};
}

/** Returns all plugins — both user-defined from plugins/ and built-ins. */
export async function getAllPlugins(ownerId: string) {
	const pluginsDir = new URL("../plugins/", import.meta.url);
	const plugins = await Array.fromAsync(glob(pluginsDir.pathname + "/**.ts"));
	const modules = await Promise.all(
		plugins
			.filter((p) => !p.endsWith(".spec.ts"))
			.map(async (p) => {
				const modUrl = pathToFileURL(p).href;
				const mod = await import(modUrl);
				return mod.default as BotPlugin;
			}),
	);

	modules.push(registerPlugin());
	modules.push(usersPlugin(ownerId));
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
