# QuestAutoRunner

Vencord userplugin tự nhận quest Discord + chạy script aamiaa (hash-pinned). **KHÔNG** auto-update khi gist đổi: nếu script mới khác bản đã pin → plugin **tự đóng băng + tự tắt + cảnh báo** để admin review trước khi approve. **KHÔNG** auto-claim reward.

- **Tác giả:** Tân Tạ
- **Platform:** macOS + Discord PTB
- **Script gốc (GPL-3.0):** https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb

---

## Mô hình bảo mật

Mỗi lần plugin định eval script aamiaa:

1. Native module (Electron main process) fetch gist
2. Compute SHA-256 của JS block
3. So với `pinnedHash.txt` (admin đã review trước):
   - **Khớp** → eval bình thường
   - **Khác / chưa pin** → ghi script ra `pending.js`, KHÔNG eval, freeze plugin, tắt trong Vencord settings, notify admin

→ Account của bạn không bao giờ chạy code aamiaa chưa được admin approve.

---

## Hoạt động (khi đã pin OK)

1. Poll `/quests/@me` mỗi `pollIntervalSec` giây
2. Quest mới chưa enroll → POST `/quests/{id}/enroll`
3. Native fetch + hash check
4. Renderer `eval` script khớp hash
5. Khi `user_status.completed_at` set → notification macOS để bạn vào Claim Reward thủ công

---

## Yêu cầu

