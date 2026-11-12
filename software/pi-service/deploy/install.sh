#!/usr/bin/env bash
# Run ON THE PI from the pi-service folder:   bash deploy/install.sh
# (Usually run for you by ./install.sh, which also sets up Node.js, the hotspot and the restart.)
# Installs dependencies, sets up the UART for the Servo 2040, and installs the
# hexapod-drive service so it starts at boot. Safe to run again after updates.
set -euo pipefail
cd "$(dirname "$0")/.."
APP_DIR="$PWD"
RUN_USER="${SUDO_USER:-$USER}"
say() { printf '\n== %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }

say "Checking Node.js"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { warn "Node.js is missing. Install it first:  sudo apt install -y nodejs npm"; exit 1; }
"$NODE" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || { warn "Node.js 18 or newer is needed (found $("$NODE" --version))."; exit 1; }
echo "Node.js $("$NODE" --version) at $NODE"

say "Installing dependencies (serialport)"
npm install --omit=dev --no-audit --no-fund

say "Serial port: hardware UART on, login console off"
# The login console must NOT run on the UART, or it would talk to the Servo 2040.
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_serial_hw 0 || warn "Could not enable the UART with raspi-config; add enable_uart=1 to /boot/firmware/config.txt"
  sudo raspi-config nonint do_serial_cons 1 || warn "Could not turn off the serial console; remove console=serial0,115200 from /boot/firmware/cmdline.txt"
else
  warn "raspi-config not found: make sure enable_uart=1 is set and the serial console is off."
fi
CONFIG=/boot/firmware/config.txt; [ -f "$CONFIG" ] || CONFIG=/boot/config.txt
grep -q '^enable_uart=1' "$CONFIG" && echo "enable_uart=1 is set in $CONFIG" || warn "enable_uart=1 not found in $CONFIG"

say "Permissions for $RUN_USER (serial port and controller)"
sudo usermod -aG dialout,input "$RUN_USER"

say "Installing the hexapod-drive service"
sed -e "s#__USER__#$RUN_USER#g" -e "s#__DIR__#$APP_DIR#g" -e "s#__NODE__#$NODE#g" deploy/hexapod-drive.service | sudo tee /etc/systemd/system/hexapod-drive.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable hexapod-drive.service

[ -f controller-map.json ] || warn "No controller-map.json yet: run  npm run controller-setup  before driving."

say "Done"
# install.sh (the one-step installer) prints its own next steps.
[ -n "${HEXAPOD_QUIET_NEXT:-}" ] && exit 0
cat <<EOF
Next:
  1. sudo reboot                      (applies the serial and group changes)
  2. npm run link-test                (with the service stopped: checks the wiring)
  3. npm run controller-setup         (once per controller model)
  4. sudo systemctl start hexapod-drive
Logs:  journalctl -u hexapod-drive -f
EOF
