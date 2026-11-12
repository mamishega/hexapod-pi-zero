#!/usr/bin/env bash
# Run on your computer (Mac or Linux). Copies this whole repository to the robot's Pi over scp,
# then installs or updates the driving service there.
#
#   bash send-to-pi.sh                     copy to kangan@hexapod.local, then update the service
#   bash send-to-pi.sh 10.52.126.57        use an IP address (or the hotspot: 10.42.0.1)
#   bash send-to-pi.sh --install           first time on this Pi: copy, then run the full install
#   bash send-to-pi.sh --copy-only         copy, change nothing else
#   bash send-to-pi.sh --dry-run           show what would be sent; send nothing
#
#   HEXAPOD_USER=kangan  HEXAPOD_DIR=hexapod-pi-zero   login and folder (in the home folder) on the Pi
#
# On the Pi the repository goes to ~/hexapod-pi-zero. The previous copy is kept as
# ~/hexapod-pi-zero.previous. Kept from the robot's own copy: node_modules, the controller set-up
# (controller-map.json) and board backups. Saved data in ~/.hexapod is never touched.
# You type the Pi's password once (one shared SSH connection).
set -euo pipefail
cd "$(dirname "$0")"
HOST=hexapod.local MODE=update DRY=0
for arg in "$@"; do
  case "$arg" in
    --install) MODE=install ;;
    --copy-only) MODE=copy ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $arg (try --help)" >&2; exit 1 ;;
    *) HOST="$arg" ;;
  esac
done
USER_ON_PI="${HEXAPOD_USER:-kangan}"
DIR="${HEXAPOD_DIR:-hexapod-pi-zero}"
TARGET="$USER_ON_PI@$HOST"
SVC=software/pi-service
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mERROR\033[0m %s\n' "$*" >&2; exit 1; }

# Everything except what is rebuilt, belongs to this computer, or belongs to the robot.
EXCLUDES=(--exclude=.git --exclude=node_modules --exclude=.DS_Store --exclude='._*' --exclude=__pycache__
  --exclude="./$SVC/controller-map.json" --exclude="./$SVC/controller-map.json.bak" --exclude="./$SVC/VERSION"
  --exclude="./$SVC/.package.json.installed" --exclude=./software/board-backups --exclude=./images
  --exclude='~$*')
VERSION="$(git describe --always --dirty 2>/dev/null || echo unknown) · $(date '+%-d %b %Y %H:%M')"

ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/hexapod-repo.XXXXXX")"
SOCKET="${TMPDIR:-/tmp}/hexapod-ssh-$$"
cleanup() { rm -f "$ARCHIVE"; ssh -o ControlPath="$SOCKET" -O exit "$TARGET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

say "Packing the repository ($VERSION)"
# COPYFILE_DISABLE: no macOS ._ files in the archive.
COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" "${EXCLUDES[@]}" .
echo "  $(du -h "$ARCHIVE" | cut -f1) to send"
if [ "$DRY" = 1 ]; then
  say "Dry run: nothing sent. It would copy these to $TARGET:~/$DIR"
  tar -tzf "$ARCHIVE" | grep -v '/$' | sed 's#^\./##' | sort | sed 's/^/  /'
  echo; echo "  then on the Pi: $( [ "$MODE" = install ] && echo "bash $SVC/install.sh" || { [ "$MODE" = update ] && echo "bash $SVC/install.sh --update" || echo nothing more; } )"
  exit 0
fi

# One SSH connection for every step, so the password is asked once.
SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$SOCKET" -o ControlPersist=120 -o ConnectTimeout=10)
say "Connecting to $TARGET"
ssh "${SSH_OPTS[@]}" -o ServerAliveInterval=15 -fN "$TARGET" \
  || fail "could not log in to $TARGET. Is the robot on and on the same network? Try its IP address: bash send-to-pi.sh <address>"

say "Copying with scp"
scp -q "${SSH_OPTS[@]}" "$ARCHIVE" "$TARGET:/tmp/hexapod-repo.tgz" || fail "scp failed"

say "Unpacking on the Pi into ~/$DIR"
# ssh joins its arguments into one command line, so quote them for the Pi's shell.
ssh "${SSH_OPTS[@]}" "$TARGET" "bash -s -- $(printf '%q ' "$DIR" "$VERSION")" <<'ON_PI'
set -euo pipefail
DIR="$HOME/$1" VERSION="$2" SVC=software/pi-service ARCHIVE=/tmp/hexapod-repo.tgz
NEW="$DIR.new" OLD="$DIR.previous"
rm -rf "$NEW"; mkdir -p "$NEW"
tar -xzf "$ARCHIVE" -C "$NEW"; rm -f "$ARCHIVE"
# What only the robot has: copied (not moved), so the running copy stays whole until the swap.
for f in "$SVC/node_modules" "$SVC/controller-map.json" "$SVC/controller-map.json.bak" "$SVC/.package.json.installed" software/board-backups; do
  if [ -e "$DIR/$f" ]; then mkdir -p "$(dirname "$NEW/$f")"; cp -a "$DIR/$f" "$NEW/$f"; fi
done
# The first copy after the old layout (~/pi-service): bring its controller set-up.
for f in controller-map.json controller-map.json.bak; do
  if [ ! -e "$NEW/$SVC/$f" ] && [ -f "$HOME/pi-service/$f" ]; then cp -a "$HOME/pi-service/$f" "$NEW/$SVC/$f"; echo "  brought $f from ~/pi-service"; fi
done
printf '%s\n' "$VERSION" > "$NEW/$SVC/VERSION"
rm -rf "$OLD"
if [ -d "$DIR" ]; then mv "$DIR" "$OLD"; fi
mv "$NEW" "$DIR"
echo "  done; the previous copy is in ~/$(basename "$OLD")"
ON_PI

case "$MODE" in
  copy) say "Copied. Nothing else was changed."
        echo "  To install: ssh $TARGET, then: cd ~/$DIR/$SVC && bash install.sh" ;;
  install) say "Installing on the Pi"
           ssh -t "${SSH_OPTS[@]}" "$TARGET" "cd ~/$DIR/$SVC && bash install.sh" ;;
  update) say "Updating the driving service"
          ssh -t "${SSH_OPTS[@]}" "$TARGET" "cd ~/$DIR/$SVC && bash install.sh --update" ;;
esac
