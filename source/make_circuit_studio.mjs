// Builds the wiring schematic as a Circuit Studio project (https://circuit-studio.pages.dev/):
// a project file to open with Open, and a share link that opens it directly.
// Usage: node make_circuit_studio.mjs <output folder>
// Parts the studio does not have (Servo 2040, LiDAR, buck converter, battery, hub) travel inside
// the file as custom parts, which the studio registers when the project opens.
import {writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {deflateRawSync} from 'node:zlib';

const SITE = 'https://circuit-studio.pages.dev/';
const out = process.argv[2];
if (!out) { console.error('Usage: node make_circuit_studio.mjs <output folder>'); process.exit(1); }

// ---------- custom parts ----------
// pins: [id, label shown on the symbol, full name, role]
function part(id, name, category, labelPrefix, description, pins, colour) {
  const widthMm = 40, heightMm = Math.max(20, pins.length * 2.54 + 8);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthMm} ${heightMm}">` +
    `<rect x="0.5" y="0.5" width="${widthMm - 1}" height="${heightMm - 1}" rx="2" fill="${colour}" stroke="#1e293b" stroke-width="0.6"/>` +
    `<text x="${widthMm / 2}" y="5" font-size="3" text-anchor="middle" fill="#fff" font-family="sans-serif">${name.replace(/[<&>]/g, '')}</text></svg>`;
  return {
    format: 'circuit-studio-component', id: `custom-${id}`, name, category, labelPrefix, description, mount: 'wires', widthMm, heightMm,
    pins: pins.map(([pid, label, full, role], i) => ({id: pid, label, name: full, role, x: 2.54, y: 8 + i * 2.54})),
    svg,
  };
}

