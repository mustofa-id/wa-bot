import { getDataDir } from "#lib/utils.ts";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

export interface UserRow extends Record<string, SQLOutputValue> {
	id: number;
	phone: string;
	enabled: number;
	created_at: string;
	name: string | null;
}

const dataDir = await getDataDir();
const db = new DatabaseSync(new URL("users.db", dataDir));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT
)`);

const insertStmt = db.prepare("INSERT INTO users (phone, name) VALUES (?, ?)");
const deleteStmt = db.prepare("DELETE FROM users WHERE id = ? OR phone = ?");
const setEnabledStmt = db.prepare("UPDATE users SET enabled = ? WHERE id = ? OR phone = ?");
const selectAllStmt = db.prepare("SELECT * FROM users ORDER BY id");
const selectByPhoneStmt = db.prepare("SELECT enabled FROM users WHERE phone = ?");
const updateNameStmt = db.prepare("UPDATE users SET name = ? WHERE phone = ? AND name IS NULL");

export function addUser(phone: string, name?: string) {
	insertStmt.run(phone, name ?? null);
}

export function removeUser(idOrPhone: string) {
	const id = Number(idOrPhone);
	deleteStmt.run(Number.isNaN(id) ? -1 : id, idOrPhone);
}

export function enableUser(idOrPhone: string) {
	const id = Number(idOrPhone);
	setEnabledStmt.run(1, Number.isNaN(id) ? -1 : id, idOrPhone);
}

export function disableUser(idOrPhone: string) {
	const id = Number(idOrPhone);
	setEnabledStmt.run(0, Number.isNaN(id) ? -1 : id, idOrPhone);
}

export function listUsers(): UserRow[] {
	return selectAllStmt.all() as UserRow[];
}

export function isUserEnabled(phone: string): boolean {
	const row = selectByPhoneStmt.get(phone) as { enabled: number } | undefined;
	return row ? row.enabled === 1 : false;
}

export function updateUserName(phone: string, name: string) {
	try {
		updateNameStmt.run(name, phone);
	} catch {}
}
