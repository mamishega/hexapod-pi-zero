"""Builds the robot overview: one SVG diagram per topic and index.html to scroll through them.

Usage (in docs/overview/src/):  python3 make_overview.py ..
Numbers in the diagrams come from the code (see the comments next to each one); check them
here when the code changes, then rebuild.
"""
import html
import math
import sys
from pathlib import Path

FONT = "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
C = {
    'ink': '#1a2b30', 'muted': '#5f6f75', 'line': '#c9d2d6', 'panel': '#f4f7f8', 'bg': '#ffffff', 'white': '#ffffff',
    'teal': '#0d7a69', 'tealbg': '#e3f2ef', 'blue': '#1565c0', 'bluebg': '#e6eef9',
    'red': '#c62828', 'redbg': '#fbe9e9', 'orange': '#c25e00', 'orangebg': '#fdf0e3',
    'purple': '#5e35b1', 'purplebg': '#efeaf8', 'green': '#2e7d32', 'greenbg': '#e8f3e9',
    'brown': '#6d4c41', 'brownbg': '#f3ede9', 'grey': '#78868b', 'greybg': '#eef1f2', 'black': '#222222',
}


def esc(s):
    return html.escape(str(s), quote=True)


class Svg:
    def __init__(self, w, h, number, title, subtitle):
        self.w, self.h, self.parts, self.markers = w, h, [], set()
        self.title = f'{number} · {title}'
        self.rect(0, 0, w, h, fill=C['bg'], stroke='none', rx=0)
        self.text(40, 50, self.title, 26, '700')
        self.text(40, 78, subtitle, 15, fill=C['muted'])

    def add(self, s):
        self.parts.append(s)

    def rect(self, x, y, w, h, fill=C['panel'], stroke=C['line'], sw=1.5, rx=10.0, dash=False):
        d = ' stroke-dasharray="7 5"' if dash else ''
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def text(self, x, y, s, size=14, weight='400', fill=C['ink'], anchor='start', mono=False, italic=False, halo=False):
        extra = ' font-style="italic"' if italic else ''
        if halo:
            extra += f' paint-order="stroke" stroke="{C["bg"]}" stroke-width="5" stroke-linejoin="round"'
        family = MONO if mono else FONT
        if '  ' in s or s.startswith(' '):
            s = s.replace(' ', '\u00a0')  # SVG collapses runs of spaces
        self.add(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
                 f'fill="{fill}" text-anchor="{anchor}"{extra}>{esc(s)}</text>')

    def lines(self, x, y, rows, size=13, fill=C['ink'], gap=None, anchor='start', mono=False, weight='400', halo=False):
        gap = gap or round(size * 1.38)
        for i, row in enumerate(rows):
            if row:
                self.text(x, y + i * gap, row, size, weight, fill, anchor, mono, halo=halo)
        return y + len(rows) * gap

    def box(self, x, y, w, h, title, body=(), color='teal', size=16, body_size=13, dash=False, fill=None, center=False, mono_body=False):
        self.rect(x, y, w, h, fill=fill or C[color + 'bg'], stroke=C[color], sw=1.8, dash=dash)
        tx, anchor = (x + w / 2, 'middle') if center else (x + 14, 'start')
        if title:
            self.text(tx, y + 24, title, size, '700', C[color] if color not in ('grey',) else C['ink'], anchor)
        if body:
            self.lines(tx, y + (24 + size + 4 if title else 22), body, body_size, C['ink'], anchor=anchor, mono=mono_body)

    def marker(self, color):
        self.markers.add(color)
        return f'url(#ah-{color})'

    def arrow(self, pts, color='ink', width=2.2, dash=False, start=False, end=True, label=None, at=None, size=13,
              anchor='middle', label_color=None, mono=False):
        d = 'M' + ' L'.join(f'{x},{y}' for x, y in pts)
        dash_attr = ' stroke-dasharray="7 5"' if dash else ''
        ms = f' marker-start="{self.marker(color)}"' if start else ''
        me = f' marker-end="{self.marker(color)}"' if end else ''
        self.add(f'<path d="{d}" fill="none" stroke="{C[color]}" stroke-width="{width}" stroke-linejoin="round"{dash_attr}{ms}{me}/>')
        if label:
            if at is None:
                (x1, y1), (x2, y2) = pts[len(pts) // 2 - 1], pts[len(pts) // 2]
                at = ((x1 + x2) / 2, (y1 + y2) / 2 - 8)
            rows = label if isinstance(label, (list, tuple)) else [label]
            self.lines(at[0], at[1], rows, size, C[label_color or color], anchor=anchor, mono=mono, weight='600', halo=True)

    def path(self, d, stroke, width=2.0, fill='none', dash=False, end=False):
        dash_attr = ' stroke-dasharray="6 5"' if dash else ''
        me = f' marker-end="{self.marker(stroke)}"' if end else ''
        self.add(f'<path d="{d}" fill="{fill}" stroke="{C.get(stroke, stroke)}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"{dash_attr}{me}/>')

    def circle(self, x, y, r, fill, stroke='none', sw=1.5):
        self.add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{C.get(fill, fill)}" stroke="{C.get(stroke, stroke)}" stroke-width="{sw}"/>')

    def chip(self, x, y, s, color, size=12):
        w = len(s) * size * 0.6 + 18
        self.rect(x, y, w, size + 10, fill=C[color], stroke='none', rx=(size + 10) / 2)
        self.text(x + w / 2, y + size + 2, s, size, '700', C['white'], 'middle')
        return w

    def render(self):
        defs = ''.join(
            f'<marker id="ah-{c}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" '
            f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{C[c]}"/></marker>' for c in sorted(self.markers))
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" height="{self.h}" '
                f'role="img" aria-label="{esc(self.title)}"><title>{esc(self.title)}</title><defs>{defs}</defs>\n'
                + '\n'.join(self.parts) + '\n</svg>\n')


DIAGRAMS = []


def diagram(slug, title, summary, notice):
    def register(fn):
        DIAGRAMS.append({'slug': slug, 'title': title, 'summary': summary, 'notice': notice, 'make': fn})
        return fn
    return register


# ------------------------------------------------------------------------------------------ 1
@diagram('system', 'The whole robot at a glance', 'What each part does and how the parts talk to each other.', [
    'The Pi decides what to do; the Servo 2040 does the fast, precise work of moving 18 servos.',
    'The Pi does not move individual servos. It sends short text commands such as "walk" or "stop" over three wires.',
    'The Live View only watches. Nothing in a browser can drive the robot.',
])
def d_system(n):
    s = Svg(1200, 700, n, 'The whole robot at a glance', 'What each part does, and how the parts talk to each other')
    s.box(40, 150, 230, 130, 'Xbox controller', ['The driver: sticks', 'and buttons'], 'blue')
    s.box(380, 120, 420, 330, 'Raspberry Pi Zero 2 W', [], 'teal')
    s.text(396, 165, 'Decides what the robot should do', 13, fill=C['muted'])
    s.box(400, 185, 380, 120, 'Driving service (Node.js)', [
        'Reads the controller 50 times a second',
        'Checks every move against reach and joint limits',
        'Sends commands: enable, walk, stand, stop…'], 'teal', 15, fill=C['white'])
    s.box(400, 320, 380, 110, 'Live View web server', [
        'Shows the robot live in any browser',
        'Read-only: it never sends commands'], 'teal', 15, fill=C['white'])
    s.box(910, 120, 250, 330, 'Servo 2040', [
        'MicroPython: motion_bridge.py', '',
        'Runs the walking gait itself',
        'Inverse kinematics every 20 ms',
        'Drives 18 servo outputs',
        'Measures battery volts and amps', '',
        'Watchdog: no message from', 'the Pi for 3 s → motors off'], 'purple')
    s.box(910, 540, 250, 120, '18 servos', ['6 legs × 3 joints:', 'hip · upper leg · lower leg'], 'orange')
    s.box(380, 545, 420, 115, 'Laptops, phones, projector', ['Live View: http://hexapod.local:5181', 'Up to 40 viewers at once'], 'green')
    s.box(40, 395, 230, 115, 'RPLIDAR C1', ['360° laser scanner', 'Planned: wired, no software yet'], 'brown', dash=True)
    s.box(40, 570, 230, 90, 'Battery', ['Powers everything:', 'see diagram 2'], 'red')
    s.arrow([(270, 215), (330, 215), (330, 245), (398, 245)], 'blue', label='Bluetooth', at=(330, 202))
    s.arrow([(782, 245), (908, 245)], 'purple', start=True, label='UART wires', at=(845, 232), size=12)
    s.text(845, 268, '115 200 baud', 12, '600', C['purple'], 'middle')
    s.text(845, 284, 'JSON text lines', 12, '600', C['purple'], 'middle')
    s.arrow([(1035, 452), (1035, 538)], 'orange', label='PWM pulses ×18', at=(1047, 500), anchor='start')
    s.arrow([(590, 432), (590, 543)], 'green', label=['Wi-Fi: web page', 'and live updates'], at=(602, 482), anchor='start', size=12)
    s.arrow([(272, 440), (378, 440)], 'brown', dash=True, label='USB', at=(325, 428))
    return s


# ------------------------------------------------------------------------------------------ 2
@diagram('power', 'Power: two supplies from one battery', 'How the battery feeds the servos, the Pi and the Servo 2040.', [
    'The servos take their power straight from the battery; the Pi gets its own steady 5 V from a buck converter.',
    'The Servo 2040 processor is powered by USB from the Pi, so it stays on when the servo power dips.',
    'The switch and fuse sit on the + wire only; all grounds are joined.',
])
def d_power(n):
    s = Svg(1200, 640, n, 'Power: two supplies from one battery', 'Why the Pi is never powered from the servo supply')
    for i, (color, label) in enumerate([('red', 'Battery + (after the switch)'), ('black', 'Ground (−)'), ('teal', '5 V supply'), ('brown', 'USB lead')]):
        y = 118 + i * 24
        s.add(f'<line x1="40" y1="{y}" x2="80" y2="{y}" stroke="{C[color]}" stroke-width="4"/>')
        s.text(90, y + 5, label, 13)
    s.box(40, 250, 200, 125, 'Battery', ['2S LiPo, about 7.4 V', 'Warning at 7.0 V', 'Critical at 6.6 V'], 'red')
    s.box(300, 130, 200, 90, 'Main switch + fuse', ['On the + wire only'], 'red')
    s.box(640, 100, 240, 130, 'Servo 2040 power', ['Terminal V+ and V−', 'Feeds all 18 servos', 'Measures volts and amps'], 'purple')
    s.box(960, 100, 200, 130, '18 servos', ['Big current spikes', 'while walking'], 'orange')
    s.box(640, 285, 240, 110, '5 V buck converter', ['3 A or more', 'Steady 5 V for the Pi'], 'teal')
    s.box(960, 285, 200, 110, 'Pi Zero 2 W', ['Power: PWR IN port', 'USB: the inner port'], 'teal')
    s.box(640, 470, 240, 110, 'Micro-USB OTG hub', ['On the Pi’s inner USB port'], 'brown')
    s.box(960, 450, 200, 72, 'Servo 2040 logic', ['USB-C: its processor'], 'purple')
    s.box(960, 538, 200, 72, 'RPLIDAR C1', ['Planned'], 'brown', dash=True)
    # + wires
    s.arrow([(240, 280), (270, 280), (270, 175), (298, 175)], 'red', width=3)
    s.arrow([(500, 175), (545, 175), (545, 150), (638, 150)], 'red', width=3, label='+', at=(590, 140))
    s.arrow([(545, 175), (545, 320), (638, 320)], 'red', width=3, label='+ in', at=(572, 312))
    # ground
    s.arrow([(240, 345), (600, 345), (600, 375), (638, 375)], 'black', width=3, label='− in', at=(620, 395))
    s.arrow([(600, 345), (600, 205), (638, 205)], 'black', width=3, end=True, label='V−', at=(618, 196))
    # outputs
    s.arrow([(880, 340), (958, 340)], 'teal', width=3, label='5 V', at=(919, 330))
    s.arrow([(880, 165), (958, 165)], 'orange', width=3, label='servo power', at=(919, 155), size=12)
    s.arrow([(1000, 395), (1000, 435), (760, 435), (760, 468)], 'brown', width=3, label='USB', at=(880, 425))
    s.arrow([(880, 500), (958, 486)], 'brown', width=3)
    s.arrow([(880, 550), (958, 574)], 'brown', width=3, dash=True)
    s.box(40, 440, 500, 160, 'Why two supplies?', [
        'When the servos move they pull large current spikes,',
        'which make the battery voltage dip. A Pi on that supply',
        'would restart in the middle of a walk.',
        'Turn the main switch off before touching any wire.'], 'red', fill=C['white'])
    return s


# ------------------------------------------------------------------------------------------ 3
@diagram('software', 'Where the software runs', 'The programs on the Pi and on the Servo 2040, and how they connect.', [
    'Two services start by themselves on the Pi: the driving service and the Wi-Fi manager.',
    'Inside the driving service, main.js connects the parts: controller → drive loop → RobotController → serial link.',
    'On the board, one loop does everything: watchdog, the next movement step, then reading new commands.',
])
def d_software(n):
    s = Svg(1200, 770, n, 'Where the software runs', 'The files in software/pi-service and software/board-files, and how they connect')
    s.rect(30, 100, 700, 640, fill=C['tealbg'], stroke=C['teal'], sw=1.8)
    s.text(48, 128, 'Raspberry Pi Zero 2 W · Linux · software/pi-service', 16, '700', C['teal'])
    s.rect(760, 100, 410, 640, fill=C['purplebg'], stroke=C['purple'], sw=1.8)
    s.text(778, 128, 'Servo 2040 · MicroPython · board-files', 16, '700', C['purple'])
    w = C['white']
    s.box(50, 145, 320, 72, 'hexapod-drive.service', ['Starts at power-on; restarts if it stops'], 'teal', 14, 12, fill=w)
    s.box(390, 145, 320, 72, 'hexapod-wifi.timer (every minute)', ['Joins Wi-Fi or runs the hotspot'], 'teal', 14, 12, fill=w)
    s.box(50, 237, 660, 58, 'src/main.js', ['Starts every part below and connects them'], 'teal', 14, 12, fill=w)
    s.box(50, 320, 200, 100, 'linux-gamepad.js', ['Reads the controller', 'from /dev/input/js0'], 'blue', 14, 12, fill=w)
    s.box(270, 320, 200, 100, 'controls.js', ['Drive loop, every 20 ms', 'Buttons → actions', 'Stick → direction'], 'blue', 14, 12, fill=w)
    s.box(490, 320, 220, 125, 'RobotController', ['vendor/controller/src/robot.js', 'Checks each move first', 'Sends commands', 'Polls the board’s status'], 'teal', 14, 12, fill=w)
    s.box(490, 465, 220, 70, 'node-serial-link.js', ['/dev/serial0 (the UART)'], 'purple', 14, 12, fill=w)
    s.rect(50, 455, 420, 265, fill=w, stroke=C['green'], sw=1.8)
    s.text(64, 480, 'Live View', 15, '700', C['green'])
    s.box(64, 492, 392, 62, 'live-server.js', ['Web server on port 5181; pushes live updates'], 'green', 13, 12, fill=C['greenbg'])
    for i, (name, what) in enumerate([('health.js', 'battery, Pi, servo care'), ('recorder.js', 'sessions, incidents'),
                                      ('insights.js', 'gait scores, battery'), ('classroom.js', 'follow-the-teacher')]):
        x, y = 64 + (i % 2) * 200, 566 + (i // 2) * 52
        s.box(x, y, 192, 44, '', [name, what], 'green', body_size=11, fill=C['white'])
    s.text(64, 690, 'live/ — the page each browser loads', 12, '600', C['green'])
    s.text(64, 708, '(app.js, timeline.js, robot-model.js, …)', 12, fill=C['muted'])
    s.box(490, 560, 220, 160, '~/.hexapod (saved data)', ['Sessions as CSV files', 'Incident replays', 'Servo statistics', 'Gait scores', 'Teacher code'], 'brown', 14, 12, fill=w)
    s.arrow([(250, 370), (268, 370)], 'blue')
    s.arrow([(470, 370), (488, 370)], 'blue')
    s.arrow([(600, 445), (600, 463)], 'purple')
    s.arrow([(490, 430), (470, 430), (470, 445), (300, 445), (300, 490)], 'green', label='state', at=(385, 437), size=11)
    s.arrow([(710, 500), (778, 500)], 'purple', start=True, width=2.6, label='UART', at=(744, 488), size=12)
    s.box(780, 145, 370, 62, 'main.py', ['Starts motion_bridge on USB and UART'], 'purple', 14, 12, fill=w)
    s.box(780, 227, 370, 280, 'motion_bridge.py: one loop, forever', [
        '1. tick()', '    watchdog: 3 s with no message → off',
        '    next step of: Enable glide, walk, or pose', '2. Read the characters waiting on USB and UART',
        '3. Each complete line → handle(op) → reply', '',
        'Commands: arm · pose · walk · walk_stop',
        '    off · status · release_leg · calibration',
        'Events: ready · arrived · timeout · error'], 'purple', 14, 12, fill=w)
    s.box(780, 527, 370, 100, 'FUNCTIONS.py', ['calculate_angles(): inverse kinematics', 'Servo cluster on outputs 1–18', 'Standing height and leg calibration'], 'purple', 14, 12, fill=w)
    s.box(780, 647, 370, 75, 'calibration_store.py', ['calibration_offsets.json · joint_limits.json', '(kept on the board between updates)'], 'purple', 14, 12, fill=w)
    s.arrow([(965, 207), (965, 225)], 'purple')
    s.arrow([(965, 507), (965, 525)], 'purple')
    s.arrow([(965, 627), (965, 645)], 'purple')
    return s


# ------------------------------------------------------------------------------------------ 4
@diagram('command', 'The journey of one command', 'What happens between pushing the stick and the legs moving.', [
    'The Pi checks the whole walk before sending it, using the same maths as the board.',
    'After one "walk" command the board walks on its own, recalculating every leg 50 times a second. The Pi only steers.',
    'The regular "status" question keeps the board’s 3-second watchdog happy and feeds the Live View.',
])
def d_command(n):
    s = Svg(1200, 1030, n, 'The journey of one command', 'From pushing the stick to the legs moving, and back to standing still')
    lanes = [(120, 'You', 'Xbox controller', 'blue'), (355, 'Drive loop', 'controls.js', 'blue'),
             (600, 'RobotController', 'robot.js on the Pi', 'teal'), (850, 'Servo 2040', 'motion_bridge.py', 'purple'),
             (1080, '18 servos', 'hip · upper · lower', 'orange')]
    for x, name, sub, color in lanes:
        s.box(x - 100, 100, 200, 58, name, [sub], color, 15, 12, center=True)
        s.add(f'<line x1="{x}" y1="160" x2="{x}" y2="1010" stroke="{C["line"]}" stroke-width="2" stroke-dasharray="4 6"/>')
    X = {name: x for x, name, _, _ in lanes}

    def msg(a, b, y, label, color, dash=False, mono=False, size=13):
        s.arrow([(X[a] + (6 if X[b] > X[a] else -6), y), (X[b] + (-8 if X[b] > X[a] else 8), y)], color, dash=dash)
        rows = label if isinstance(label, list) else [label]
        s.lines((X[a] + X[b]) / 2, y - 10 - (len(rows) - 1) * 16, rows, size, C[color], anchor='middle', mono=mono, weight='600', gap=16, halo=True)

    def note(lane, y, rows, color='grey', w=210):
        h = 16 + len(rows) * 17
        s.rect(X[lane] + 8, y, w, h, fill=C[color + 'bg'], stroke=C[color], sw=1.2, rx=6)
        s.lines(X[lane] + 18, y + 20, rows, 12, C['ink'], gap=17)

    def step(y, number):
        s.circle(26, y - 5, 12, 'ink')
        s.text(26, y, str(number), 13, '700', C['white'], 'middle')

    step(212, 1); msg('You', 'Drive loop', 212, 'Push the left stick forward', 'blue')
    note('Drive loop', 230, ['Every 20 ms: read the stick,', 'ignore the dead zone (0.18),', 'direction = [1, 0, 0]'])
    step(320, 2); msg('Drive loop', 'RobotController', 320, 'drive([1, 0, 0])', 'blue', mono=True)
    note('RobotController', 338, ['Check the whole walk first:', 'every foot reachable,', 'every joint inside its limits'], 'teal')
    step(445, 3); msg('RobotController', 'Servo 2040', 445, ['{"op": "walk", "gait": "ripple",', '"period_ms": 1429, "lift": 20, …}'], 'purple', mono=True, size=12)
    msg('Servo 2040', 'RobotController', 480, '{"ok": true, "state": …}', 'purple', dash=True, mono=True, size=12)
    note('Servo 2040', 497, ['Every 20 ms, by itself:', 'move the gait clock on,', 'work out 6 foot positions,', 'inverse kinematics → 18 angles'], 'purple')
    step(632, 4); msg('Servo 2040', '18 servos', 632, ['18 pulse widths', 'every 20 ms'], 'orange')
    step(700, 5); msg('RobotController', 'Servo 2040', 700, ['{"op": "status"}  every 200 ms', '(every 650 ms when still)'], 'teal', size=12)
    msg('Servo 2040', 'RobotController', 735, 'positions, angles, battery', 'teal', dash=True, size=12)
    note('RobotController', 752, ['Keeps the 3 s watchdog fed', 'and updates the Live View.', 'Steering: at most one change', 'per 150 ms, if it moved ≥ 0.08'], 'teal')
    step(858, 6); msg('You', 'Drive loop', 858, 'Let go of the stick', 'blue')
    msg('Drive loop', 'RobotController', 890, 'drive([0, 0, 0])', 'blue', mono=True)
    step(935, 7); msg('RobotController', 'Servo 2040', 935, ['after a 300 ms grace period:', '{"op": "walk_stop"}'], 'purple', size=12)
    note('Servo 2040', 948, ['Finishes the step, slows over', 'one cycle, stops in the stance'], 'purple')
    return s


# ------------------------------------------------------------------------------------------ 5
@diagram('states', 'What the robot can be doing', 'The robot’s states and what moves it from one to the next.', [
    'Every power-up starts with the motors off; A (Enable) is always the first button.',
    'Stopping is gentle: the robot finishes its step instead of freezing with a leg in the air.',
    'View and the watchdog are the two ways to cut the motors at once, from any state.',
])
def d_states(n):
    s = Svg(1200, 760, n, 'What the robot can be doing', 'States, and the buttons or events that move the robot between them')
    s.box(40, 130, 220, 92, 'Board starting', ['Servo outputs off', 'Says “ready”'], 'grey')
    s.box(360, 130, 240, 92, 'Connected · motors off', ['Legs limp', 'Pi asks for status'], 'grey')
    s.box(700, 130, 220, 92, 'Enabling', ['Servos on one at a time,', 'then glide home (≈5 s)'], 'teal')
    s.box(700, 330, 220, 92, 'Motors on · still', ['Holding a pose', '(home, stand or sit)'], 'teal')
    s.box(980, 330, 190, 92, 'Stand or sit', ['Smooth 2 s move', 'feet 70 or 30 mm down'], 'teal')
    s.box(700, 530, 220, 92, 'Walking', ['The board runs the gait', 'The Pi steers'], 'orange')
    s.box(360, 530, 240, 92, 'Stopping', ['Finish this step,', 'settle in the stance'], 'orange')
    s.arrow([(260, 176), (358, 176)], 'ink', label=['Pi connects', '(retries every 3 s)'], at=(309, 150), size=12)
    s.arrow([(600, 176), (698, 176)], 'ink', label='A', at=(649, 166), size=15)
    s.arrow([(810, 222), (810, 328)], 'ink', label='arrived', at=(822, 280), anchor='start')
    s.arrow([(920, 360), (978, 360)], 'ink', label='Y / X', at=(949, 350), size=12)
    s.arrow([(978, 400), (922, 400)], 'ink', label='done', at=(950, 418), size=12)
    s.arrow([(790, 422), (790, 528)], 'ink', label='left stick', at=(802, 480), anchor='start')
    s.path('M920,555 L985,555 L985,598 L922,598', 'ink', end=True)
    s.lines(996, 570, ['Menu: blend into the next', 'gait without stopping.', 'D-pad, RB, LB: settings', 'blend in over one step'], 12, C['ink'])
    s.arrow([(698, 576), (602, 576)], 'ink', label='let go, or B', at=(650, 566), size=12)
    s.arrow([(540, 528), (540, 395), (698, 395)], 'ink', label='in the stance', at=(620, 385), size=12)
    s.arrow([(698, 350), (450, 350), (450, 224)], 'red', width=2.6, label=['View, or no message', 'for 3 s (watchdog)'], at=(575, 318), size=12)
    s.box(40, 300, 290, 112, 'Y or X while walking', ['The steps die down while the', 'body settles straight into the', 'standing or sitting pose:', 'one smooth move'], 'grey', 14, 12)
    s.box(40, 650, 1120, 82, 'From any state with the motors on', [
        'View: motors off at once (the robot drops)   ·   Watchdog: no message from the Pi for 3 s → motors off',
        'Controller switched off or lost → walking stops   ·   Service stopping → finishes the step, then the watchdog releases the motors'], 'red', 15, 13)
    return s


# ------------------------------------------------------------------------------------------ 6
@diagram('controller', 'The controller', 'What every stick and button does, and the walk settings they change.', [
    'Pushing the left stick further makes the robot walk faster; letting go stops the walk.',
    'The setting buttons repeat while held, and while walking the board blends each change in.',
    'View is the emergency stop: the motors switch off at once and the body drops.',
])
def d_controller(n):
    s = Svg(1200, 780, n, 'The controller', 'Xbox Wireless Controller over Bluetooth: what each control does')
    body = ('M420,300 C470,262 730,262 780,300 C860,360 905,530 845,568 C800,595 765,545 725,500 '
            'L475,500 C435,545 400,595 355,568 C295,530 340,360 420,300 Z')
    s.rect(430, 262, 110, 22, fill=C['greybg'], stroke=C['grey'], rx=10)
    s.rect(660, 262, 110, 22, fill=C['greybg'], stroke=C['grey'], rx=10)
    s.path(body, 'grey', 2.5, fill=C['greybg'])
    s.circle(470, 360, 34, 'white', 'grey', 2); s.circle(470, 360, 22, 'line')
    s.circle(680, 440, 34, 'white', 'grey', 2); s.circle(680, 440, 22, 'line')
    s.path('M510,430 h20 v-20 h20 v20 h20 v20 h-20 v20 h-20 v-20 h-20 z', 'grey', 2, fill=C['white'])
    for (x, y, label, color) in [(735, 322, 'Y', '#e0a000'), (707, 350, 'X', C['blue']), (763, 350, 'B', C['red']), (735, 378, 'A', C['green'])]:
        s.circle(x, y, 13, color)
        s.text(x, y + 5, label, 14, '700', C['white'], 'middle')
    s.circle(565, 340, 10, 'white', 'grey', 2); s.circle(635, 340, 10, 'white', 'grey', 2)
    s.circle(600, 305, 14, 'white', 'grey', 2)
    s.text(565, 344, '⧉', 10, '700', C['ink'], 'middle'); s.text(635, 344, '≡', 11, '700', C['ink'], 'middle')

    def callout(pts, label_xy, rows, anchor='start', color='ink', size=14):
        s.path('M' + ' L'.join(f'{x},{y}' for x, y in pts), 'grey', 1.4)
        s.circle(*pts[0], 3.5, 'grey')
        x, y = label_xy
        s.text(x, y, rows[0], size, '700', C[color], anchor)
        s.lines(x, y + 19, rows[1:], 13, C['ink'], anchor=anchor)

    callout([(485, 263), (485, 196), (290, 196)], (40, 200), ['LB · lower steps', 'step height −2 mm'])
    callout([(440, 345), (290, 291)], (40, 296), ['Left stick · walk', 'forward, back, sideways;', 'further = faster; let go = stop'])
    callout([(540, 412), (290, 400)], (40, 405), ['D-pad ↑ ↓ · speed', '±0.1 steps per second'])
    callout([(512, 440), (290, 495)], (40, 500), ['D-pad → ← · stride angle', '±2°: longer or shorter steps'])
    callout([(715, 263), (715, 196), (880, 196)], (890, 200), ['RB · higher steps', 'step height +2 mm'])
    callout([(635, 330), (635, 150)], (650, 140), ['Menu · next gait', 'ripple → wave → tripod'])
    callout([(565, 330), (565, 150)], (550, 140), ['View · MOTORS OFF AT ONCE', 'the robot drops: emergency only'], 'end', 'red')
    callout([(735, 309), (880, 272)], (890, 276), ['Y · stand'])
    callout([(776, 350), (880, 312)], (890, 316), ['B · stop walking gently', 'finish the step first'])
    callout([(748, 378), (880, 374)], (890, 378), ['A · enable', 'servos on one by one, glide home'])
    callout([(707, 363), (720, 415), (880, 435)], (890, 440), ['X · sit'])
    callout([(714, 440), (880, 485)], (890, 488), ['Right stick · turn', 'on the spot, or curve'])
    s.box(40, 660, 1120, 92, 'Walk settings', [
        'Defaults: ripple gait · 0.7 steps per second · step height 20 mm · stride angle 15°',
        'Ranges: speed 0.1–2.5 steps/s · step height 0–60 mm · stride angle 2–60°.  Hold a setting button to repeat (after 0.45 s, then every 0.15 s).'], 'teal', 15, 13)
    return s


# ------------------------------------------------------------------------------------------ 7
# From WALK_GAITS in board-files/motion_bridge.py: (fraction of the cycle on the ground, swing start phase per leg)
WALK_GAITS = {
    'tripod': (1 / 2, (0, 1 / 2, 0, 1 / 2, 0, 1 / 2)),
    'ripple': (2 / 3, (2 / 3, 1 / 3, 0, 1 / 6, 5 / 6, 1 / 2)),
    'wave': (5 / 6, (2 / 6, 1 / 6, 0, 5 / 6, 4 / 6, 3 / 6)),
}
LEGS = ('L1', 'L2', 'L3', 'R1', 'R2', 'R3')
LEG_WHERE = ('left front', 'left middle', 'left back', 'right front', 'right middle', 'right back')


@diagram('gaits', 'The three gaits', 'Which legs are in the air at each moment of the walking cycle.', [
    'Each bar is one leg lifting and swinging forward; the rest of the time that foot is pushing on the ground.',
    'Tripod always has 3 feet down (fastest), ripple 4 (smooth, the default), wave 5 (slowest, most stable).',
    'One cycle takes 1 ÷ speed seconds: 1.43 s at the default 0.7 steps per second.',
])
def d_gaits(n):
    s = Svg(1200, 920, n, 'The three gaits', 'When each leg is in the air, over two walking cycles (from WALK_GAITS in motion_bridge.py)')
    # top view of the body, front up (mounts from live/motion-geometry.js)
    cx, cy, k = 170, 330, 1.25
    mounts = [(-58, -70), (-72, 0), (-58, 70), (58, -70), (72, 0), (58, 70)]
    dirs = [(-math.cos(math.radians(30)), -0.5), (-1, 0), (-math.cos(math.radians(30)), 0.5),
            (math.cos(math.radians(30)), -0.5), (1, 0), (math.cos(math.radians(30)), 0.5)]
    s.text(cx, 130, 'Seen from above', 14, '700', C['ink'], 'middle')
    s.arrow([(cx, 205), (cx, 160)], 'teal', label='front', at=(cx + 10, 180), anchor='start', size=12)
    order = [0, 3, 5, 2]
    hexagon = [(cx + mounts[i][0] * k, cy + mounts[i][1] * k) for i in (0, 3, 4, 5, 2, 1)]
    s.add('<polygon points="' + ' '.join(f'{x:.1f},{y:.1f}' for x, y in hexagon) + f'" fill="{C["tealbg"]}" stroke="{C["teal"]}" stroke-width="2"/>')
    for i, ((mx, my), (dx, dy)) in enumerate(zip(mounts, dirs)):
        x0, y0 = cx + mx * k, cy + my * k
        x1, y1 = x0 + dx * 48, y0 + dy * 48
        s.add(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke="{C["ink"]}" stroke-width="5" stroke-linecap="round"/>')
        s.circle(x0, y0, 6, 'red')
        s.circle(x1, y1, 6, 'ink')
        s.text(x1 + dx * 22, y1 + dy * 22 + 5, LEGS[i], 14, '700', C['ink'], 'middle')
    del order
    s.lines(40, 492, ['L = left, R = right', '1 = front, 2 = middle, 3 = back'], 13, C['muted'])
    s.box(40, 560, 270, 150, 'Changing gait', ['Menu blends into the next gait', 'over one cycle without', 'stopping. Tripod ↔ wave goes', 'through ripple, so the body', 'never tips over.'], 'grey', 14, 13)
    s.rect(40, 760, 18, 14, fill=C['orange'], stroke='none', rx=3); s.text(66, 772, 'In the air, swinging forward', 13)
    s.rect(40, 786, 18, 14, fill=C['tealbg'], stroke=C['teal'], rx=3); s.text(66, 798, 'On the ground, pushing back', 13)

    x0, x1 = 400, 1160
    per = (x1 - x0) / 2
    notes = {'tripod': 'Three legs lift together: a stable triangle. Fastest.',
             'ripple': 'A wave down each side; two legs up at a time. Smooth (default).',
             'wave': 'One leg at a time. Slowest and most stable.'}
    down = {'tripod': 3, 'ripple': 4, 'wave': 5}
    for g, (name, (stance, phases)) in enumerate(WALK_GAITS.items()):
        top = 112 + g * 265
        swing = 1 - stance
        s.text(330, top + 18, name.capitalize(), 18, '700', C['ink'])
        s.text(430, top + 18, notes[name], 13, fill=C['muted'])
        for row, phase in enumerate(phases):
            y = top + 32 + row * 27
            s.text(340, y + 16, LEGS[row], 13, '700', C['ink'])
            s.rect(x0, y, x1 - x0, 20, fill=C['tealbg'], stroke=C['teal'], sw=1, rx=3)
            for c in range(-1, 3):
                a, b = max(0, phase + c), min(2, phase + c + swing)
                if b > a:
                    s.rect(x0 + a * per, y + 1, (b - a) * per, 18, fill=C['orange'], stroke='none', rx=3)
        yb = top + 32 + 6 * 27
        for t in range(5):
            x = x0 + t * per / 2
            s.add(f'<line x1="{x}" y1="{top + 30}" x2="{x}" y2="{yb + 4}" stroke="{C["ink"]}" stroke-opacity="{0.35 if t % 2 else 0.15}" stroke-width="1"/>')
            s.text(x, yb + 20, ['0', '½', '1 cycle', '1½', '2 cycles'][t], 12, fill=C['muted'], anchor='middle')
        s.text(x1, top + 18, f'always {down[name]} feet on the ground', 13, '700', C['teal'], 'end')
    return s


# ------------------------------------------------------------------------------------------ 8
def foot_k_up(p, swing):
    """Position along the step (-0.5 back .. +0.5 front) and lift (0..1) at cycle position p (walk_pose)."""
    if p < swing:
        sp = p / swing
        return -0.5 + (1 - math.cos(math.pi * sp)) / 2, math.sin(math.pi * sp)
    return 0.5 - (p - swing) / (1 - swing), 0.0


@diagram('step', 'One foot, one step', 'The path a single foot follows during one walking cycle.', [
    'In the air the foot speeds up and slows down smoothly (a cosine curve); on the ground it moves at a steady speed.',
    'The feet on the ground all push back at the same speed, which carries the body forward.',
    'A walk starts and ends gently: the step grows from nothing over the first cycle and shrinks over the last.',
])
def d_step(n):
    s = Svg(1200, 690, n, 'One foot, one step', 'The path of one foot in the ripple gait (walk_pose in motion_bridge.py)')
    swing = 1 / 3
    gx, gy, half, lift = 300, 430, 210, 150
    s.text(40, 120, 'Side view (height exaggerated)', 15, '700')
    s.add(f'<line x1="60" y1="{gy}" x2="560" y2="{gy}" stroke="{C["brown"]}" stroke-width="3"/>')
    s.text(566, gy + 4, 'ground', 12, fill=C['brown'])
    pts = [foot_k_up(i / 600, swing) for i in range(601)]
    air = [(gx + k * 2 * half, gy - u * lift) for k, u in pts if True][:201]
    s.path('M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in air), 'orange', 3)
    s.add(f'<line x1="{gx + half}" y1="{gy}" x2="{gx - half}" y2="{gy}" stroke="{C["teal"]}" stroke-width="5"/>')
    for i in range(24):
        k, u = foot_k_up(i / 24, swing)
        s.circle(gx + k * 2 * half, gy - u * lift, 5, 'orange' if i / 24 < swing else 'teal', 'white', 1.5)
    s.arrow([(gx + 60, gy + 46), (gx - 60, gy + 46)], 'teal', label='foot pushes back on the ground', at=(gx, gy + 76))
    s.arrow([(gx - 120, gy - lift - 26), (gx + 120, gy - lift - 26)], 'orange', label='foot swings forward in the air', at=(gx, gy - lift - 40))
    s.arrow([(420, 160), (540, 160)], 'ink', width=3, label='robot moves this way', at=(480, 148), size=12)
    s.text(gx - half, gy + 22, 'back', 12, fill=C['muted'], anchor='middle')
    s.text(gx + half, gy + 22, 'front', 12, fill=C['muted'], anchor='middle')
    s.lines(60, 560, ['Dots are 1/24 of a cycle apart: far apart = fast.',
                      'Ripple: 1/3 of the cycle in the air, 2/3 on the ground.'], 13, C['muted'])

    def graph(top, h, label, fn, lo, hi, ticks, label_y=18):
        x0, x1 = 680, 1150
        s.text(x0 - 40, top - 14, label, 15, '700')
        s.rect(x0, top, (x1 - x0) * swing, h, fill=C['orangebg'], stroke='none', rx=0)
        s.add(f'<rect x="{x0}" y="{top}" width="{x1 - x0}" height="{h}" fill="none" stroke="{C["line"]}"/>')
        pts = []
        for i in range(301):
            v = fn(i / 300)
            pts.append((x0 + (x1 - x0) * i / 300, top + h - (v - lo) / (hi - lo) * h))
        s.path('M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts), 'ink', 2.5)
        for v, text in ticks:
            y = top + h - (v - lo) / (hi - lo) * h
            s.text(x0 - 8, y + 4, text, 12, fill=C['muted'], anchor='end')
        for t, text in [(0, '0'), (swing, '⅓'), (1, '1 cycle')]:
            s.text(x0 + (x1 - x0) * t, top + h + 18, text, 12, fill=C['muted'], anchor='middle')
        s.text(x0 + (x1 - x0) * swing / 2, top + label_y, 'in the air', 12, '700', C['orange'], 'middle')
        s.text(x0 + (x1 - x0) * (1 + swing) / 2, top + label_y, 'on the ground', 12, '700', C['teal'], 'middle')

    graph(150, 170, 'Position along the step', lambda p: foot_k_up(p, swing)[0], -0.5, 0.5, [(0.5, 'front'), (0, 'middle'), (-0.5, 'back')])
    graph(400, 120, 'Height of the foot', lambda p: foot_k_up(p, swing)[1], 0, 1, [(1, 'lift'), (0, 'ground')], label_y=100)
    s.box(40, 600, 1120, 70, '', [
        'Step size: with the default 15° stride angle the foot swings ±7.5° around its hip, about 46 mm per step. Step height: 20 mm.',
        'Starting and stopping: the step grows smoothly from zero over the first cycle and shrinks back over the last, so the robot never jerks.'], 'grey', body_size=13)
    return s


# ------------------------------------------------------------------------------------------ 9
L1, L2, L3 = 47, 88.46, 148.8   # leg lengths in mm, from calculate_angles() in FUNCTIONS.py


def ik(x, y, z):
    a = math.hypot(x, y)
    b = math.hypot(a - L1, z)
    theta1 = math.degrees(math.atan2(y, x))
    beta = math.degrees(math.acos((L2 ** 2 + b ** 2 - L3 ** 2) / (2 * L2 * b)))
    eps = math.degrees(math.atan2(a - L1, z))
    sigma3 = math.degrees(math.acos((L2 ** 2 + L3 ** 2 - b ** 2) / (2 * L2 * L3)))
    return {'A': a, 'B': b, 'beta': beta, 'eps': eps, 'S1': 90 - theta1, 'S2': beta - (90 - eps), 'S3': 180 - sigma3, 'sigma3': sigma3}


@diagram('leg', 'One leg: inverse kinematics', 'How the board turns “put this foot here” into three servo angles.', [
    'The gait only says where each foot should be (x, y, z in mm). Inverse kinematics finds the joint angles that put it there.',
    'The hip angle comes from the top view; the other two come from one triangle in the side view (the law of cosines).',
    'A foot that cannot be reached, or an angle outside a joint’s limits, is refused with an error rather than attempted.',
])
def d_leg(n):
    s = Svg(1200, 820, n, 'One leg: inverse kinematics', 'From a foot position to three servo angles (calculate_angles in FUNCTIONS.py)')
    fx, fy, fz = 0, 175, 70     # the home stance foot (HOME in motion_bridge.py)
    r = ik(fx, fy, fz)
    k, ox, oy = 2.35, 110, 330
    P = lambda a, z: (ox + a * k, oy + z * k)   # a: out from the hip axis, z: down
    hip, knee0, foot = P(0, 0), P(L1, 0), P(r['A'], fz)
    s2 = math.radians(r['S2'])
    knee = (knee0[0] + L2 * k * math.cos(s2), knee0[1] - L2 * k * math.sin(s2))
    s.text(40, 120, 'Side view, to scale (home stance: foot 175 mm out, 70 mm down)', 15, '700')
    s.rect(30, oy - 70, 70, 100, fill=C['tealbg'], stroke=C['teal'], rx=8)
    s.text(65, oy + 50, 'body', 12, fill=C['teal'], anchor='middle')
    s.add(f'<line x1="{ox}" y1="{oy - 90}" x2="{ox}" y2="{foot[1] + 20}" stroke="{C["grey"]}" stroke-dasharray="4 5"/>')
    s.text(ox, oy - 96, 'hip axis', 12, fill=C['muted'], anchor='middle')
    s.add(f'<line x1="{knee0[0]:.1f}" y1="{knee0[1]:.1f}" x2="{foot[0]:.1f}" y2="{foot[1]:.1f}" stroke="{C["blue"]}" stroke-width="1.8" stroke-dasharray="6 5"/>')
    s.add(f'<line x1="40" y1="{foot[1] + 8:.1f}" x2="560" y2="{foot[1] + 8:.1f}" stroke="{C["brown"]}" stroke-width="3"/>')
    for (a, b, color, label) in [(hip, knee0, 'red', f'L1 = {L1}'), (knee0, knee, 'black', f'L2 = {L2}'), (knee, foot, 'black', f'L3 = {L3}')]:
        s.add(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{C[color]}" stroke-width="9" stroke-linecap="round"/>')
    s.circle(*hip, 9, 'red', 'white', 2); s.circle(*knee0, 9, 'red', 'white', 2); s.circle(*knee, 9, 'black', 'white', 2)
    s.circle(*foot, 8, 'red', 'white', 2)
    s.text(hip[0] + 55, hip[1] + 26, 'L1 = 47', 13, '700', C['red'], 'middle', halo=True)
    s.text((knee0[0] + knee[0]) / 2 - 16, (knee0[1] + knee[1]) / 2 - 6, 'L2 = 88.46', 13, '700', C['ink'], 'end', halo=True)
    s.text((knee[0] + foot[0]) / 2 + 16, (knee[1] + foot[1]) / 2 - 4, 'L3 = 148.8', 13, '700', C['ink'], 'start', halo=True)
    s.text((knee0[0] + foot[0]) / 2 - 8, (knee0[1] + foot[1]) / 2 + 26, 'B', 15, '700', C['blue'], 'end', halo=True)
    s.text(knee0[0] - 12, knee0[1] - 16, 'upper leg servo (S2)', 12, '600', C['red'], 'end', halo=True)
    s.text(hip[0] + 4, hip[1] - 52, 'hip servo (S1)', 12, '600', C['red'], 'start', halo=True)
    s.text(knee[0] + 14, knee[1] - 10, 'lower leg servo (S3)', 12, '600', C['ink'], 'start', halo=True)
    s.text(foot[0] + 12, foot[1] - 6, 'foot', 12, '600', C['red'], 'start')
    ya = foot[1] + 44
    s.arrow([(ox, ya), (foot[0], ya)], 'teal', start=True, width=1.6, label='A = 175 mm out from the hip axis', at=((ox + foot[0]) / 2, ya + 22), size=12)
    s.arrow([(foot[0] + 70, oy), (foot[0] + 70, foot[1])], 'teal', start=True, width=1.6, label='z = 70 mm', at=(foot[0] + 80, oy + 90), anchor='start', size=12)
    s.add(f'<line x1="{knee0[0]:.1f}" y1="{oy}" x2="{foot[0] + 76}" y2="{oy}" stroke="{C["grey"]}" stroke-dasharray="3 5"/>')

    # top view
    tx, ty, tk = 760, 250, 1.2
    s.text(640, 120, 'Top view: the hip servo (S1)', 15, '700')
    wx, wy = 22.8, 173.5    # a foot mid-swing: 7.5° round the hip
    t1 = ik(wx, wy, fz)['S1']
    end = (tx + wy * tk, ty - wx * tk)
    s.rect(tx - 60, ty - 40, 40, 80, fill=C['tealbg'], stroke=C['teal'], rx=6)
    s.add(f'<line x1="{tx}" y1="{ty}" x2="{tx + 175 * tk + 20}" y2="{ty}" stroke="{C["grey"]}" stroke-dasharray="4 5"/>')
    s.text(tx + 175 * tk + 26, ty + 4, 'y: out', 12, fill=C['muted'])
    s.add(f'<line x1="{tx}" y1="{ty + 50}" x2="{tx}" y2="{ty - 70}" stroke="{C["grey"]}" stroke-dasharray="4 5"/>')
    s.text(tx, ty - 76, 'x: across the leg', 12, fill=C['muted'], anchor='middle')
    s.add(f'<line x1="{tx}" y1="{ty}" x2="{end[0]:.1f}" y2="{end[1]:.1f}" stroke="{C["ink"]}" stroke-width="7" stroke-linecap="round"/>')
    s.circle(tx, ty, 8, 'red', 'white', 2); s.circle(*end, 7, 'red', 'white', 2)
    ar = 70
    a1 = math.atan2(-(end[1] - ty), end[0] - tx)
    s.path(f'M{tx + ar},{ty} A{ar},{ar} 0 0,0 {tx + ar * math.cos(a1):.1f},{ty - ar * math.sin(a1):.1f}', 'red', 2)
    s.text(tx + ar + 6, ty + 22, f'S1 = {t1:.1f}°', 13, '700', C['red'])
    s.lines(640, 360, ['S1 = 90° − atan2(y, x)', 'The hip turns the whole leg sideways;', f'here the foot is {wx} mm across (mid-step).'], 13, C['ink'])

    s.box(640, 455, 520, 215, 'The side-view triangle', [
        'A = √(x² + y²)              out from the hip axis',
        'B = √((A − L1)² + z²)       upper-leg joint to foot',
        'β = acos((L2² + B² − L3²) ÷ (2·L2·B))',
        'ε = atan2(A − L1, z)',
        'S2 = β − (90° − ε)           upper leg',
        'S3 = 180° − acos((L2² + L3² − B²) ÷ (2·L2·L3))',
        '',
        f'Home stance: S1 = {r["S1"]:.1f}°,  S2 = {r["S2"]:.1f}°,  S3 = {r["S3"]:.1f}°'], 'blue', 15, 13, mono_body=True)
    steps = ['foot x, y, z (mm)', 'inverse kinematics', 'right side: mirror', 'lower leg: −90°', '+ calibration offset', 'joint-limit check', 'servo pulse']
    w, gap, y = 148, 13, 730
    for i, label in enumerate(steps):
        x = 40 + i * (w + gap)
        color = 'red' if 'check' in label else 'purple'
        s.box(x, y, w, 50, '', [label], color, body_size=12, center=True)
        if i:
            s.arrow([(x - gap + 1, y + 25), (x - 1, y + 25)], 'purple', width=1.6)
    s.text(40, 805, 'On the board for every leg, every 20 ms (leg_angles in motion_bridge.py). Unreachable or out-of-limit: the move is refused with an error.', 12, fill=C['muted'])
    return s


# ------------------------------------------------------------------------------------------ 10
@diagram('safety', 'Layers of safety', 'Every check between the controller and the motors, and where it runs.', [
    'Moves are checked twice: on the Pi before sending, and again on the board before moving.',
    'If anything goes quiet (the controller, the Pi, the Wi-Fi), the robot stops rather than carrying on.',
    'The Live View is kept away from driving: a fault in the web page cannot stop or steer the robot.',
])
def d_safety(n):
    s = Svg(1200, 800, n, 'Layers of safety', 'From the controller to the motors: what is checked, and where')
    rows = [
        ('Controller', 'blue', 'Pi', 'Stick dead zone 0.18 (worn sticks rest at 0.1–0.15). Let go of both sticks → the walk stops.',
         'Controller switched off, battery flat or out of range → drive input drops to zero.'),
        ('Check before sending', 'teal', 'Pi', 'Every walk, stand and sit is checked with the same maths as the board:',
         'each foot reachable, each joint inside its limits. A failing setting is refused; the old one is kept.'),
        ('Check before moving', 'purple', 'Servo 2040', 'Every pose: feet inside the ±284 mm workspace, reachable, joints inside their limits.',
         'Every servo value is read back; more than 0.5° off → outputs off and an error.'),
        ('Watchdog', 'purple', 'Servo 2040', 'No message from the Pi for 3 s → motors off. The Pi asks for status every 200 ms',
         'while moving and every 650 ms when still, so this only fires if the Pi or its program stops.'),
        ('Emergency stop', 'red', 'Controller', 'View: the board stops sending pulses at once. The legs go limp and the body drops,',
         'so support the robot when testing.'),
        ('Gentle stops', 'orange', 'Pi + board', 'B, letting go, Stand or Sit while walking, and stopping the service all finish the current step',
         'first, so no leg is left in the air.'),
        ('Web page kept apart', 'green', 'Pi', 'The Live View only watches. Every part of it is guarded: an error there is logged, never passed on.',
         'Slow viewers are dropped so they cannot fill the Pi’s memory. Teacher actions need a code.'),
        ('No current surges', 'brown', 'Servo 2040', 'Outputs start off. Enable switches the 18 servos on one at a time, 200 ms apart, then glides home.',
         'No move may turn a joint faster than 180°/s. A board restart is logged. The Pi has its own 5 V supply.'),
    ]
    for i, (name, color, where, line1, line2) in enumerate(rows):
        y = 105 + i * 85
        s.rect(40, y, 1120, 72, fill=C[color + 'bg'], stroke=C[color], sw=1.5)
        s.circle(72, y + 36, 16, color)
        s.text(72, y + 41, str(i + 1), 14, '700', C['white'], 'middle')
        s.text(100, y + 30, name, 16, '700', C[color])
        s.chip(100, y + 42, where, color, 11)
        s.text(330, y + 30, line1, 13)
        s.text(330, y + 52, line2, 13)
    return s


# ------------------------------------------------------------------------------------------ 11
@diagram('wifi', 'Wi-Fi: joined or hotspot', 'How the robot stays reachable with or without a network.', [
    'At work the Pi joins Robocop like any laptop; elsewhere it becomes its own Wi-Fi network after about 75 seconds.',
    'The Pi has one Wi-Fi radio, so it is either joined or a hotspot, never both.',
    'On the hotspot the Pi is always at 10.42.0.1, so the Live View address never changes there.',
])
def d_wifi(n):
    s = Svg(1200, 700, n, 'Wi-Fi: joined or hotspot', 'deploy/wifi/hexapod-wifi, run by a timer every minute (first check 45 s after power-on)')
    s.box(40, 150, 260, 110, 'Power on', ['NetworkManager tries the', 'saved networks (Robocop)'], 'grey')
    s.box(450, 120, 300, 130, 'Station mode', ['Joined Robocop', 'Address from the router,', 'e.g. 10.52.126.57'], 'green')
    s.box(450, 360, 300, 120, 'Not connected', ['Waiting: NetworkManager', 'keeps trying for 30 s'], 'grey')
    s.box(880, 340, 280, 160, 'Hotspot mode', ['The robot’s own network:', 'Hexapod-XXXX', 'The Pi is always 10.42.0.1', 'Live View:', 'http://10.42.0.1:5181'], 'orange')
    s.arrow([(300, 190), (448, 190)], 'green', label='connected', at=(374, 180))
    s.arrow([(170, 260), (170, 420), (448, 420)], 'ink', label='none in range', at=(300, 410))
    s.arrow([(750, 420), (878, 420)], 'orange', label=['still nothing', '(≈75 s after', 'power-on)'], at=(814, 368), size=12)
    s.arrow([(1020, 340), (1020, 185), (752, 185)], 'green', label=['every 10 min, if no device is', 'connected: try saved networks'], at=(1008, 260), anchor='end', size=12)
    s.arrow([(560, 250), (560, 358)], 'ink', label='network lost', at=(572, 310), anchor='start', size=12)
    s.box(40, 540, 1120, 118, 'Choosing the mode (on the Pi)', [
        'sudo hexapod-wifi auto        joined if possible, otherwise hotspot (default)',
        'sudo hexapod-wifi hotspot     always the hotspot: a classroom with no network',
        'sudo hexapod-wifi station     never the hotspot · reconnect · test-hotspot 5 (hotspot for 5 minutes)'], 'teal', 15, 13, mono_body=True)
    return s


# ------------------------------------------------------------------------------------------ 12
@diagram('liveview', 'How the Live View works', 'From the robot to every browser, and how the page draws smooth motion.', [
    'The Pi pushes updates down one long-lived connection per browser (Server-Sent Events); browsers never ask the robot to do anything.',
    'Updates are limited (robot 10 per second, controller 20) so 40 viewers do not slow the robot down.',
    'The page draws a quarter of a second in the past, so it always has the next position to glide towards: smooth motion, pause and replay.',
])
def d_liveview(n):
    s = Svg(1200, 760, n, 'How the Live View works', 'src/live-server.js on the Pi, live/app.js in each browser')
    s.rect(40, 105, 520, 620, fill=C['tealbg'], stroke=C['teal'], sw=1.8)
    s.text(58, 133, 'On the Pi: live-server.js', 16, '700', C['teal'])
    ins = [('Robot state', 'every change', 'at most 10 per second', 'robot'),
           ('Controller', 'every 20 ms', 'at most 20 per second, changes only', 'pad'),
           ('Board messages', 'every command and reply', 'batched 4 times a second', 'msgs'),
           ('Button actions', 'A, Y, Menu…', 'straight away', 'action'),
           ('Health, sessions', 'Pi sensors, recorder', 'every 2–5 seconds', 'health'),
           ('Classroom', 'teacher’s page, answers', 'when they change', 'follow')]
    for i, (name, src, rate, event) in enumerate(ins):
        y = 155 + i * 70
        s.box(58, y, 200, 58, name, [src], 'teal', 14, 12, fill=C['white'])
        s.arrow([(260, y + 29), (300, y + 29)], 'teal', width=1.8)
        s.box(302, y, 240, 58, '', [rate, f'event: {event}'], 'grey', body_size=12, fill=C['white'])
    s.box(58, 585, 484, 120, 'When a browser connects: “hello”', [
        'Everything so far, at once: the robot, the controller,', 'the last 30 log lines, 10 minutes of battery,',
        'the last 60 board messages, health and the teacher’s page.'], 'green', 14, 12, fill=C['white'])
    s.arrow([(562, 380), (638, 380)], 'green', width=4, label=['GET', '/events'], at=(600, 344), size=12)
    s.lines(600, 408, ['one per', 'browser'], 12, C['green'], anchor='middle', weight='600')
    s.rect(640, 105, 520, 620, fill=C['greenbg'], stroke=C['green'], sw=1.8)
    s.text(658, 133, 'In each browser: live/app.js', 16, '700', C['green'])
    s.box(658, 155, 484, 95, 'Timeline: the last 25 seconds', ['Every robot update is kept with the time it arrived.', 'Pause, ½× and ¼× slow motion, and 20 s replay', 'simply move the playhead back along it.'], 'green', 14, 12, fill=C['white'])
    # mini timeline
    y, x0, x1 = 330, 680, 1120
    s.text(658, 290, 'Drawing 260 ms behind the newest update', 14, '700', C['ink'])
    s.add(f'<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{C["ink"]}" stroke-width="2"/>')
    for i in range(9):
        s.circle(x0 + 20 + i * 50, y, 6, 'teal')
    newest = x0 + 20 + 8 * 50
    play = newest - 2.6 * 50
    s.add(f'<line x1="{play}" y1="{y - 26}" x2="{play}" y2="{y + 26}" stroke="{C["red"]}" stroke-width="3"/>')
    s.text(play, y + 44, 'drawn now', 12, '700', C['red'], 'middle')
    s.text(newest, y + 44, 'newest', 12, '700', C['teal'], 'middle')
    s.text(x0, y - 16, 'updates, 100 ms apart', 12, fill=C['muted'])
    s.lines(658, 410, ['There is always a next update to glide towards, so', '10 updates a second become smooth 60 fps motion.'], 13)
    s.box(658, 470, 484, 115, 'Pages read the same data', ['Live (3D, gait chart, battery) · Controller · How it works', 'Servo angles · Health · Servo care · Sessions · Messages', 'Only what is visible and has changed is redrawn,', 'so an idle robot costs a phone almost nothing.'], 'green', 14, 12, fill=C['white'])
    s.box(658, 600, 484, 105, 'The only things a browser sends', ['Teacher: log in with the code, then lead the class', 'Students: anonymous quick-question answers', 'Small, rate-limited, and never robot commands.'], 'orange', 14, 12, fill=C['white'])
    return s


# ------------------------------------------------------------------------------------------ page
PAGE = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hexapod Robot Overview</title>
<style>
:root { --bg: #f4f7f8; --card: #ffffff; --ink: #1a2b30; --muted: #5f6f75; --line: #d6dee1; --accent: #0d7a69; --accent-soft: #e3f2ef; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #10181b; --card: #172226; --ink: #e6eef0; --muted: #9db0b5; --line: #2a3a3f; --accent: #4fc3ad; --accent-soft: #173a35; } }
:root[data-theme="dark"] { --bg: #10181b; --card: #172226; --ink: #e6eef0; --muted: #9db0b5; --line: #2a3a3f; --accent: #4fc3ad; --accent-soft: #173a35; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 16px; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.layout { display: grid; grid-template-columns: 270px minmax(0, 1fr); max-width: 1500px; margin: 0 auto; }
nav { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 28px 18px 28px 24px; border-right: 1px solid var(--line); }
nav h1 { font-size: 18px; margin: 0 0 4px; }
nav p { margin: 0 0 18px; color: var(--muted); font-size: 13px; }
nav ol { list-style: none; margin: 0; padding: 0; counter-reset: d; }
nav li a { display: flex; gap: 10px; padding: 7px 10px; border-radius: 8px; color: var(--ink); text-decoration: none; font-size: 14px; }
nav li a span { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 1.4em; }
nav li a:hover { background: var(--accent-soft); }
nav li a.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
nav li a.on span { color: var(--accent); }
.keys { margin-top: 18px; color: var(--muted); font-size: 12px; }
kbd { border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; font: 12px ui-monospace, Menlo, monospace; }
main { padding: 32px 40px 80px; min-width: 0; }
.intro { max-width: 860px; margin-bottom: 36px; }
.intro h2 { font-size: 30px; margin: 0 0 8px; }
.intro p { margin: 0; color: var(--muted); }
section { margin: 0 0 56px; }
.head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
.num { color: var(--accent); font-weight: 700; font-variant-numeric: tabular-nums; }
section h3 { font-size: 22px; margin: 0; }
.summary { color: var(--muted); margin: 0 0 14px; }
figure { margin: 0; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
figure img { display: block; width: 100%; height: auto; }
.notice { margin: 14px 0 0; padding: 14px 18px 14px 20px; background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 10px; }
.notice b { display: block; font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--accent); margin-bottom: 4px; }
.notice ul { margin: 0; padding-left: 20px; }
.notice li + li { margin-top: 3px; }
.tools { display: flex; gap: 14px; margin-top: 10px; font-size: 14px; }
.tools a { color: var(--accent); }
.theme { margin-top: 14px; background: none; border: 1px solid var(--line); color: var(--ink); border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 13px; cursor: pointer; }
@media (max-width: 900px) {
  .layout { display: block; }
  nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); padding: 20px 16px; }
  nav ol { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
  .keys { display: none; }
  main { padding: 24px 16px 60px; }
  .intro h2 { font-size: 24px; }
  figure { overflow-x: auto; }
  figure img { min-width: 640px; }
}
</style>
</head>
<body>
<div class="layout">
<nav aria-label="Diagrams">
  <h1>Hexapod overview</h1>
  <p>How the robot behaves, in __COUNT__ diagrams</p>
  <ol>
__NAV__
  </ol>
  <div class="keys"><kbd>J</kbd> / <kbd>K</kbd> or <kbd>↓</kbd> / <kbd>↑</kbd>: next / previous diagram</div>
  <button class="theme" type="button" id="theme">Switch light / dark</button>
</nav>
<main>
  <div class="intro">
    <h2>How the hexapod works</h2>
    <p>Start at the top for the big picture, then follow a command through the robot, its states and controls,
    the way it walks, and what keeps it safe. Each diagram is a separate SVG file in this folder; open one
    on its own to zoom in.</p>
  </div>
__SECTIONS__
</main>
</div>
<script>
const sections = [...document.querySelectorAll('main section')];
const links = new Map([...document.querySelectorAll('nav a')].map(a => [a.getAttribute('href').slice(1), a]));
const seen = new Set();
const io = new IntersectionObserver(entries => {
  for (const e of entries) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
  const current = sections.find(s => seen.has(s.id));
  if (current) for (const [id, a] of links) a.classList.toggle('on', id === current.id);
}, {rootMargin: '-35% 0px -55% 0px'});
sections.forEach(s => io.observe(s));
// The diagram at the top of the window (-1: still on the introduction).
const current = () => sections.reduce((at, s, i) => (s.getBoundingClientRect().top <= 60 ? i : at), -1);
let target = null, settle = null; // while a smooth scroll runs, more presses count on from its target
function go(step) {
  target = Math.max(0, Math.min(sections.length - 1, (target ?? current()) + step));
  sections[target].scrollIntoView();
  clearTimeout(settle); settle = setTimeout(() => { target = null; }, 900);
}
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea/i.test(e.target.tagName)) return;
  if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); go(1); }
  if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); go(-1); }
});
const root = document.documentElement;
try { const t = localStorage.getItem('hexapod-overview-theme'); if (t) root.dataset.theme = t; } catch {}
document.getElementById('theme').addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('hexapod-overview-theme', root.dataset.theme); } catch {}
});
</script>
</body>
</html>
'''


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else '..')
    nav, sections = [], []
    for i, d in enumerate(DIAGRAMS, 1):
        name = f'{i:02d}-{d["slug"]}.svg'
        (out / name).write_text(d['make'](i).render(), encoding='utf-8')
        sid = d['slug']
        nav.append(f'    <li><a href="#{sid}"><span>{i}</span>{esc(d["title"])}</a></li>')
        notice = ''.join(f'<li>{esc(t)}</li>' for t in d['notice'])
        sections.append(f'''  <section id="{sid}">
    <div class="head"><span class="num">{i}</span><h3>{esc(d["title"])}</h3></div>
    <p class="summary">{esc(d["summary"])}</p>
    <figure><img src="{name}" alt="Diagram {i}: {esc(d["title"])}" loading="lazy"></figure>
    <div class="notice"><b>What to notice</b><ul>{notice}</ul></div>
    <div class="tools"><a href="{name}" target="_blank" rel="noopener">Open {name} on its own</a></div>
  </section>''')
        print('wrote', name)
    page = (PAGE.replace('__COUNT__', str(len(DIAGRAMS))).replace('__NAV__', '\n'.join(nav)).replace('__SECTIONS__', '\n'.join(sections)))
    (out / 'index.html').write_text(page, encoding='utf-8')
    print('wrote index.html')


if __name__ == '__main__':
    main()