const PARTS = {
  battery: part('hexapod-battery', 'Battery pack', 'Custom', 'BT',
    'Servo supply at the voltage the servos are rated for. Its − is the common ground for the whole robot.',
    [['POS', 'BAT +', 'Battery +', 'passive'], ['NEG', 'BAT −', 'Battery − (common ground)', 'gnd']], '#b91c1c'),
  switch: part('hexapod-switch', 'Main switch + fuse', 'Custom', 'SW',
    'Main switch and fuse, on the battery + wire only.',
    [['IN', 'IN', 'From battery +', 'passive'], ['OUT', 'OUT', 'Switched + (servo power)', 'passive']], '#b91c1c'),
  buck: part('hexapod-buck', '5 V buck converter, 3 A', 'Custom', 'PS',
    'Steps the battery down to 5 V for the Pi, the USB hub, the LiDAR and the Servo 2040 logic. 3 A or more.',
    [['INP', 'IN +', 'Input + (switched battery)', 'passive'], ['INN', 'IN −', 'Input −', 'gnd'],
     ['OUTP', 'OUT + 5V', 'Output + 5 V (to Pi PWR IN)', 'passive'], ['OUTN', 'OUT −', 'Output − (GND)', 'gnd']], '#c2410c'),
  servo2040: part('hexapod-servo2040', 'Pimoroni Servo 2040', 'Custom', 'U',
    'RP2040 servo controller running motion_bridge.py. UART1 on the Qw/ST connector: SDA = GP20 (TX), SCL = GP21 (RX). Logic powered from its USB-C port.',
    [['GND', 'GND', 'Qw/ST GND', 'gnd'], ['SCL', 'SCL GP21 RX', 'Qw/ST SCL = GP21, UART RX', 'gpio-in'], ['SDA', 'SDA GP20 TX', 'Qw/ST SDA = GP20, UART TX', 'gpio-out'],
     ['V3', '3V3 (NC)', 'Qw/ST 3V3, not connected', 'nc'],
     ...Array.from({length: 18}, (_, i) => [`S${i + 1}`, `Servo ${i + 1}`, `Servo output ${i + 1} (signal)`, 'passive']),
     ['USB5V', 'USB-C 5V', 'USB-C VBUS (logic power)', 'vcc'], ['USBGND', 'USB-C GND', 'USB-C ground', 'gnd'],
     ['VP', 'V+ servo', 'Servo power terminal V+', 'passive'], ['VM', 'V− servo', 'Servo power terminal V−', 'gnd']], '#5b21b6'),
  servo: part('hexapod-servo', 'Leg servo', 'Motors & actuators', 'M',
    'One of the 18 leg servos. Plugs into a Servo 2040 output, which carries its signal, V+ and GND.',
    [['SIG', 'SIG', 'Signal from the Servo 2040', 'passive'], ['VP', 'V+', 'Servo power + (V_SERVO)', 'passive'], ['GND', 'GND', 'Ground', 'gnd']], '#7c3aed'),
  hub: part('hexapod-usb-hub', 'USB hub (micro-USB OTG)', 'Custom', 'HUB',
    'Plugs into the Pi’s inner USB port (not PWR IN). Port 1: Servo 2040 logic power. Port 2: LiDAR USB adapter.',
    [['IN5V', 'IN VBUS', 'From the Pi USB port: 5 V', 'vcc'], ['INGND', 'IN GND', 'From the Pi USB port: GND', 'gnd'],
     ['P15V', 'P1 VBUS', 'Port 1: 5 V', 'passive'], ['P1GND', 'P1 GND', 'Port 1: GND', 'gnd'],
     ['P25V', 'P2 VBUS', 'Port 2: 5 V', 'passive'], ['P2GND', 'P2 GND', 'Port 2: GND', 'gnd'], ['P2D', 'P2 D+/D−', 'Port 2: data', 'passive']], '#6d4c41'),
  adapter: part('hexapod-lidar-usb', 'RPLIDAR USB adapter', 'Custom', 'UA',
    'USB-to-serial adapter board supplied with the RPLIDAR C1. Gives the LiDAR 5 V and turns its 460 800 baud serial link into USB.',
    [['U5V', 'USB VBUS', 'USB 5 V in', 'vcc'], ['UGND', 'USB GND', 'USB GND', 'gnd'], ['UD', 'USB D+/D−', 'USB data', 'passive'],
     ['L5V', '5V', 'To LiDAR VCC', 'passive'], ['LGND', 'GND', 'To LiDAR GND', 'gnd'], ['LRX', 'RX', 'Adapter RX (from LiDAR TX)', 'passive'], ['LTX', 'TX', 'Adapter TX (to LiDAR RX)', 'passive']], '#00838f'),
  lidar: part('hexapod-rplidar-c1', 'RPLIDAR C1 (planned)', 'Sensors', 'LD',
    'Slamtec RPLIDAR C1: 360° DTOF laser range scanner, 12 m, IP54. 5 V about 230 mA. UART 460 800 baud, 3.3 V logic. Check the pinout on the Slamtec datasheet.',
    [['VCC', 'VCC 5V', 'Power 5 V', 'vcc'], ['GND', 'GND', 'Ground', 'gnd'], ['TX', 'TX', 'Serial out (3.3 V)', 'passive'], ['RX', 'RX', 'Serial in (3.3 V)', 'passive'],
     ['MOTO', 'MOTOCTL (NC)', 'Motor speed control: leave unconnected', 'nc']], '#00838f'),
};

// ---------- the circuit ----------
const components = [], wires = [], notes = [];
let n = 0;
const comp = (id, type, x, y, label, extra = {}) => { components.push({id, type, x, y, rot: 0, label, props: {}, ...extra}); return id; };
const net = (name, x, y, rot = 0) => comp(`NL${++n}`, 'netlabel', x, y, name, {props: {net: name}, rot});
const gnd = (x, y) => comp(`G${++n}`, 'gnd', x, y, 'GND');
const v5 = (x, y) => comp(`V${++n}`, 'vcc5v', x, y, '5V');
const wire = (a, ap, b, bp, label = '', color) => wires.push({id: `w${wires.length + 1}`, a: {c: a, p: ap}, b: {c: b, p: bp}, label, mid: null, ...(color ? {color} : {})});
const RED = '#dc2626', BLACK = '#111827', ORANGE = '#ea580c', BLUE = '#2563eb', GREEN = '#16a34a', BROWN = '#6d4c41', TEAL = '#0e7490';

