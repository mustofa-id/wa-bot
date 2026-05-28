import { prompt } from "#lib/conversation.ts";

const WORDS = [
	{ en: "abandon", id: "meninggalkan" },
	{ en: "accomplish", id: "mencapai" },
	{ en: "acquire", id: "memperoleh" },
	{ en: "adequate", id: "memadai" },
	{ en: "advocate", id: "menganjurkan" },
	{ en: "allocate", id: "mengalokasikan" },
	{ en: "anticipate", id: "mengantisipasi" },
	{ en: "apparent", id: "nyata" },
	{ en: "approach", id: "pendekatan" },
	{ en: "assess", id: "menilai" },
	{ en: "assume", id: "menganggap" },
	{ en: "aware", id: "sadar" },
	{ en: "benefit", id: "manfaat" },
	{ en: "comprehensive", id: "menyeluruh" },
	{ en: "confine", id: "membatasi" },
	{ en: "consequence", id: "konsekuensi" },
	{ en: "considerable", id: "besar" },
	{ en: "contribute", id: "berkontribusi" },
	{ en: "convey", id: "menyampaikan" },
	{ en: "crucial", id: "penting" },
	{ en: "demonstrate", id: "menunjukkan" },
	{ en: "derive", id: "memperoleh" },
	{ en: "distribute", id: "membagikan" },
	{ en: "emerge", id: "muncul" },
	{ en: "emphasis", id: "penekanan" },
	{ en: "encounter", id: "menemui" },
	{ en: "establish", id: "mendirikan" },
	{ en: "evaluate", id: "mengevaluasi" },
	{ en: "evident", id: "jelas" },
	{ en: "expand", id: "memperluas" },
	{ en: "expose", id: "mengekspos" },
	{ en: "feasible", id: "layak" },
	{ en: "fluctuate", id: "berfluktuasi" },
	{ en: "genuine", id: "tulus" },
	{ en: "guarantee", id: "menjamin" },
	{ en: "highlight", id: "menyoroti" },
	{ en: "imply", id: "menyiratkan" },
	{ en: "inevitable", id: "tak terhindarkan" },
	{ en: "influence", id: "pengaruh" },
	{ en: "interpret", id: "menafsirkan" },
	{ en: "investigate", id: "menyelidiki" },
	{ en: "maintain", id: "mempertahankan" },
	{ en: "negotiate", id: "negosiasi" },
	{ en: "obtain", id: "mendapatkan" },
	{ en: "occupy", id: "menempati" },
	{ en: "participate", id: "berpartisipasi" },
	{ en: "perceive", id: "memersepsikan" },
	{ en: "portion", id: "bagian" },
	{ en: "precise", id: "tepat" },
	{ en: "presume", id: "mengira" },
	{ en: "prevail", id: "berlaku" },
	{ en: "promote", id: "mempromosikan" },
	{ en: "propose", id: "mengusulkan" },
	{ en: "pursue", id: "mengejar" },
	{ en: "reluctant", id: "enggan" },
	{ en: "resource", id: "sumber daya" },
	{ en: "restrict", id: "membatasi" },
	{ en: "retain", id: "menyimpan" },
	{ en: "reveal", id: "mengungkapkan" },
	{ en: "sufficient", id: "cukup" },
	{ en: "sustain", id: "mempertahankan" },
	{ en: "undergo", id: "menjalani" },
	{ en: "voluntary", id: "sukarela" },
	{ en: "widespread", id: "luas" },
];

export default {
	command: "!vocab",
	description: "Latihan kosakata Bahasa Inggris (level menengah)",
	async *run() {
		let correct = 0;
		let total = 0;
		const used = new Set<number>();

		while (used.size < WORDS.length) {
			let idx: number;
			do {
				idx = Math.floor(Math.random() * WORDS.length);
			} while (used.has(idx));
			used.add(idx);
			total++;

			const word = WORDS[idx];

			const answer = yield prompt({
				type: "text",
				text: `(${total}) Apa arti kata *${word.en}*?`,
			});

			const isCorrect = (answer ?? "").trim().toLowerCase() === word.id.toLowerCase();
			if (isCorrect) correct++;

			let phonetic = "";
			let definition = "";
			let example = "";
			try {
				const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.en}`);
				if (res.ok) {
					const data = (await res.json()) as any;
					const entry = data[0];
					phonetic = entry?.phonetic ?? "";
					const meaning = entry?.meanings?.[0]?.definitions?.[0];
					if (meaning) {
						definition = meaning.definition ?? "";
						example = meaning.example ?? "";
					}
				}
			} catch {}

			const parts: string[] = [];
			if (isCorrect) {
				parts.push(`✅ Benar! (${correct}/${total})`);
			} else {
				parts.push(`❌ Salah. *${word.en}* artinya *${word.id}* (${correct}/${total})`);
			}

			if (definition) {
				const detail = [phonetic, definition].filter(Boolean).join(" — ");
				parts.push(`📖 ${detail}`);
				if (example) parts.push(`💬 _${example}_`);
			}

			yield { type: "text", text: parts.join("\n"), quoted: true };

			if (used.size >= WORDS.length) {
				yield { type: "text", text: "Semua kata sudah dijawab! 🎉" };
				break;
			}

			const cont = yield prompt({
				type: "text",
				text: "Lanjut? (ya/tidak)",
			});

			if (!["ya", "y", "yes", "lanjut"].includes((cont ?? "").trim().toLowerCase())) {
				break;
			}
		}

		yield {
			type: "text",
			text: `Selesai! Skor akhir: ${correct}/${total} 🎉`,
			quoted: true,
		};
	},
} satisfies BotPlugin;
