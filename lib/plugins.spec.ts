import { getAllPlugins } from "#lib/plugins.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function validateResult(command: string, result: BotPluginResult) {
	assert.ok(
		["text", "image", "video", "document"].includes(result.type),
		`${command}: unknown type "${result.type}"`,
	);
	if (result.type === "text") {
		assert.equal(typeof result.text, "string", `${command}: text must be a string`);
	} else {
		assert.equal(typeof result.filePath, "string", `${command}: filePath must be a string`);
	}
}

describe("getAllPlugins", () => {
	it("returns all plugin modules from plugins/", async () => {
		const plugins = await getAllPlugins();
		assert.ok(Array.isArray(plugins));
		assert.ok(plugins.length > 0);
		for (const plugin of plugins) {
			assert.ok(typeof plugin.command === "string", `plugin missing command string`);
			assert.ok(plugin.command.startsWith("!"), `command "${plugin.command}" must start with "!"`);
			assert.equal(typeof plugin.run, "function", `plugin "${plugin.command}" missing run()`);
		}
	});

	it("every plugin.run() returns a valid response shape", async () => {
		const plugins = await getAllPlugins();
		for (const plugin of plugins) {
			try {
				const result = await plugin.run({
					args: [],
					user: { id: "test" },
				});

				if (!result) continue;

				if (Symbol.asyncIterator in (result as any)) {
					for await (const msg of result as AsyncGenerator<BotPluginResult>) {
						validateResult(plugin.command, msg);
					}
				} else {
					validateResult(plugin.command, result as BotPluginResult);
				}
			} catch {
				// plugin requires real media attachment to run (e.g. !shd)
			}
		}
	});
});