// A net label turned round (rot 180) has its pin on the right: put that pin 20 px left of (px, py).
const netLeft = (name, px, py) => net(name, px - 130, py - 10, 180);
const S2040_Y = 60, pinY = i => S2040_Y + 20 * (i + 1); // custom symbols: pin i at x = 0, y = 20 (i + 1)

// Raspberry Pi Zero 2 W (the studio's own board)
comp('U1', 'board', 620, 60, 'PI ZERO 2 W', {boardId: 'pi-zero-2w'});

// Servo 2040, to the right of the Pi: UART straight across, crossed TX/RX
comp('U2', PARTS.servo2040.id, 1180, 60, 'SERVO2040');
wire('U1', 'GPIO14', 'U2', 'SCL', 'TX → RX', BLUE);
wire('U1', 'GPIO15', 'U2', 'SDA', 'RX ← TX', GREEN);
wire('U1', 'GND6', 'U2', 'GND', 'GND', BLACK);

// Power: battery -> switch -> V_SERVO; buck converter -> 5 V for the Pi (PWR IN)
comp('BT1', PARTS.battery.id, 40, 80, 'BATTERY');
comp('SW1', PARTS.switch.id, 260, 60, 'SWITCH');
comp('PS1', PARTS.buck.id, 260, 260, 'BUCK5V');
wire('BT1', 'POS', 'SW1', 'IN', '', RED);
wire('BT1', 'NEG', gnd(80, 180), 'P', '', BLACK);
wire('SW1', 'OUT', net('V_SERVO', 480, 60), 'P', '', RED);
wire('PS1', 'INP', net('V_SERVO', 480, 260), 'P', '', RED);
wire('PS1', 'INN', gnd(220, 380), 'P', '', BLACK);
wire('PS1', 'OUTP', v5(480, 300), 'P', 'PWR IN micro-USB', ORANGE);
wire('PS1', 'OUTN', gnd(480, 400), 'P', '', BLACK);
wire('U2', 'VP', netLeft('V_SERVO', 1180, pinY(24)), 'P', '', RED);
wire('U2', 'VM', gnd(1100, 640), 'P', '', BLACK);

// USB hub on the Pi's USB port. Every VBUS is the Pi's 5 V rail (5V symbol) and every GND the common ground.
comp('HUB1', PARTS.hub.id, 260, 520, 'USBHUB');
wire('HUB1', 'IN5V', v5(120, 460), 'P', 'Pi USB port (OTG)', BROWN);
wire('HUB1', 'INGND', gnd(160, 600), 'P', '', BLACK);
wire('HUB1', 'P15V', v5(500, 480), 'P', 'to Servo 2040 USB-C', BROWN);
wire('HUB1', 'P1GND', gnd(500, 600), 'P', '', BLACK);
wire('U2', 'USB5V', v5(1060, 520), 'P', 'hub port 1', BROWN);
wire('U2', 'USBGND', gnd(1040, 640), 'P', '', BLACK);

comp('UA1', PARTS.adapter.id, 620, 700, 'LIDARUSB');
wire('HUB1', 'P25V', 'UA1', 'U5V', 'hub port 2', BROWN);
wire('HUB1', 'P2GND', 'UA1', 'UGND', '', BLACK);
wire('HUB1', 'P2D', 'UA1', 'UD', 'USB data', BROWN);
wire('UA1', 'U5V', v5(580, 660), 'P', '', BROWN);
wire('UA1', 'UGND', gnd(560, 800), 'P', '', BLACK);
comp('LD1', PARTS.lidar.id, 940, 720, 'LIDAR');
wire('UA1', 'L5V', 'LD1', 'VCC', '5 V', ORANGE);
wire('UA1', 'LGND', 'LD1', 'GND', '', BLACK);
wire('UA1', 'LRX', 'LD1', 'TX', '460800 baud', TEAL);
wire('UA1', 'LTX', 'LD1', 'RX', '', TEAL);
wire('LD1', 'GND', gnd(900, 880), 'P', '', BLACK);
wire('LD1', 'VCC', v5(880, 680), 'P', '', ORANGE);

