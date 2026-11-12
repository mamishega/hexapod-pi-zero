#!/usr/bin/env bash
# Copies the board program in software/board-files onto the Servo 2040 over USB, the same
# files Thonny would copy, then checks them and restarts the board.
#
#   bash software/flash-board.sh              find the board by itself
#   bash software/flash-board.sh /dev/ttyACM0 use this port (macOS: /dev/cu.usbmodem…)
#   bash software/flash-board.sh --dry-run    show what would happen; touch nothing
#   bash software/flash-board.sh --yes        do not ask before starting
#
# - Backs up every .py and .json file on the board first, into software/board-backups/<time>/.
# - Never touches calibration_offsets.json or joint_limits.json (the robot's calibration).
# - Needs mpremote (MicroPython's file tool): python3 -m pip install --user mpremote
# - Close Thonny first: only one program can use the port.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BOARD_DIR="$HERE/board-files"
FILES=(main.py motion_bridge.py FUNCTIONS.py calibration_store.py)
KEEP=(calibration_offsets.json joint_limits.json)
DRY=0 YES=0 PORT=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $arg (try --help)" >&2; exit 1 ;;
    *) PORT="$arg" ;;
  esac
done
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mERROR\033[0m %s\n' "$*" >&2; exit 1; }

# ---- the files to copy
for f in "${FILES[@]}"; do [ -f "$BOARD_DIR/$f" ] || fail "missing $BOARD_DIR/$f"; done
grep -q 'ARM_SERVO_GAP_MS' "$BOARD_DIR/motion_bridge.py" \
  || echo "Note: this motion_bridge.py has no surge protection (ARM_SERVO_GAP_MS)."

# ---- mpremote
if command -v mpremote >/dev/null 2>&1; then MP=(mpremote)
elif python3 -c 'import mpremote' >/dev/null 2>&1; then MP=(python3 -m mpremote)
else
  echo "mpremote is not installed. It is MicroPython's tool for copying files to a board."
  if [ "$DRY" = 1 ]; then MP=(mpremote); echo "(dry run: carrying on as if it were)"
  else
    read -r -p "Install it now with 'python3 -m pip install --user mpremote'? [y/N] " answer
    [[ "$answer" =~ ^[Yy] ]] || fail "install mpremote, then run this again"
    python3 -m pip install --user mpremote || fail "could not install mpremote"
    MP=(python3 -m mpremote)
  fi
fi

# ---- the port
if [ -z "$PORT" ]; then
  shopt -s nullglob
  found=(/dev/serial/by-id/*MicroPython* /dev/cu.usbmodem*)
  [ ${#found[@]} -eq 0 ] && found=(/dev/ttyACM*)
  shopt -u nullglob
  [ ${#found[@]} -eq 0 ] && fail "no board found. Plug the Servo 2040 in by USB-C (a data cable, not charge-only)."
  [ ${#found[@]} -gt 1 ] && fail "more than one possible board: ${found[*]}. Name one: bash $0 <port>"
  PORT="$(readlink -f "${found[0]}" 2>/dev/null || echo "${found[0]}")"
fi
[ -e "$PORT" ] || fail "no such port: $PORT"
if [ "$DRY" != 1 ] && { [ ! -r "$PORT" ] || [ ! -w "$PORT" ]; }; then
  fail "no permission to use $PORT. On Linux: sudo usermod -aG dialout \$USER, then log out and in."
fi
mp() { "${MP[@]}" connect "$PORT" "$@"; }

say "Flash the Servo 2040 on $PORT"
cat <<EOF
Copies:  ${FILES[*]}
Keeps:   ${KEEP[*]} (calibration, never touched)
Backup:  software/board-backups/<time>/

Stopping the board program switches every servo output off, so:
  - turn the robot's main switch OFF (the board runs from USB alone), or support the body
  - close Thonny
EOF
if [ "$DRY" = 1 ]; then
  say "Dry run: nothing was changed. The steps would be:"
  echo "  ${MP[*]} connect $PORT fs ls :                        (list, then back up each .py/.json)"
  echo "  ${MP[*]} connect $PORT fs cp ${FILES[*]} :"
  echo "  ${MP[*]} connect $PORT exec <check sizes and import motion_bridge>"
  echo "  ${MP[*]} connect $PORT reset"
  exit 0
fi
if [ "$YES" != 1 ]; then
  read -r -p "Ready? [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]] || { echo "Nothing changed."; exit 0; }
fi

# ---- 1. back up what is on the board now
say "1/4  Backing up the board's files"
listing="$(mp fs ls : 2>&1)" || fail "could not talk to the board. Is Thonny (or another program) using $PORT?
$listing"
on_board=()  # (a loop, not mapfile: macOS ships bash 3.2)
while IFS= read -r f; do on_board+=("$f"); done < <(printf '%s\n' "$listing" | awk 'NF >= 2 && $1 ~ /^[0-9]+$/ {print $NF}' | grep -E '\.(py|json)$' || true)
BACKUP="$HERE/board-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
for f in ${on_board[@]+"${on_board[@]}"}; do mp fs cp ":$f" "$BACKUP/$f" >/dev/null; echo "  $f"; done
[ ${#on_board[@]} -eq 0 ] && echo "  (the board has no .py or .json files yet)"
for f in "${KEEP[@]}"; do
  printf '%s\n' ${on_board[@]+"${on_board[@]}"} | grep -qx "$f" || echo "  Note: $f is not on the board; the defaults in FUNCTIONS.py will be used."
done
for f in ${on_board[@]+"${on_board[@]}"}; do
  [ "$f" = boot.py ] && echo "  WARNING: the board has a boot.py. It runs before main.py; check it does not move the servos."
done
echo "  saved in ${BACKUP#"$HERE/"}"

# ---- 2. copy
say "2/4  Copying the board program"
(cd "$BOARD_DIR" && mp fs cp "${FILES[@]}" :) || fail "copy failed; the backup is in $BACKUP"

# ---- 3. check: every file arrived whole, and the program imports
say "3/4  Checking"
sizes=""
for f in "${FILES[@]}"; do sizes+="('$f', $(wc -c < "$BOARD_DIR/$f" | tr -d ' ')),"; done
check="import os
bad = [n for n, s in ($sizes) if os.stat(n)[6] != s]
print('SIZES', 'OK' if not bad else 'WRONG ' + ' '.join(bad))
import motion_bridge
state = motion_bridge.Controller().state(True)
print('PROTOCOL', state['protocol'])
print('SURGE', 'yes' if hasattr(motion_bridge, 'ARM_SERVO_GAP_MS') else 'no')
print('OUTPUTS', 'off' if not state['active'] else 'ON')"
result="$(mp exec "$check" 2>&1)" || fail "the new program does not start on the board:
$result
Restore the backup with: cd $BACKUP && ${MP[*]} connect $PORT fs cp *.py :"
printf '%s\n' "$result" | sed 's/^/  /'
printf '%s\n' "$result" | grep -q '^SIZES OK' || fail "a file did not copy completely; run this again"

# ---- 4. restart into the new program
say "4/4  Restarting the board"
mp reset >/dev/null 2>&1 || true
echo "  Done. The board now runs main.py from software/board-files, with all servo outputs off."
echo "  Plug it back into the Pi, then press A on the controller to enable (servos switch on one at a time)."
