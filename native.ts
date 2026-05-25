/*
 * QuestAutoRunner — native side. Runs in Electron main process.
 *
 * Security model:
 * - Fetches aamiaa gist (bypasses renderer CSP)
 * - Computes SHA-256 of the extracted JS
 * - Compares with admin-pinned hash file
 * - Only returns script when hash matches
 * - On mismatch / unpinned: saves the pending script to disk for admin review,
 *   returns a refusal status. Renderer freezes the plugin + notifies.
 *
 * Files (in Vencord settings dir ~/Library/Application Support/Vencord/settings/):
 *   questAutoRunner.pinnedHash.txt  — 64-hex SHA-256, the only version admin trusts
 *   questAutoRunner.pending.js      — last fetched script when hash didn't match
 */

import { createHash } from "crypto";
import { IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const GIST_URL = "https://gist.githubusercontent.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb/raw/CompleteDiscordQuest.md";

const SETTINGS_DIR = join(homedir(), "Library", "Application Support", "Vencord", "settings");
const PINNED_HASH_FILE = join(SETTINGS_DIR, "questAutoRunner.pinnedHash.txt");
const PENDING_SCRIPT_FILE = join(SETTINGS_DIR, "questAutoRunner.pending.js");

function ensureDir() {
    if (!existsSync(SETTINGS_DIR)) mkdirSync(SETTINGS_DIR, { recursive: true });
}

function sha256(s: string): string {
    return createHash("sha256").update(s, "utf-8").digest("hex");
}

function readPinned(): string | null {
    try {
        if (!existsSync(PINNED_HASH_FILE)) return null;
        const v = readFileSync(PINNED_HASH_FILE, "utf-8").trim().toLowerCase();
        return /^[a-f0-9]{64}$/.test(v) ? v : null;
    } catch {
        return null;
    }
}

export type FetchResult =
    | { status: "ok"; script: string; hash: string }
    | { status: "unpinned"; hash: string; pendingPath: string; pinnedHashPath: string }
    | { status: "changed"; hash: string; pinnedHash: string; pendingPath: string; pinnedHashPath: string }
    | { status: "error"; error: string };

export async function fetchAamiaaScript(_: IpcMainInvokeEvent): Promise<FetchResult> {
    try {
        ensureDir();
        const r = await fetch(GIST_URL, { cache: "no-store" });
        if (!r.ok) return { status: "error", error: `gist HTTP ${r.status}` };
        const md = await r.text();
        const m = md.match(/```js\n([\s\S]*?)\n```/);
        if (!m) return { status: "error", error: "no ```js block in gist" };
        const script = m[1];
        const hash = sha256(script);
        const pinned = readPinned();

        if (pinned === null) {
            writeFileSync(PENDING_SCRIPT_FILE, script, "utf-8");
            return {
                status: "unpinned",
                hash,
                pendingPath: PENDING_SCRIPT_FILE,
                pinnedHashPath: PINNED_HASH_FILE
            };
        }
        if (pinned === hash) {
            return { status: "ok", script, hash };
        }
        writeFileSync(PENDING_SCRIPT_FILE, script, "utf-8");
        return {
            status: "changed",
            hash,
            pinnedHash: pinned,
            pendingPath: PENDING_SCRIPT_FILE,
            pinnedHashPath: PINNED_HASH_FILE
        };
    } catch (e: any) {
        return { status: "error", error: String(e?.message || e) };
    }
}