- macOS (test Darwin 25.x, Apple Silicon)
- Discord PTB (https://discord.com/download → PTB)
- Node 22+ (`brew install node` hoặc nvm)
- Git
- Quyền admin (sudo) để patch `/Applications/Discord PTB.app` lần đầu

---

## Cài đặt lần đầu

### 1. Clone Vencord + repo này

```bash
cd ~
git clone --depth 1 https://github.com/Vendicated/Vencord.git
git clone https://github.com/tanhattan0051/QuestAutoRunner.git
cd Vencord
corepack enable pnpm
pnpm install
```

> Sau bước này bạn sẽ có `~/Vencord/` và `~/QuestAutoRunner/`. Mọi path bên dưới giả định layout này; nếu bạn clone chỗ khác thì thay tương ứng.

### 2. Copy plugin vào userplugins

```bash
mkdir -p ~/Vencord/src/userplugins/questAutoRunner
cp ~/QuestAutoRunner/index.ts  ~/Vencord/src/userplugins/questAutoRunner/
cp ~/QuestAutoRunner/native.ts ~/Vencord/src/userplugins/questAutoRunner/
```

### 3. Build Vencord

```bash
cd ~/Vencord && pnpm build
```

### 4. Inject vào Discord PTB

```bash
osascript -e 'quit app "Discord PTB"'
cd ~/Vencord && node scripts/runInstaller.mjs
# → xin password admin (cho spctl whitelist installer)
# → GUI Vencord Installer mở → chọn "Discord PTB" → "Install"
open -a "Discord PTB"
```

### 5. Pin hash script aamiaa (BƯỚC BẢO MẬT — bắt buộc)

```bash
~/QuestAutoRunner/pin-aamiaa.sh
```

Script sẽ:
- Download gist
- Tách JS ra `/tmp/aamiaa.js`
- Hiện hash SHA-256
- Mở file để bạn review (với `$EDITOR`, mặc định `less`)
- Hỏi confirm → nếu yes thì ghi hash vào `~/Library/Application Support/Vencord/settings/questAutoRunner.pinnedHash.txt`

**Đọc kỹ JS khi review.** Tìm:
- `fetch(...)` đến domain lạ (không phải `discord.com`)
- Đọc `localStorage` hoặc cookie chứa token
- Eval / new Function với input từ network
- Gửi DM, message, react bất thường

### 6. Bật plugin trong Discord

- User Settings (⚙️) → **Vencord** → **Plugins** → search `QuestAutoRunner` → bật toggle
- Plugin start sau 5s, log: `Initial scan: N quest(s), M pre-completed (im lặng).`
- Quest active sẽ log `Fetching aamiaa for: ...` → `Running aamiaa (sha256 abc12345...) for: ...`

### 7. Cấp quyền notification

System Settings → Notifications → **Discord PTB** → **Allow notifications**

---

## Khi aamiaa update gist (plugin tự freeze)

Triệu chứng:
- Notification: **⚠️ QuestAutoRunner FROZEN**
- File trên Desktop: **`QUEST_AUTORUNNER_FROZEN.txt`** (fallback nếu notification bị tắt)
- Plugin tự tắt trong Vencord settings (toggle OFF)
- Console log có dòng `FROZEN:` kèm hash mới và hash đang pin

Cách approve bản mới (KHÔNG tự echo hash — phải review JS):

```bash
# 1. Chạy lại pin script — nó sẽ fetch gist mới, hiện hash, MỞ JS để bạn review,
#    rồi mới ghi hash mới vào pinnedHash.txt khi bạn confirm 'y':
~/QuestAutoRunner/pin-aamiaa.sh

# 2. Restart Discord PTB
osascript -e 'quit app "Discord PTB"' && sleep 1 && open -a "Discord PTB"

# 3. Vencord settings → Plugins → bật lại QuestAutoRunner
```

> ⚠️ **Đừng `echo HASH > pinnedHash.txt` trực tiếp.** Nó bỏ qua bước review JS — lớp bảo vệ chính của model bị mất. Luôn chạy `pin-aamiaa.sh` để có cửa sổ review.

Nếu bạn muốn diff bản mới vs bản cũ trước khi pin, native đã ghi sẵn script vào:
`~/Library/Application Support/Vencord/settings/questAutoRunner.pending.js`

---

## Settings (trong Vencord plugin)

| Toggle | Mặc định | Mô tả |
|---|---|---|
| `autoEnroll` | ON | Tự nhận quest mới |
| `autoRun` | ON | Tự fetch + eval script aamiaa (cần hash pinned) |
| `notifyDone` | ON | Notification macOS khi 100% |
| `pollIntervalSec` | 60 | Chu kỳ check quest (giây, min 15) |
| `hashCheckIntervalHours` | 4 | Chu kỳ check hash gist độc lập (giờ, min 1) — báo sớm nếu aamiaa đổi gist khi chưa có quest mới |

---

## File system layout

```
~/Library/Application Support/Vencord/settings/
├── questAutoRunner.pinnedHash.txt   ← hash SHA-256 admin đã approve
└── questAutoRunner.pending.js       ← script aamiaa mới nhất khi hash mismatch
```

```
~/Vencord/src/userplugins/questAutoRunner/  ← deploy target (build từ đây)
├── index.ts
└── native.ts
```

```
~/QuestAutoRunner/  ← source of truth (clone từ GitHub)
├── README.md
├── index.ts
├── native.ts
└── pin-aamiaa.sh
```

---

## Cập nhật plugin (sửa code)

Pull bản mới nhất, copy sang Vencord, build:

```bash
cd ~/QuestAutoRunner && git pull
cp ~/QuestAutoRunner/index.ts ~/QuestAutoRunner/native.ts \
   ~/Vencord/src/userplugins/questAutoRunner/
cd ~/Vencord && pnpm build
```

- Sửa `index.ts` (renderer) → **Cmd+R** trong Discord PTB
- Sửa `native.ts` (main) → **Cmd+Q** Discord PTB + mở lại

---

## Khi Discord auto-update

Discord PTB tự update đôi khi xoá patch Vencord. Triệu chứng: tab Vencord biến mất trong Settings. Fix: chạy lại bước 4 (inject).

## Khi Vencord ra bản mới

```bash
cd ~/Vencord && git pull && pnpm install && pnpm build
# Inject lại nếu Vencord patcher API thay đổi: node scripts/runInstaller.mjs
```

---

## Troubleshooting

### "Error while starting plugin QuestAutoRunner"
- Cmd+Option+I → Console → tìm `[QuestAutoRunner]` xem stack trace
- Hoặc: `tail -200 ~/Library/Application\ Support/discordptb/logs/renderer_js.log | grep QuestAutoRunner`

### Plugin FROZEN ngay lần đầu bật
- Chưa pin hash. Chạy `pin-aamiaa.sh` (bước 5 trên).

### Plugin tự freeze/tắt dù VỪA pin xong (hash luôn lệch)
- Bug cũ: `pin-aamiaa.sh` dùng `awk` (mặc định thêm `\n` cuối) còn `native.ts` trích bằng `lines.slice().join("\n")` (KHÔNG có `\n` cuối) → hash pin lệch hash runtime đúng 1 newline → freeze mỗi lần bật, vĩnh viễn.
- Đã fix: pin script strip newline cuối (`perl -0777 -pe 's/\n\z//'`) cho khớp `native.ts`.
- Nếu pin file của bạn vẫn là hash kiểu cũ (tạo trước bản fix), chạy lại `pin-aamiaa.sh` (bản mới) để pin đúng, rồi bật lại plugin.

### "TypeError: Failed to fetch"
- Native module chưa load. Cmd+Q Discord PTB và mở lại (KHÔNG phải Cmd+R)

### Spam notification quest cũ
- Đã fix từ v3 — lần scan đầu tiên silent những quest đã 100% từ trước

### Notification không xuất hiện
- System Settings → Notifications → Discord PTB → Allow

### Plugin enroll fail `400 Bad Request`
- `body: { location: 2 }` có thể không match endpoint mới. Mở `index.ts`, đổi giá trị `location` (thử 1, 4, 0) hoặc bỏ body

### `/quests/@me` trả 404
- Discord rename endpoint. Đổi URL trong `fetchQuests()` của `index.ts`. Tìm endpoint thật: DevTools → Network → mở tab Quests trong Discord → xem request đi đâu

---

## Rủi ro

- **Vi phạm Discord ToS.** Từ 4/2026 Discord crack down quest automation. Cân nhắc account phụ.
- Hash-pinning **không** bảo vệ khỏi gist aamiaa malicious từ đầu — nếu lần đầu pin mà không review kỹ JS, bạn vẫn dính. **Review thật sự khi chạy `pin-aamiaa.sh`.**

---

## Files trong repo

- `README.md` — file này
- `index.ts` — renderer plugin (REST poll, enroll, hash-checked eval, freeze logic)
- `native.ts` — main-process module (fetch gist + SHA-256 + pin file I/O)
- `pin-aamiaa.sh` — helper script để pin hash mới (chạy bằng bash)

## License

GPL-3.0 (theo Vencord và script aamiaa).
