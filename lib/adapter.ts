export async function createAdapter(type?: string): Promise<BotAdapter> {
	const name = type ?? process.env.ADAPTER ?? "baileys";
	switch (name) {
		case "baileys": {
			const { default: AdapterClass } = await import("#adapters/baileys/index.ts");
			return new AdapterClass();
		}
		default:
			throw new Error(`Adapter tidak dikenal: ${name}`);
	}
}
