// Live view of the controller as the driving service sees it. Nothing is sent to the robot.
//   npm run controller-test        (Ctrl+C to quit)
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LinuxGamepad, loadMap, MENU} from '../src/linux-gamepad.js';
import {readPad, BUTTONS} from '../vendor/controller/src/gamepad.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const device = process.env.HEXAPOD_JOYSTICK || '/dev/input/js0';
const mapFile = process.env.HEXAPOD_MAP || path.join(ROOT, 'controller-map.json');
const pad = new LinuxGamepad({device, map: loadMap(mapFile)});
const names = Object.entries({...BUTTONS, menu: MENU}); // Menu changes the gait
const f = v => (v >= 0 ? '+' : '') + v.toFixed(2);

console.log(`Controller test: ${device}, map ${mapFile}. Move the sticks and press buttons. Ctrl+C to quit.\n`);
setInterval(() => {
  const [p] = pad.pads();
  if (!p) { process.stdout.write('\r\x1b[KWaiting for the controller...'); return; }
  const {stick, turn} = readPad(p); // after the dead zone, as used for driving
  const pressed = names.filter(([, i]) => p.buttons[i].pressed).map(([n]) => n.toUpperCase()).join(' ') || '-';
  const raw = `raw buttons [${pad.raw.buttons.map(b => b ? 1 : 0).join('')}]`;
  process.stdout.write(`\r\x1b[KWalk x ${f(stick.x)} y ${f(stick.y)}  Turn ${f(turn)}  |  Pressed: ${pressed.padEnd(18)} ${raw}`);
}, 100);
process.on('SIGINT', () => { console.log('\n'); process.exit(0); });
