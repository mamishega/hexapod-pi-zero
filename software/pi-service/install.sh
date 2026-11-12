#!/usr/bin/env bash
# Run ON THE PI, from this folder:   bash install.sh
# Sets up everything the robot needs, in one go. Safe to run again.
#   1. Node.js 18 or newer (offers to install it)
#   2. dependencies, the serial port to the Servo 2040, permissions, the hexapod-drive service
#      (deploy/install.sh)
#   3. the Wi-Fi hotspot for offline use (deploy/wifi/install-wifi.sh)
#   4. a reboot if the serial port or permissions changed, otherwise a safe restart
#
#   bash install.sh            full install (or reinstall)
#   bash install.sh --update   after copying new files: new dependencies only if package.json changed,
#                              then a restart once the motors are off. Does the full install instead
#                              if the service is not set up from this folder yet.
#   --no-wifi                  skip the hotspot set-up
#   --yes                      answer yes to every question (reboot included)
set -euo pipefail
cd "$(dirname "$0")"
APP_DIR="$PWD"
MODE=install WIFI=1 YES=0
for arg in "$@"; do
  case "$arg" in
    --update) MODE=update ;;
    --no-wifi) WIFI=0 ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 1 ;;
  esac
done
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31mERROR\033[0m %s\n' "$*" >&2; exit 1; }
ask() { [ "$YES" = 1 ] && return 0; [ -t 0 ] || return 1; read -r -p "$1 [y/N] " answer; [[ "$answer" =~ ^[Yy] ]]; }
[ "$(id -u)" != 0 ] || fail "run this as your normal user, not with sudo: bash install.sh (it asks for sudo itself)"

# Where the installed service runs from (empty: not installed).
service_dir() { systemctl show -p WorkingDirectory --value hexapod-drive.service 2>/dev/null || true; }
deps_changed() { [ ! -d node_modules ] || ! cmp -s package.json .package.json.installed; }
install_deps() { npm install --omit=dev --no-audit --no-fund && cp package.json .package.json.installed; }

# ---------------------------------------------------------------- quick update
if [ "$MODE" = update ]; then
  current="$(service_dir)"
  if [ "$current" = "$APP_DIR" ] && systemctl is-enabled --quiet hexapod-drive.service 2>/dev/null; then
    say "Updating the driving service in $APP_DIR"
    if deps_changed; then echo "package.json changed: installing dependencies (needs internet)…"; install_deps
    else echo "Dependencies unchanged."; fi
    [ -f VERSION ] && echo "Version: $(head -1 VERSION)"
    exec bash deploy/restart-when-safe.sh
  fi
  echo "The service is not set up from $APP_DIR yet (now: ${current:-not installed}). Doing the full install."
fi

# ---------------------------------------------------------------- full install
CONFIG=/boot/firmware/config.txt; [ -f "$CONFIG" ] || CONFIG=/boot/config.txt
CMDLINE=/boot/firmware/cmdline.txt; [ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
# What needs a reboot to take effect: the UART switched on, the serial login console switched off,
# and new groups for this login.
reboot_needed=0
grep -q '^enable_uart=1' "$CONFIG" 2>/dev/null || reboot_needed=1
grep -q 'console=serial0' "$CMDLINE" 2>/dev/null && reboot_needed=1
id -nG | tr ' ' '\n' | grep -qx dialout || reboot_needed=1
id -nG | tr ' ' '\n' | grep -qx input || reboot_needed=1
previous="$(service_dir)"

say "1/4  Node.js"
node_ok() { command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)'; }
if ! node_ok; then
  echo "Node.js 18 or newer is needed (found: $(node --version 2>/dev/null || echo none))."
  ask "Install it now with apt (needs internet)?" || fail "install Node.js 18 or newer, then run this again"
  sudo apt-get update && sudo apt-get install -y nodejs npm || fail "could not install Node.js"
  node_ok || fail "this Raspberry Pi OS offers $(node --version): too old. Install Node.js 18+ from nodejs.org"
fi
echo "Node.js $(node --version)"

say "2/4  Driving service, serial port and permissions"
HEXAPOD_QUIET_NEXT=1 bash deploy/install.sh
cp package.json .package.json.installed
# Moving from another folder (e.g. the old ~/pi-service): bring the controller set-up along.
if [ -n "$previous" ] && [ "$previous" != "$APP_DIR" ]; then
  echo "The service used to run from $previous; it now runs from $APP_DIR."
  for f in controller-map.json controller-map.json.bak; do
    [ ! -f "$f" ] && [ -f "$previous/$f" ] && cp "$previous/$f" "$f" && echo "Copied $f from $previous."
  done
  echo "Saved data in ~/.hexapod is kept. When all is well you can delete $previous."
fi

say "3/4  Wi-Fi hotspot (offline mode)"
if [ "$WIFI" = 0 ]; then echo "Skipped (--no-wifi)."
elif ! command -v nmcli >/dev/null; then warn "NetworkManager (nmcli) not found: hotspot not set up."
else sudo bash deploy/wifi/install-wifi.sh; fi

say "4/4  Starting"
[ -f controller-map.json ] || warn "No controller set-up yet. After this, run: npm run controller-setup (with the service stopped)."
if [ "$reboot_needed" = 1 ]; then
  echo "A reboot is needed: the serial port settings and the new permissions take effect after it."
  echo "The driving service starts by itself after the reboot."
  if ask "Reboot now?"; then sudo reboot; exit 0; fi
  echo "Reboot when ready: sudo reboot"
elif systemctl is-active --quiet hexapod-drive.service; then
  bash deploy/restart-when-safe.sh
else
  sudo systemctl start hexapod-drive.service && echo "The driving service is running."
fi
cat <<EOF

Useful next:
  npm run link-test             test the wires to the Servo 2040 (stop the service first)
  npm run controller-setup      once per controller model
  journalctl -u hexapod-drive -f     watch the service
EOF
