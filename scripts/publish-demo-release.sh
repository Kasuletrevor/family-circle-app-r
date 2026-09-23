#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 9 ]]; then
  echo "usage: publish-demo-release.sh <root> <version> <installer> <sha256> <published_at> <commit> <public_base_path> <release_type> <release_title_b64>" >&2
  exit 64
fi

ROOT="$1"
VERSION="$2"
INSTALLER="$3"
EXPECTED_SHA="$4"
PUBLISHED_AT="$5"
COMMIT_SHA="$6"
PUBLIC_BASE_PATH="$7"
RELEASE_TYPE="$8"
RELEASE_TITLE_B64="$9"
RELEASE_TITLE="$(python3 - "$RELEASE_TITLE_B64" <<'PY'
import base64
import sys

print(base64.b64decode(sys.argv[1]).decode("utf-8"), end="")
PY
)"
STAGE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE="$STAGE_DIR/$INSTALLER"

case "$INSTALLER" in
  Family-Circle-Setup-*.exe) ;;
  *)
    echo "Unexpected installer name: $INSTALLER" >&2
    exit 65
    ;;
esac

if [[ ! -f "$SOURCE" ]]; then
  echo "Staged installer is missing: $SOURCE" >&2
  exit 66
fi

ACTUAL_SHA="$(sha256sum "$SOURCE" | awk '{print $1}')"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Staged installer checksum mismatch" >&2
  exit 67
fi

mkdir -p "$ROOT"
TMP_DIR="$ROOT/.publish-$VERSION-$$"
DEST_DIR="$ROOT/$VERSION"
IMMUTABLE_PATH="$PUBLIC_BASE_PATH/$VERSION/$INSTALLER"
LATEST_PATH="$PUBLIC_BASE_PATH/latest/$INSTALLER"

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

install -m 0644 "$SOURCE" "$TMP_DIR/$INSTALLER"
printf '%s  %s\n' "$EXPECTED_SHA" "$INSTALLER" > "$TMP_DIR/$INSTALLER.sha256"
printf '%s\n' "$VERSION" > "$TMP_DIR/VERSION"

python3 - \
  "$TMP_DIR/release.json" \
  "$TMP_DIR/current.json" \
  "$VERSION" \
  "$COMMIT_SHA" \
  "$PUBLISHED_AT" \
  "$IMMUTABLE_PATH" \
  "$LATEST_PATH" \
  "$EXPECTED_SHA" \
  "$RELEASE_TYPE" \
  "$RELEASE_TITLE" <<'PY'
import json
import sys

(
    release_path,
    current_path,
    version,
    commit,
    published_at,
    immutable_installer,
    latest_installer,
    sha256,
    release_type,
    title,
) = sys.argv[1:]

base = {
    "version": version,
    "channel": "main",
    "type": release_type,
    "title": title,
    "commit": commit,
    "published_at": published_at,
    "sha256": sha256,
}

with open(release_path, "w", encoding="utf-8") as handle:
    json.dump({**base, "installer": immutable_installer}, handle, indent=2)
    handle.write("\n")

with open(current_path, "w", encoding="utf-8") as handle:
    json.dump({**base, "installer": latest_installer}, handle, indent=2)
    handle.write("\n")
PY

chmod 0644   "$TMP_DIR/release.json"   "$TMP_DIR/current.json"   "$TMP_DIR/VERSION"   "$TMP_DIR/$INSTALLER.sha256"

if [[ -e "$DEST_DIR" ]]; then
  echo "Release destination already exists: $DEST_DIR" >&2
  rm -rf "$TMP_DIR"
  exit 68
fi

mv "$TMP_DIR" "$DEST_DIR"

python3 - "$ROOT" "$ROOT/.versions.json.tmp" <<'PY'
import json
import os
import sys

root, output = sys.argv[1:3]
versions = []
releases = []

for name in os.listdir(root):
    path = os.path.join(root, name)
    release_path = os.path.join(path, "release.json")
    if name.startswith(".") or name == "latest" or os.path.islink(path):
        continue
    if os.path.isdir(path) and os.path.isfile(release_path):
        versions.append(name)
        try:
            with open(release_path, "r", encoding="utf-8") as handle:
                release = json.load(handle)
            releases.append(release)
        except (OSError, json.JSONDecodeError):
            pass

versions.sort(reverse=True)
releases.sort(
    key=lambda item: (str(item.get("published_at", "")), str(item.get("version", ""))),
    reverse=True,
)

with open(output, "w", encoding="utf-8") as handle:
    json.dump({"versions": versions, "releases": releases}, handle, indent=2)
    handle.write("\n")
PY
mv -f "$ROOT/.versions.json.tmp" "$ROOT/versions.json"
chmod 0644 "$ROOT/versions.json"

# Root compatibility endpoints resolve through latest so installer bytes and
# current metadata switch together when the single latest pointer is replaced.
CURRENT_LINK="$ROOT/.current-$VERSION"
VERSION_LINK="$ROOT/.version-$VERSION"
NEXT_LINK="$ROOT/.latest-$VERSION"
rm -f "$CURRENT_LINK" "$VERSION_LINK" "$NEXT_LINK"
ln -s "latest/current.json" "$CURRENT_LINK"
ln -s "latest/VERSION" "$VERSION_LINK"
ln -s "$VERSION" "$NEXT_LINK"

mv -Tf "$CURRENT_LINK" "$ROOT/current.json"
mv -Tf "$VERSION_LINK" "$ROOT/VERSION"

# This is the publication point. Everything visible through latest/current.json,
# root current.json, root VERSION, and latest/<installer> changes together.
mv -Tf "$NEXT_LINK" "$ROOT/latest"

rm -rf "$STAGE_DIR"

echo "Published demo release $VERSION"
echo "Release note: [$RELEASE_TYPE] $RELEASE_TITLE"
echo "Installer SHA256: $EXPECTED_SHA"