// 18 servos: signals by net label (S1..S18) so the sheet stays readable; V+ from V_SERVO, GND common
const legs = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'], joints = ['HIP', 'UP', 'LOW'];
for (let i = 0; i < 18; i++) {
  wire('U2', `S${i + 1}`, netLeft(`S${i + 1}`, 1180, pinY(4 + i)), 'P', '', '#7c3aed');
  const leg = Math.floor(i / 3), j = i % 3, x = 1660 + j * 320, y = 60 + leg * 140;
  const id = comp(`M${i + 1}`, PARTS.servo.id, x, y, `${legs[leg]}_${joints[j]}`);
  wire(id, 'SIG', netLeft(`S${i + 1}`, x, y + 20), 'P', '', '#7c3aed');
  wire(id, 'VP', netLeft('V_SERVO', x, y + 40), 'P', '', RED);
  wire(id, 'GND', gnd(x - 60, y + 80), 'P', '', BLACK);
}

notes.push({id: 'n1', x: 40, y: 960, text: 'Hexapod Pi Zero 2 W wiring, Rev C (5 November 2026).\n1. UART: Pi pin 8 (GPIO14 TX) → Servo 2040 SCL (GP21 RX); pin 10 (GPIO15 RX) ← SDA (GP20 TX); pin 6 GND → GND. Do NOT join 3V3.\n2. The 5V symbol is the Pi 5 V rail: the buck converter feeds it through PWR IN (micro-USB); the hub takes it from the inner USB port.\n3. All grounds are joined: battery −, buck converter, Pi, Servo 2040, hub and LiDAR.\n4. Switch the servo power off before connecting or disconnecting anything.'});
notes.push({id: 'n2', x: 40, y: 1100, text: 'RPLIDAR C1 (planned): connect through its USB adapter and the hub. The Pi’s GPIO UART is used by the Servo 2040 and its other UART by Bluetooth (Xbox controller). 5 V about 230 mA; 3.3 V logic; 460 800 baud. Check the pinout on the Slamtec datasheet.'});
notes.push({id: 'n3', x: 1700, y: 900, text: 'Servo outputs: L1 = 1–3, L2 = 4–6, L3 = 7–9, R1 = 10–12, R2 = 13–15, R3 = 16–18 (hip, upper leg, lower leg). Each servo plugs into the Servo 2040 header, which carries V+ and GND for it.'});

const now = new Date().toISOString();
const project = {
  format: 'iot-circuit-studio', version: 1, name: 'Hexapod Pi Zero 2 W wiring', created: now, updated: now,
  boardId: 'pi-zero-2w', components, wires, notes, customCode: null, lang: 'arduino', libraries: [], bb: {parts: {}, jumpers: {}},
  titleBlock: {author: 'Kangan hexapod', revision: 'C'},
  customParts: Object.values(PARTS),
};

mkdirSync(out, {recursive: true});
const json = JSON.stringify(project, null, 2);
writeFileSync(join(out, 'Hexapod wiring.circuit-studio.json'), json);
const link = SITE + '#p=z' + deflateRawSync(Buffer.from(JSON.stringify(project))).toString('base64url');
writeFileSync(join(out, 'Open in Circuit Studio.url'), `[InternetShortcut]\nURL=${link}\n`);
writeFileSync(join(out, 'share-link.txt'), link + '\n');
writeFileSync(join(out, 'Open in Circuit Studio.webloc'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>URL</key><string>${link}</string></dict></plist>\n`);
console.log(`ok: ${components.length} parts, ${wires.length} wires, link ${link.length} characters`);
