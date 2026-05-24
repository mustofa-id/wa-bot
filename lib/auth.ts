import { getDataDir } from "#lib/utils.ts";
import {
	type AuthenticationCreds,
	BufferJSON,
	initAuthCreds,
	proto,
	type SignalDataSet,
	type SignalKeyStore,
} from "baileys";
import { DatabaseSync } from "node:sqlite";

const dataDir = await getDataDir();
const db = new DatabaseSync(new URL("auth.db", dataDir));

db.exec("PRAGMA journal_mode=WAL;");
db.exec("PRAGMA synchronous=NORMAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS creds (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keys (
  category TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(category, id)
);
`);

const readData = <T>(data: any): T => JSON.parse(data, BufferJSON.reviver);

const writeData = (data: any): string => JSON.stringify(data, BufferJSON.replacer);

// cached prepared statements
const getCredsStmt = db.prepare("SELECT data FROM creds WHERE id = ?");
const setCredsStmt = db.prepare("INSERT OR REPLACE INTO creds(id, data) VALUES (?, ?)");
const getKeyStmt = db.prepare("SELECT data FROM keys WHERE category = ? AND id = ?");
const insertKeyStmt = db.prepare("INSERT OR REPLACE INTO keys(category, id, data) VALUES (?, ?, ?)");
const deleteKeyStmt = db.prepare("DELETE FROM keys WHERE category = ? AND id = ?");

export async function useSQLiteAuthState() {
	// ---------- CREDS ----------
	const credsRow = getCredsStmt.get("creds");
	const creds = credsRow ? readData<AuthenticationCreds>(credsRow.data) : initAuthCreds();

	// ---------- KEYS ----------
	const keys: SignalKeyStore = {
		get: async (type, ids) => {
			const data: Record<string, any> = {};
			for (const id of ids) {
				const row = getKeyStmt.get(type, id);
				if (row?.data) {
					let value: proto.Message.AppStateSyncKeyData = readData(row.data);

					// important for app-state-sync-key
					if (type === "app-state-sync-key" && value) {
						value = proto.Message.AppStateSyncKeyData.fromObject(value);
					}
					data[id] = value;
				}
			}

			return data;
		},

		set: async (data) => {
			for (const category in data) {
				const signal = data[category as keyof SignalDataSet];
				for (const id in signal) {
					const value = signal[id];
					if (value) {
						insertKeyStmt.run(category, id, writeData(value));
					} else {
						deleteKeyStmt.run(category, id);
					}
				}
			}
		},
	};

	// ---------- SAVE CREDS ----------
	const saveCreds = async () => {
		setCredsStmt.run("creds", writeData(creds));
	};

	return { state: { creds, keys }, saveCreds };
}
