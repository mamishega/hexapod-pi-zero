#!/usr/bin/env bash
# Run ON THE PI:   sudo bash deploy/wifi/install-wifi.sh
# Sets up the Hexapod hotspot (offline mode). Does not change the current connection.
# Run it again after editing /etc/hexapod/wifi.conf to apply a new hotspot name or password.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo bash $0" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
CONF=/etc/hexapod/wifi.conf
HOTSPOT=Hexapod-Hotspot
command -v nmcli >/dev/null || { echo "NetworkManager (nmcli) is required." >&2; exit 1; }

mkdir -p /etc/hexapod
if [ ! -f "$CONF" ]; then
  # A different name per robot (last 4 characters of the Wi-Fi MAC address), so several robots can share a room.
  suffix=$(tr -d ':' < /sys/class/net/wlan0/address | tail -c 5 | tr 'a-f' 'A-F')
  cat > "$CONF" <<EOF
# Hexapod Wi-Fi settings. After changing the name or password run:
#   sudo bash $HERE/install-wifi.sh
# MODE: auto (saved network, otherwise hotspot), hotspot (always), station (never hotspot)
MODE=auto
HOTSPOT_SSID=Hexapod-$suffix
# At least 8 characters.
HOTSPOT_PASSWORD=hexapod2026
# While the hotspot runs with nobody connected, look for a saved network this often.
RETRY_MINUTES=10
EOF
  echo "Created $CONF"
fi
# Readable by the driving service's user (the Live View's Join card shows the hotspot name, and the
# password only to devices already on the hotspot); hidden from other users.
chown "root:${SUDO_USER:-root}" "$CONF"; chmod 640 "$CONF"
. "$CONF"
[ ${#HOTSPOT_PASSWORD} -ge 8 ] || { echo "HOTSPOT_PASSWORD in $CONF must be at least 8 characters." >&2; exit 1; }

# The hotspot connection: 2.4 GHz (the only band the Pi Zero 2 W has), WPA2, the Pi at 10.42.0.1
# handing out addresses. Autoconnect is off: hexapod-wifi decides when it runs.
SETTINGS=(802-11-wireless.ssid "$HOTSPOT_SSID" 802-11-wireless.mode ap 802-11-wireless.band bg 802-11-wireless.channel 6
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$HOTSPOT_PASSWORD" wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp wifi-sec.pmf disable
  ipv4.method shared ipv4.addresses 10.42.0.1/24 ipv6.method disabled connection.autoconnect no)
if nmcli -t -f NAME con show | grep -qx "$HOTSPOT"; then
  nmcli con modify "$HOTSPOT" "${SETTINGS[@]}"; echo "Updated the $HOTSPOT connection"
else
  nmcli con add type wifi ifname wlan0 con-name "$HOTSPOT" "${SETTINGS[@]}" >/dev/null; echo "Created the $HOTSPOT connection"
fi

install -m 755 "$HERE/hexapod-wifi" /usr/local/bin/hexapod-wifi
rm -f /usr/local/sbin/hexapod-wifi   # older location
install -m 644 "$HERE/hexapod-wifi.service" "$HERE/hexapod-wifi.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hexapod-wifi.timer >/dev/null
echo
echo "Done. Hotspot name: $HOTSPOT_SSID   password: $HOTSPOT_PASSWORD"
echo "With no saved network in range, the hotspot starts about a minute after power-on."
echo "Then join it and open http://10.42.0.1:5181 for the Live View."
echo
/usr/local/bin/hexapod-wifi status
