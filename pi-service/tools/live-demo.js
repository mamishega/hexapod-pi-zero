// Live View demo: no robot or controller needed. A simulated Servo 2040 and a scripted
// Xbox controller run the same drive loop as the real service, so the page behaves
// exactly as it does with the robot. Good for preparing a lesson.
//   npm run live-demo            then open http://localhost:5182
//   HEXAPOD_LIVE_PORT=5190 npm run live-demo
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SimulatedLink} from '../vendor/webapp/dist/simulator.js';
import {RobotController} from '../vendor/controller/src/robot.js';
import {BUTTONS} from '../vendor/controller/src/gamepad.js';
import {toStandardPad, DEFAULT_MAP, MENU} from '../src/linux-gamepad.js';
import {createDriveLoop} from '../src/controls.js';
import {createLiveServer} from '../src/live-server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.HEXAPOD_LIVE_PORT || 5182); // 5182: does not clash with the real service
const log = (text, error = /^ERROR/.test(text)) => { console.log(`${new Date().toISOString().slice(11, 19)}  ${text}`); live.log(text, error); };
const live = createLiveServer({root: path.join(ROOT, 'live'), port, host: process.env.HEXAPOD_LIVE_HOST || '127.0.0.1', log: text => console.log(text)});

const robot = new RobotController({links: {sim: SimulatedLink}});
live.watchLink(robot);
// The simulator has no battery sensor: invent a plausible one (marked simulated on the page).
let charge = 7.6;
const withDemoPower = s => {
  if (!s.live) return s;
  const amps = s.live.walking ? 1.8 + Math.random() * 0.9 : s.live.active ? 0.45 + Math.random() * 0.1 : 0.08;
  charge = Math.max(6.6, charge - amps * 0.00002);
  return {...s, live: {...s.live, power: {voltage: Math.round((charge - amps * 0.12) * 100) / 100, current: Math.round(amps * 100) / 100, simulated: true}}};
};
let lastMessage = '';
robot.subscribe(() => {
  const s = robot.getSnapshot();
  live.robot(withDemoPower(s));
  if (s.message.text !== lastMessage) { lastMessage = s.message.text; log(`${s.message.error ? 'ERROR ' : ''}${s.message.text}`); }
});

// Raw Linux joystick state in the default xpad/xpadneo layout (see linux-gamepad.js DEFAULT_MAP).
const FULL = 32767;
const raw = {connected: true, axes: [0, 0, -FULL, 0, 0, -FULL, 0, 0], buttons: [0, 0, 0, 0, 0, 0, 0, 0]};
const BUTTON = {a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, view: 6, menu: 7};
const rest = () => { raw.axes = [0, 0, -FULL, 0, 0, -FULL, 0, 0]; raw.buttons = [0, 0, 0, 0, 0, 0, 0, 0]; };
const stick = (lx, ly, rx = 0) => { raw.axes[0] = Math.round(lx * FULL); raw.axes[1] = Math.round(ly * FULL); raw.axes[3] = Math.round(rx * FULL); };
const press = name => { if (name in BUTTON) raw.buttons[BUTTON[name]] = 1; else raw.axes[{up: 7, down: 7, left: 6, right: 6}[name]] = (name === 'up' || name === 'left' ? -1 : 1) * FULL; };

// A lesson-sized loop (about 95 s): each step is [seconds to hold, what to do].
const SCRIPT = [
  [3, () => {}],
  [0.4, () => press('a')], [3.5, () => {}],                 // enable: legs glide to the home stance
  [4, () => stick(0, -0.9)], [2.5, () => {}],               // walk forward, release: stop in the stance
  [0.3, () => press('down')], [0.4, () => {}], [0.3, () => press('down')], [0.4, () => {}],
  [5, () => stick(0, -0.9)], [2.5, () => {}],               // slower: easier to see which legs lift
  [0.3, () => press('up')], [0.4, () => {}], [0.3, () => press('up')], [0.4, () => {}],
  [4, () => stick(0.85, 0)], [2.5, () => {}],               // sideways right (crab walk)
  [4, () => stick(0, 0, -0.85)], [2.5, () => {}],           // turn on the spot (left)
  [0.3, () => press('rb')], [0.4, () => {}], [0.3, () => press('rb')], [0.4, () => {}],
  [4, () => stick(-0.6, -0.6)], [2.5, () => {}],            // higher steps, diagonal
  [0.3, () => press('lb')], [0.4, () => {}], [0.3, () => press('lb')], [0.4, () => {}],
  [4, () => stick(0, -0.8, 0.5)], [2.5, () => {}],          // curve: walk and turn together
  [3, () => stick(0, -0.85)], [0.3, () => { stick(0, -0.85); press('menu'); }],   // walking: ripple -> wave
  [4, () => stick(0, -0.85)], [0.3, () => { stick(0, -0.85); press('menu'); }],   // wave -> tripod
  [4, () => stick(0, -0.85)], [0.3, () => { stick(0, -0.85); press('menu'); }],   // tripod -> ripple
  [3, () => stick(0, -0.85)], [2.5, () => {}],
  [0.4, () => press('x')], [4, () => {}],                   // sit
  [0.4, () => press('y')], [4, () => {}],                   // stand
  [0.4, () => press('view')], [4, () => {}],                // motors off
];

const PAD_BUTTONS = {...BUTTONS, menu: MENU};
const readPads = () => { const pad = toStandardPad(raw, DEFAULT_MAP, 'Demo controller (scripted)'); live.pad(pad, PAD_BUTTONS); return pad ? [pad] : []; };
const step = createDriveLoop({robot, readPads, log, onAction: (action, detail) => live.action(action, detail)});
setInterval(() => { try { step(); } catch (error) { log(`ERROR in drive loop: ${error.stack || error}`); } }, 20);

let index = 0, until = 0;
setInterval(() => {
  const now = Date.now();
  if (now < until) return;
  rest();
  const [seconds, act] = SCRIPT[index];
  act();
  until = now + seconds * 1000;
  index = (index + 1) % SCRIPT.length;
}, 20);

await robot.connect('sim');
console.log(`Live View demo: open http://localhost:${port}   (Ctrl+C to stop)`);
process.on('SIGINT', () => { live.close(); process.exit(0); });
