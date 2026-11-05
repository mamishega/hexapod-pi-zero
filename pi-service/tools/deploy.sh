#!/usr/bin/env bash
# Safe one-command update, run on the Mac:   npm run deploy            (or: npm run deploy -- 10.52.126.57)
# Copies this pi-service folder to the robot, records the version, installs new dependencies if
# package.json changed, then restarts the driving service only once the motors are off (a restart
# drops the robot). Keeps the robot's controller map and its saved data (~/.hexapod).
set -euo pipefail
HOST="${1:-hexapod.local}"
TARGET="${HEXAPOD_USER:-kangan}@$HOST"
cd "$(dirname "$0")/.."
VERSION="$(git describe --always --dirty 2>/dev/null || echo unknown) · $(date '+%-d %b %Y %H:%M')"
echo "Sending version $VERSION to $TARGET"
echo "$VERSION" > VERSION
trap 'rm -f VERSION' EXIT
rsync -az --delete --exclude node_modules --exclude controller-map.json --exclude controller-map.json.bak \
  --exclude .package.json.installed --exclude .DS_Store ./ "$TARGET:~/pi-service/"
ssh -t "$TARGET" 'cd ~/pi-service && { cmp -s package.json .package.json.installed || { echo "Installing dependencies…"; npm install --omit=dev --no-audit --no-fund && cp package.json .package.json.installed; }; } && bash deploy/restart-when-safe.sh'
