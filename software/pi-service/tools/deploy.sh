#!/usr/bin/env bash
# Safe one-command update, run on the Mac:   npm run deploy            (or: npm run deploy -- 10.52.126.57)
# Kept for the old command: it now sends the whole repository with send-to-pi.sh (to ~/hexapod-pi-zero
# on the Pi), installs new dependencies if package.json changed, and restarts the driving service
# only once the motors are off (a restart drops the robot). The controller set-up and ~/.hexapod are kept.
set -euo pipefail
exec bash "$(cd "$(dirname "$0")/../../.." && pwd)/send-to-pi.sh" "$@"
