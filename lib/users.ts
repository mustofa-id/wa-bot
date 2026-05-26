import { useSqlite } from "#lib/utils.ts";
import type { SQLOutputValue } from "node:sqlite";

export interface UserRow extends Record<string, SQLOutputValue> {
	id: number;
	pnJid: string;
	lidJid: string;
	pushName: string | null;
	username: string | null;
	approved_at: string | null;
	enabled: number;
	created_at: string;
}

const db = await useSqlite("users");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pnJid TEXT NOT NULL,
  lidJid TEXT UNIQUE NOT NULL,
  pushName TEXT,
  username TEXT,
  approved_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const insertStmt = db.prepare("INSERT INTO users (pnJid, lidJid, pushName, username) VALUES (?, ?, ?, ?)");
const deleteStmt = db.prepare("DELETE FROM users WHERE id = ?");
const setEnabledStmt = db.prepare("UPDATE users SET enabled = ? WHERE id = ?");
const selectAllStmt = db.prepare("SELECT * FROM users ORDER BY id");
const selectByLidStmt = db.prepare("SELECT enabled, approved_at FROM users WHERE lidJid = ?");
const approveStmt = db.prepare("UPDATE users SET approved_at = datetime('now') WHERE id = ?");

export function addUser(pnJid: string, lidJid: string, pushName?: string | null, username?: string | null) {
	if (!pnJid || !lidJid) {
		throw new Error("pnJid and lidJid are required");
	}
	insertStmt.run(pnJid, lidJid, pushName ?? null, username ?? null);
}

export function removeUser(id: number) {
	if (!Number.isFinite(id) || id < 1) {
		throw new Error("Invalid user id");
	}
	deleteStmt.run(id);
}

export function enableUser(id: number) {
	if (!Number.isFinite(id) || id < 1) {
		throw new Error("Invalid user id");
	}
	setEnabledStmt.run(1, id);
}

export function disableUser(id: number) {
	if (!Number.isFinite(id) || id < 1) {
		throw new Error("Invalid user id");
	}
	setEnabledStmt.run(0, id);
}

export function approveUser(id: number) {
	if (!Number.isFinite(id) || id < 1) {
		throw new Error("Invalid user id");
	}
	approveStmt.run(id);
}

export function listUsers(): UserRow[] {
	return selectAllStmt.all() as UserRow[];
}

export type UserAccess = "ok" | "unregistered" | "disabled" | "unapproved";

export function checkUserAccess(lidJid: string): UserAccess {
	const row = selectByLidStmt.get(lidJid) as { enabled: number; approved_at: string | null } | undefined;
	if (!row) return "unregistered";
	if (row.enabled !== 1) return "disabled";
	if (!row.approved_at) return "unapproved";
	return "ok";
}
