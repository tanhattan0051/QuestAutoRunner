/*
 * QuestAutoRunner — Vencord userplugin (v4, hash-pinned)
 *
 * - Polls Discord REST mỗi N giây, auto-enroll quest mới
 * - Fetch script aamiaa qua native (bypass CSP) VÀ verify SHA-256
 * - Chỉ eval nếu hash khớp `pinnedHash.txt`
 * - Nếu chưa pin / hash khác: tự đóng băng + tự tắt plugin + notify admin
 *
 * Mục tiêu bảo mật: tránh việc gist aamiaa bị tamper/inject shell mà plugin
 * cứ thế eval lên Discord (account = compromised).
 *
 * Script gốc (GPL-3.0): https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb
 */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { RestAPI } from "@webpack/common";

const Native = VencordNative.pluginHelpers.QuestAutoRunner as PluginNative<typeof import("./native")>;

const logger = new Logger("QuestAutoRunner");
const processed = new Set<string>();
const notified = new Set<string>();

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let hashCheckTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;
let firstTick = true;
let frozen = false;

const settings = definePluginSettings({
    autoEnroll: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Tự nhận (enroll) quest mới"
    },
    autoRun: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Tự fetch + eval script aamiaa sau khi enroll (cần hash pinned)"
    },
    notifyDone: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Hiện notification khi quest 100%"
    },
    pollIntervalSec: {
        type: OptionType.NUMBER,
        default: 60,
        description: "Chu kỳ check quest (giây), tối thiểu 15"
    },
    hashCheckIntervalHours: {
        type: OptionType.NUMBER,
        default: 4,
        description: "Chu kỳ check hash gist độc lập (giờ, min 1) — báo sớm nếu aamiaa đổi gist khi chưa có quest mới"
    }
});

function notify(title: string, body: string) {
    try {
        new Notification(title, { body });
    } catch (e) {
        logger.warn("Notification failed", e);
    }
}

function freeze(reason: string) {
    if (frozen) return;
    frozen = true;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    if (hashCheckTimer) clearTimeout(hashCheckTimer);
    hashCheckTimer = null;
    logger.error("FROZEN: " + reason);
    notify("⚠️ QuestAutoRunner FROZEN", "Script aamiaa thay đổi hoặc chưa pin. Xem ~/Desktop/QUEST_AUTORUNNER_FROZEN.txt + review trước khi bật lại.");
    // Desktop fallback so the warning is visible even if macOS notification permission missing
    Native.writeFreezeWarning(reason)
        .then(path => logger.warn(`Freeze warning written: ${path}`))
        .catch(e => logger.warn("writeFreezeWarning failed", e));
    try {
        const v: any = (globalThis as any).Vencord;
        if (v?.Settings?.plugins?.QuestAutoRunner) {
            v.Settings.plugins.QuestAutoRunner.enabled = false;
        }
    } catch (e) {
        logger.warn("self-disable failed", e);
    }
}

function freezeMessage(kind: "unpinned" | "changed", r: any): string {
    if (kind === "unpinned") {
        return (
            `Hash chưa được pin.\n` +
            `→ Chạy pin-aamiaa.sh từ repo QuestAutoRunner để review JS và pin hash.\n` +
            `   (KHÔNG echo hash trực tiếp — sẽ bỏ qua bước review JS.)\n` +
            `Fetched hash: ${r.hash}\n` +
            `Pending JS:   ${r.pendingPath}\n` +
            `Sau khi pin: restart Discord PTB.`
        );
    }
    return (
        `Script aamiaa khác hash đã pin!\n` +
        `  Pinned : ${r.pinnedHash}\n` +
        `  Fetched: ${r.hash}\n` +
        `→ Chạy pin-aamiaa.sh từ repo QuestAutoRunner để review JS mới và pin lại.\n` +
        `   (KHÔNG echo hash trực tiếp — sẽ bỏ qua bước review JS.)\n` +
        `Pending JS: ${r.pendingPath}\n` +
        `Sau khi pin: restart Discord PTB + bật lại plugin trong Vencord settings.`
    );
}

async function hashCheck() {
    if (stopped || frozen) return;
    try {
        const r = await Native.fetchAamiaaScript();
        if (r.status === "ok") {
            logger.info(`Periodic hash check OK (sha256 ${r.hash.slice(0, 12)}…)`);
        } else if (r.status === "unpinned") {
            freeze("[periodic check] " + freezeMessage("unpinned", r));
            return;
        } else if (r.status === "changed") {
            freeze("[periodic check] " + freezeMessage("changed", r));
            return;
        } else {
            logger.warn(`Periodic hash check error: ${r.error}`);
        }
    } catch (e) {
        logger.error("hashCheck error", e);
    }
    if (frozen || stopped) return;
    const hours = Math.max(1, Number(settings.store.hashCheckIntervalHours) || 4);
    hashCheckTimer = setTimeout(hashCheck, hours * 3600 * 1000);
}

