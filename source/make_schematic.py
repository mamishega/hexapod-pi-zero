"""Wiring schematic for the Hexapod Pi Zero 2 W version, as SVG (+ HTML wrapper for PDF/PNG)."""
import sys
from pathlib import Path

W, H = 1700, 1240
RED, BLACK, ORANGE = '#c62828', '#222222', '#e07b00'
TX, RX = '#1565c0', '#2e7d32'
ACCENT, MUTED, BOX = '#0d7a69', '#5f6f75', '#f4f7f8'
out = []
add = out.append


def text(x, y, s, size=15, weight='normal', fill='#111', anchor='start', italic=False):
    style = ' font-style="italic"' if italic else ''
    add(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{style}>{s}</text>')


def box(x, y, w, h, title, sub=None, fill=BOX, stroke='#37474f', dash=False, title_size=19, top=0):
    d = ' stroke-dasharray="8 6"' if dash else ''
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="2"{d}/>')
    text(x + 14, y + 28 + top, title, title_size, 'bold')
    if sub:
        for i, line in enumerate(sub if isinstance(sub, list) else [sub]):
            text(x + 14, y + 52 + top + i * 20, line, 14, fill=MUTED)


def wire(points, color, width=4, dash=False):
    d = ' stroke-dasharray="10 7"' if dash else ''
    pts = ' '.join(f'{x},{y}' for x, y in points)
    add(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"{d}/>')


def dot(x, y, color):
    add(f'<circle cx="{x}" cy="{y}" r="6" fill="{color}"/>')


def pin(x, y, label, color, below=False, w=74):
    add(f'<rect x="{x - w / 2}" y="{y - 13}" width="{w}" height="26" rx="4" fill="#fff" stroke="{color}" stroke-width="2"/>')
    text(x, y + 5, label, 13, 'bold', color, 'middle')


def tag(x, y, s, color, anchor='start'):
    text(x, y, s, 13, 'bold', color, anchor)


add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Helvetica, Arial, sans-serif">')
add(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')

# ---------- Title ----------
text(40, 52, 'Hexapod — Raspberry Pi Zero 2 W wiring schematic', 30, 'bold')
text(40, 82, 'Xbox controller (Bluetooth) → Pi Zero 2 W → UART on the Servo 2040 SDA/SCL pins → 18 servos', 16, fill=MUTED)

# ---------- Wireless devices ----------
box(470, 120, 250, 92, 'Xbox controller', ['Series X|S recommended'])
box(1330, 120, 330, 92, 'Phone / laptop (optional)', ['Browser: http://hexapod.local:5181'], dash=True)

# ---------- Raspberry Pi ----------
PX, PY, PW, PH = 860, 260, 400, 270
box(PX, PY, PW, PH, 'Raspberry Pi Zero 2 W', ['Raspberry Pi OS Lite (64-bit)', 'Headless driving service (Node.js)', 'Bluetooth + 2.4 GHz Wi-Fi', 'config.txt: enable_uart=1'], fill='#eef7f5', stroke=ACCENT, title_size=21)
# PWR IN micro-USB on the left edge
add(f'<rect x="{PX - 42}" y="436" width="84" height="60" rx="4" fill="#fff" stroke="{ORANGE}" stroke-width="2"/>')
text(PX, 461, 'PWR IN', 13, 'bold', ORANGE, 'middle')
text(PX, 479, '5 V + GND', 11, 'bold', BLACK, 'middle')
text(PX + 50, 470, 'micro-USB', 13, fill=MUTED)
# GPIO header pins on the bottom edge
G = {'gnd': 945, 'tx': 1040, 'rx': 1135, 'v33': 1225}
pin(G['gnd'], PY + PH, 'Pin 6', BLACK)
pin(G['tx'], PY + PH, 'Pin 8', TX)
pin(G['rx'], PY + PH, 'Pin 10', RX)
pin(G['v33'], PY + PH, 'Pin 1', MUTED, w=60)
text(G['gnd'], PY + PH - 22, 'GND', 12, 'bold', BLACK, 'middle')
text(G['tx'], PY + PH - 22, 'GPIO14 TXD', 12, 'bold', TX, 'middle')
text(G['rx'], PY + PH - 22, 'GPIO15 RXD', 12, 'bold', RX, 'middle')
text(G['v33'], PY + PH - 22, '3V3', 12, 'bold', MUTED, 'middle')

# ---------- Servo 2040 ----------
SX, SY, SW, SH = 860, 680, 400, 300
box(SX, SY, SW, SH, 'Pimoroni Servo 2040', ['RP2040 · MicroPython', 'motion_bridge.py (listens on USB + UART)', '3-second watchdog: motors off if', 'the Pi stops talking'], fill='#f3f1fb', stroke='#5e35b1', title_size=21, top=58)
text(G['gnd'] - 40, SY - 22, 'Qw/ST connector', 13, 'bold', '#5e35b1', 'end')
pin(G['gnd'], SY, 'GND', BLACK)
pin(G['tx'], SY, 'SCL', TX)
pin(G['rx'], SY, 'SDA', RX)
pin(G['v33'], SY, '3V3', MUTED, w=60)
text(G['tx'], SY + 34, 'GP21 = RX', 12, 'bold', TX, 'middle')
text(G['rx'], SY + 34, 'GP20 = TX', 12, 'bold', RX, 'middle')
# Servo power terminal (left edge) and USB-C (bottom edge)
pin(SX, 900, 'V+  V−', RED, w=84)
text(SX + 50, 905, 'servo power terminal', 13, fill=MUTED)
pin(1060, SY + SH, 'USB-C', MUTED, w=74)
# Servo outputs (right edge)
pin(SX + SW, 830, 'Servo 1–18', '#5e35b1', w=100)

# ---------- UART wires (straight down between the headers) ----------
y1, y2 = PY + PH + 13, SY - 13
wire([(G['gnd'], y1), (G['gnd'], y2)], BLACK)
wire([(G['tx'], y1), (G['tx'], y2)], TX)
wire([(G['rx'], y1), (G['rx'], y2)], RX)
mid = (y1 + y2) / 2
tag(G['gnd'] - 10, mid + 5, 'GND ↔ GND', BLACK, 'end')
tag(G['tx'] + 8, mid - 20, 'TX → RX', TX)
tag(G['rx'] + 8, mid + 25, 'RX ← TX', RX)
# 3V3 not connected
for yy in (y1 + 10, y2 - 10):
    add(f'<line x1="{G["v33"]}" y1="{yy}" x2="{G["v33"]}" y2="{yy + (14 if yy < mid else -14)}" stroke="{MUTED}" stroke-width="3"/>')
add(f'<g stroke="{RED}" stroke-width="4"><line x1="{G["v33"] - 12}" y1="{mid - 12}" x2="{G["v33"] + 12}" y2="{mid + 12}"/><line x1="{G["v33"] - 12}" y1="{mid + 12}" x2="{G["v33"] + 12}" y2="{mid - 12}"/></g>')
text(G['v33'] + 22, mid + 5, 'NOT connected', 13, 'bold', RED)

# ---------- Power ----------
# Switch and fuse on the + wire only; one continuous ground (black) from the battery.
box(40, 690, 230, 130, 'Battery pack', ['Servo supply: the voltage', 'your servos are rated for'], fill='#fff4f2', stroke=RED)
text(258, 730, '+', 18, 'bold', RED, 'end')
text(258, 800, '−', 20, 'bold', BLACK, 'end')
box(330, 696, 170, 64, 'Main switch', ['+ fuse, on the + wire'], fill='#fff4f2', stroke=RED, title_size=17)
POS, GND_Y = 725, 795
# battery + -> switch -> servo power terminal V+
wire([(270, POS), (330, POS)], RED)
wire([(500, POS), (790, POS), (790, 893), (SX - 42, 893)], RED)
# battery - -> servo power terminal V- (straight past the switch)
wire([(270, GND_Y), (770, GND_Y), (770, 909), (SX - 42, 909)], BLACK)
tag(640, 715, 'servo power +', RED)
tag(640, 815, 'ground (−)', BLACK)
# + branch up to the buck converter IN+
wire([(560, POS), (560, 490)], RED)
dot(560, POS, RED)
tag(568, 600, 'IN +', RED)
# - branch up to the buck converter IN-, hopping over the + wire (not connected)
HX, HR = 610, 9
add(f'<path d="M{HX},{GND_Y} L{HX},{POS + HR} A{HR},{HR} 0 0 1 {HX},{POS - HR} L{HX},490" fill="none" stroke="{BLACK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>')
dot(HX, GND_Y, BLACK)
tag(618, 640, 'IN −', BLACK)
# buck converter -> Pi PWR IN: 5 V and GND (a micro-USB lead carries both)
box(470, 380, 250, 110, '5 V buck converter', ['≥ 2 A, for the Pi only', 'OUT → micro-USB lead'], fill='#fff8ec', stroke=ORANGE)
text(714, 446, 'OUT +', 11, 'bold', ORANGE, 'end')
text(714, 484, 'OUT −', 11, 'bold', BLACK, 'end')
wire([(720, 450), (PX - 42, 450)], ORANGE, 5)
wire([(720, 482), (PX - 42, 482)], BLACK, 4)
tag(740, 441, '5 V', ORANGE)
tag(740, 500, 'GND', BLACK)

# ---------- Wireless links ----------
wire([(720, 166), (900, 166), (900, PY)], ACCENT, 3, True)
tag(745, 156, 'Bluetooth', ACCENT)
wire([(1330, 166), (1200, 166), (1200, PY)], ACCENT, 3, True)
tag(1210, 156, 'Wi-Fi (planned)', ACCENT)

# ---------- Optional laptop on USB-C ----------
box(40, 880, 330, 86, 'Laptop (optional)', ['Thonny / Motion Studio over USB-C'], dash=True)
wire([(1060, SY + SH + 13), (1060, 1005), (205, 1005), (205, 966)], MUTED, 3, True)

# ---------- Servos ----------
legs = [('L1', 1), ('L2', 4), ('L3', 7), ('R1', 10), ('R2', 13), ('R3', 16)]
LX = 1380
text(LX, 640, 'Servo outputs (hip, upper leg, lower leg)', 15, 'bold')
for i, (name, first) in enumerate(legs):
    y = 660 + i * 58
    add(f'<rect x="{LX}" y="{y}" width="280" height="46" rx="8" fill="#f3f1fb" stroke="#5e35b1" stroke-width="1.5"/>')
    text(LX + 14, y + 29, f'Leg {name}', 15, 'bold')
    text(LX + 95, y + 29, f'outputs {first}, {first + 1}, {first + 2}', 14, fill=MUTED)
wire([(SX + SW + 50, 830), (LX - 20, 830)], '#5e35b1', 5)
wire([(LX - 20, 683), (LX - 20, 973)], '#5e35b1', 3)
for i in range(6):
    wire([(LX - 20, 683 + i * 58), (LX, 683 + i * 58)], '#5e35b1', 3)

# ---------- Notes ----------
NY = 1036
text(40, NY, 'Before wiring', 17, 'bold', RED)
notes = [
    '1. VERIFY on the Servo 2040 pinout that SDA = GP20 and SCL = GP21 (UART1 TX/RX).',
    '2. Cross the wires: Pi TX → Servo RX, Pi RX ← Servo TX. Join GND. Do NOT join 3V3.',
    '3. Both boards use 3.3 V logic: no level shifter. Keep UART wires under 20–30 cm.',
    '4. Power the Pi from its own 5 V regulator (5 V and GND), never from the servo rail directly.',
    '5. Common ground: battery −, buck converter, Pi and Servo 2040 GND are all joined.',
    '6. Switch the servo power off before connecting or disconnecting anything.',
]
for i, n in enumerate(notes):
    text(40, NY + 26 + i * 22, n, 14)

# legend
LY = 1206
text(40, LY + 5, 'Legend', 15, 'bold')
items = [(RED, 'Battery / servo power +', False), (BLACK, 'Ground (−)', False), (ORANGE, '5 V for the Pi', False),
         (TX, 'UART: Pi → Servo 2040', False), (RX, 'UART: Servo 2040 → Pi', False), (ACCENT, 'Wireless', True)]
for i, (c, label, dash) in enumerate(items):
    x = 130 + i * 205
    y = LY + 5
    wire([(x, y - 5), (x + 30, y - 5)], c, 4, dash)
    text(x + 38, y, label, 12)

# title block
add(f'<rect x="1380" y="1050" width="280" height="160" rx="8" fill="none" stroke="#37474f" stroke-width="1.5"/>')
text(1396, 1078, 'Hexapod Pi Zero 2 W', 16, 'bold')
text(1396, 1102, 'Wiring schematic · Rev B', 13, fill=MUTED)
text(1396, 1124, '4 November 2026', 13, fill=MUTED)
text(1396, 1156, 'Status: planned, not yet built', 13, 'bold', RED)
text(1396, 1180, 'Pin labels to be verified', 13, fill=MUTED)
add('</svg>')

svg = '\n'.join(out)
dest = Path(sys.argv[1])
(dest / 'Wiring Schematic.svg').write_text(svg, encoding='utf-8')
html = ('<!doctype html><html><head><meta charset="utf-8"><title>Hexapod Pi Zero 2 W wiring schematic</title>'
        '<style>@page{size:A3 landscape;margin:8mm}html,body{margin:0;background:#fff}svg{height:278mm;width:auto;max-width:100%;display:block;margin:0 auto}</style>'
        '</head><body>' + svg + '</body></html>')
(dest / 'schematic.html').write_text(html, encoding='utf-8')
print('ok')
