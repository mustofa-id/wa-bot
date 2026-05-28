import { cleanUp, convertDocx, getDataDir, ghostScript } from "#lib/utils.ts";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default {
	command: "!pdf",
	description: "Alat PDF: `compress`, `split [range]`, `encrypt <pass>`, `docx`",
	queue: "user",

	async *run({ args, attachment, quoted }) {
		const media = attachment ?? quoted?.attachment;
		if (media?.type !== "document") {
			throw new Error("Lampirkan file PDF");
		}

		const subcommand = args[0];
		if (!subcommand) throw new Error("Gunakan: `!pdf compress|split [range]|encrypt <pass>|docx`");

		yield {
			type: "text",
			text: "Mohon tunggu, sedang memproses...",
			quoted: true,
		};

		const { buffer, mimeType } = await media.get();
		if (mimeType !== "application/pdf") throw new Error("File harus berupa PDF");

		const dataDir = await getDataDir();
		const workDir = join(dataDir.pathname, "pdf-tools");
		await mkdir(workDir, { recursive: true });

		const id = randomUUID();
		const inputPath = join(workDir, `${id}_input.pdf`);
		await writeFile(inputPath, buffer);

		const cleanupPaths: string[] = [inputPath];

		try {
			switch (subcommand.toLowerCase()) {
				case "compress": {
					const outputPath = join(workDir, `${id}_compressed.pdf`);
					cleanupPaths.push(outputPath);

					await ghostScript(inputPath, {
						args: ["-sDEVICE=pdfwrite", "-dPDFSETTINGS=/ebook"],
						outputPath,
					});

					yield { type: "document", filePath: outputPath, quoted: true };
					break;
				}

				case "split": {
					const range = args[1];

					if (range) {
						const parts = range.split("-");
						const firstPage = Number(parts[0]);
						const lastPage = parts[1] ? Number(parts[1]) : firstPage;

						const outputPath = join(workDir, `${id}_p${firstPage}-${lastPage}.pdf`);
						cleanupPaths.push(outputPath);

						await ghostScript(inputPath, {
							args: ["-sDEVICE=pdfwrite", `-dFirstPage=${firstPage}`, `-dLastPage=${lastPage}`],
							outputPath,
						});

						yield { type: "document", filePath: outputPath, quoted: true };
					} else {
						let page = 1;
						while (true) {
							const pagePath = join(workDir, `${id}_page${page}.pdf`);
							try {
								await ghostScript(inputPath, {
									args: ["-sDEVICE=pdfwrite", `-dFirstPage=${page}`, `-dLastPage=${page}`],
									outputPath: pagePath,
								});
								cleanupPaths.push(pagePath);
								yield { type: "document", filePath: pagePath, quoted: true };
								page++;
							} catch {
								break;
							}
						}

						if (page === 1) throw new Error("Gagal membaca file PDF");
					}
					break;
				}

				case "encrypt": {
					const password = args[1];
					if (!password) throw new Error("Gunakan: `!pdf encrypt <password>`");

					const outputPath = join(workDir, `${id}_encrypted.pdf`);
					cleanupPaths.push(outputPath);

					await ghostScript(inputPath, {
						args: [
							"-sDEVICE=pdfwrite",
							"-sOwnerPassword=" + password,
							"-sUserPassword=" + password,
							"-dEncryptionBits=128",
						],
						outputPath,
					});

					yield { type: "document", filePath: outputPath, quoted: true };
					break;
				}

				case "docx": {
					const outputPath = await convertDocx(inputPath, {
						outDir: workDir,
					});
					cleanupPaths.push(outputPath);

					yield { type: "document", filePath: outputPath, quoted: true };
					break;
				}

				default:
					throw new Error("Sub-perintah tidak dikenal: " + subcommand);
			}
		} finally {
			cleanUp(...cleanupPaths);
		}
	},
} satisfies BotPlugin;