async function fetchQuests(): Promise<any[]> {
    const urls = ["/quests/@me", "/users/@me/quests"];
    for (const url of urls) {
        try {
            const res: any = await RestAPI.get({ url });
            const body = res?.body;
            if (Array.isArray(body)) return body;
            if (Array.isArray(body?.quests)) return body.quests;
            if (Array.isArray(body?.user_quests)) return body.user_quests;
            if (body?.id) return [body];
        } catch (e: any) {
            const s = e?.status;
            if (s && s !== 404 && s !== 405) {
                logger.warn(`GET ${url} -> ${s}`, e?.body);
            }
        }
    }
    return [];
}

function questName(q: any): string {
    return q?.config?.messages?.quest_name
        ?? q?.config?.messages?.questName
        ?? q?.id
        ?? "unknown";
}

function isCompleted(q: any): boolean {
    return Boolean(q?.user_status?.completed_at ?? q?.userStatus?.completedAt);
}

function isEnrolled(q: any): boolean {
    return Boolean(q?.user_status?.enrolled_at ?? q?.userStatus?.enrolledAt);
}

function isExpired(q: any): boolean {
    const exp = q?.config?.expires_at ?? q?.config?.expiresAt;
    return Boolean(exp && Date.now() > new Date(exp).getTime());
}

async function handleQuest(q: any) {
    if (frozen) return;
    const id = q?.id;
    if (!id || processed.has(id)) return;
    if (isCompleted(q) || isExpired(q)) return;

    processed.add(id);
    const name = questName(q);

    try {
        if (settings.store.autoEnroll && !isEnrolled(q)) {
            logger.info(`Enrolling: ${name}`);
            await RestAPI.post({
                url: `/quests/${id}/enroll`,
                body: { location: 2 }
            });
        }
        if (!settings.store.autoRun) return;

        logger.info(`Fetching aamiaa for: ${name}`);
        const r = await Native.fetchAamiaaScript();

        // After await, re-check before doing anything: user may have disabled
        // the plugin or another quest already triggered a freeze.
        if (stopped || frozen) return;

        if (r.status === "ok") {
            logger.info(`Running aamiaa (sha256 ${r.hash.slice(0, 12)}…) for: ${name}`);
            (0, eval)(r.script);
            return;
        }

        if (r.status === "unpinned") {
            freeze(freezeMessage("unpinned", r));
            return;
        }

        if (r.status === "changed") {
            freeze(freezeMessage("changed", r));
            return;
        }

        // Transient native error (network, no js block). Keep `id` in `processed`
        // so we don't hammer the gist every tick; user can restart plugin to retry.
        logger.error(`fetch error for "${name}" (will NOT auto-retry; restart plugin to retry): ${r.error}`);
    } catch (e) {
        // Same policy: keep id in processed to avoid retry storms on persistent errors.
        logger.error(`handleQuest "${name}" failed (will NOT auto-retry)`, e);
    }
}

async function tick() {
    if (stopped || frozen) return;

    try {
        const quests = await fetchQuests();

        if (firstTick) {
            let preDone = 0;
            for (const q of quests) {
                if (isCompleted(q)) {
                    notified.add(q.id);
                    processed.add(q.id);
                    preDone++;
                } else if (isExpired(q)) {
                    processed.add(q.id);
                }
            }
            firstTick = false;
            logger.info(`Initial scan: ${quests.length} quest(s), ${preDone} pre-completed (im lặng).`);
        }

        for (const q of quests) {
            await handleQuest(q);
            if (frozen) return;
        }

        if (settings.store.notifyDone) {
            for (const q of quests) {
                if (!isCompleted(q)) continue;
                if (notified.has(q.id)) continue;
                notified.add(q.id);
                const name = questName(q);
                logger.info(`Quest "${name}" 100% — notifying.`);
                notify("Discord Quest Hoàn Thành", `"${name}" đã 100%. Vào Discord bấm Claim Reward.`);
            }
        }
    } catch (e) {
        logger.error("tick error", e);
    }

    if (frozen) return;
    const interval = Math.max(15, Number(settings.store.pollIntervalSec) || 60) * 1000;
    pollTimer = setTimeout(tick, interval);
}

export default definePlugin({
    name: "QuestAutoRunner",
    description: "Tự nhận quest Discord + chạy gist aamiaa (hash-pinned). Đổi script = tự đóng băng & cảnh báo admin. Bạn tự bấm Claim.",
    authors: [{ name: "Tân Tạ", id: 0n }],
    settings,

    start() {
        stopped = false;
        frozen = false;
        firstTick = true;
        processed.clear();
        notified.clear();
        setTimeout(tick, 5000);
        setTimeout(hashCheck, 30_000);
    },

    stop() {
        stopped = true;
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
        if (hashCheckTimer) clearTimeout(hashCheckTimer);
        hashCheckTimer = null;
        processed.clear();
        notified.clear();
    }
});
