#!/usr/bin/env bash
# Run on the Mac. Copies the shared, tested code from the Motion Trainer project into
# this folder, so the Pi version always uses the same board program and driving logic.
#   vendor/      robot.js, gamepad.js, model.js, transport.js, simulator.js (do not edit here)
#   ../board-files/   the board program, with the Pi version's main.py (USB + UART)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${1:-$HERE/../../../Hexapod Motion Trainer New}"  # next to this repository
[ -f "$REPO/Board Files/motion_bridge.py" ] || { echo "Motion Trainer project not found at: $REPO" >&2; exit 1; }

mkdir -p "$HERE/vendor/webapp/dist" "$HERE/vendor/controller/src"
for f in model.js transport.js simulator.js; do cp "$REPO/webapp/dist/$f" "$HERE/vendor/webapp/dist/$f"; done
for f in robot.js gamepad.js; do cp "$REPO/controller/src/$f" "$HERE/vendor/controller/src/$f"; done

BOARD="$HERE/../board-files"
mkdir -p "$BOARD"
for f in FUNCTIONS.py calibration_store.py motion_bridge.py; do cp "$REPO/Board Files/$f" "$BOARD/$f"; done
cat > "$BOARD/main.py" <<'PY'
"""Raspberry Pi version startup: commands over USB and over the Pi's UART link.
Boots with all servo outputs disabled."""
import motion_bridge

if __name__ == '__main__':
    motion_bridge.run(uart=True)
PY
cat > "$BOARD/check_and_restart.py" <<'PY'
"""Run in Thonny after uploading the four board files to the board root (Pi version)."""
import os
import machine
for name in ('main.py', 'FUNCTIONS.py', 'calibration_store.py', 'motion_bridge.py'):
    os.stat(name)
import motion_bridge
controller = motion_bridge.Controller()
print('Bridge ready (USB + Raspberry Pi UART):', controller.state(True)['protocol'])
print('Close Thonny; the board restarts and waits for the Pi.')
machine.reset()
PY
echo "Synced from: $REPO"
{ (cd "$REPO" && git log -1 --format='Motion Trainer commit: %h %s' 2>/dev/null)
  (cd "$REPO" && [ -n "$(git status --porcelain -- 'Board Files' webapp/dist controller/src 2>/dev/null)" ] && echo 'plus uncommitted changes in the synced files') || true
  date '+Synced: %Y-%m-%d %H:%M'; } | tee "$HERE/vendor/SOURCE.txt"
