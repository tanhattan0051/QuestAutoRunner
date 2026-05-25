#!/usr/bin/env bash
# pin-aamiaa.sh — fetch aamiaa gist, hash, show JS for review, then pin if admin OK
#
# Workflow:
#   1. Download gist
#   2. Extract ```js block to /tmp/aamiaa.js
#   3. Compute SHA-256
#   4. Mở /tmp/aamiaa.js trong editor (mặc định $EDITOR hoặc less)
#   5. Hỏi confirm
#   6. Nếu yes → ghi hash vào pinnedHash.txt + nhắc restart Discord PTB

set -euo pipefail

GIST_URL="https://gist.githubusercontent.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb/raw/CompleteDiscordQuest.md"
SETTINGS_DIR="$HOME/Library/Application Support/Vencord/settings"
PINNED_HASH_FILE="$SETTINGS_DIR/questAutoRunner.pinnedHash.txt"
TMP_JS="/tmp/aamiaa.js"

mkdir -p "$SETTINGS_DIR"

echo ">>> Downloading gist..."
curl -fsSL "$GIST_URL" > /tmp/aamiaa.md

echo ">>> Extracting JS block..."
awk '/^```js$/{f=1; next} /^```$/{f=0} f' /tmp/aamiaa.md > "$TMP_JS"
if [[ ! -s "$TMP_JS" ]]; then
  echo "FAIL: no JS block in gist" >&2
  exit 1
fi

HASH=$(shasum -a 256 "$TMP_JS" | awk '{print $1}')
echo ">>> Fetched $(wc -l < "$TMP_JS") lines, sha256=$HASH"

CURRENT=""
if [[ -f "$PINNED_HASH_FILE" ]]; then
  CURRENT=$(tr -d '[:space:]' < "$PINNED_HASH_FILE")
  if [[ "$CURRENT" == "$HASH" ]]; then
    echo ">>> Hash đã pin trùng với hash mới fetch — không cần update."
    exit 0
  fi
  echo ">>> Hash hiện đang pin : $CURRENT"
  echo ">>> Hash mới sẽ pin    : $HASH"
fi

EDITOR_CMD="${EDITOR:-less}"
echo ""
echo ">>> Mở $TMP_JS để review (dùng $EDITOR_CMD)."
echo ">>> Đọc kỹ — nếu có dòng nào trông giống malicious (exfil token, gửi DM, etc.), TRẢ LỜI 'no'."
read -rp ">>> Nhấn Enter để mở file... " _
$EDITOR_CMD "$TMP_JS" || true

echo ""
read -rp ">>> Approve và pin hash $HASH? [y/N] " ans
case "$ans" in
  y|Y|yes|YES)
    echo "$HASH" > "$PINNED_HASH_FILE"
    echo ">>> Pinned: $PINNED_HASH_FILE"
    echo ">>> Restart Discord PTB:"
    echo "      osascript -e 'quit app \"Discord PTB\"' && sleep 1 && open -a \"Discord PTB\""
    echo ">>> Nếu plugin trước đó tự disable: vào Settings → Vencord → Plugins → bật lại QuestAutoRunner."
    ;;
  *)
    echo ">>> Huỷ. Không thay đổi pin."
    exit 1
    ;;
esac
