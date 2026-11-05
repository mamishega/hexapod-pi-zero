#!/usr/bin/env bash
# Restarts the driving service only when the robot's motors are off, because a restart drops the robot.
# Usage: bash deploy/restart-when-safe.sh [seconds to wait, default 600]
# DRY_RUN=1 prints what it would do instead of restarting.
PORT="${HEXAPOD_LIVE_PORT:-5181}"
WAIT="${1:-600}"
restart() { if [ -n "${DRY_RUN:-}" ]; then echo "(dry run) would run: sudo systemctl restart hexapod-drive"; else sudo systemctl restart hexapod-drive; fi; }
told=""
for ((waited = 0; waited <= WAIT; waited += 3)); do
  status="$(curl -s --max-time 2 "http://127.0.0.1:$PORT/status" || true)"
  if [ -z "$status" ]; then echo "The driving service is not answering: restarting it."; restart; exit $?; fi
  if ! printf '%s' "$status" | grep -q '"motorsOn"'; then
    # An older version without the safety check (the first update to this version).
    echo "The running version cannot report whether the motors are on."
    if [ -t 0 ]; then
      read -r -p "Is the robot sitting with its motors off (X, then View)? Type yes to restart: " answer
      if [ "$answer" = "yes" ]; then restart; exit $?; fi
    fi
    echo "Not restarted. Restart it yourself when the motors are off: sudo systemctl restart hexapod-drive"; exit 1
  fi
  if printf '%s' "$status" | grep -q '"motorsOn":false'; then
    echo "Motors are off: restarting the driving service."; restart || exit $?
    echo "Done. The new version is running (see the bottom of the Live View's side panel)."; exit 0
  fi
  if [ -z "$told" ]; then echo "The motors are on. Make the robot sit (X), then press View to switch them off. Waiting…"; told=1; fi
  sleep 3
done
echo "Gave up after ${WAIT} s: the motors stayed on. Run 'bash ~/pi-service/deploy/restart-when-safe.sh' when the robot is sitting with its motors off."
exit 1
