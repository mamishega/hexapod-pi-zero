// Hexapod driving service for the Raspberry Pi Zero 2 W.
// Xbox controller (Bluetooth, /dev/input/js0) -> RobotController -> Servo 2040 over the UART.
// Runs headless under systemd (deploy/install.sh). Settings via environment variables:
//   HEXAPOD_SERIAL     serial device         (default /dev/serial0; /dev/ttyACM0 for USB)
//   HEXAPOD_JOYSTICK   controller device     (default /dev/input/js0)
//   HEXAPOD_MAP        controller map file   (default ./controller-map.json, from controller-setup)
//   HEXAPOD_LIVE_PORT  Live View web page    (default 5181; 0 turns it off)
//   HEXAPOD_BATTERY_LOW / HEXAPOD_BATTERY_CRITICAL  battery warnings in volts (default 7.0 / 6.6, a 2S LiPo)
//   HEXAPOD_BATTERY_MAH battery capacity in mAh (optional: running time on a full battery)
//   HEXAPOD_TEACHER_CODE teacher code for follow-the-teacher (default: a random code saved in ~/.hexapod/teacher-code)
//   HEXAPOD_STATS      servo statistics file (default ~/.hexapod/servo-stats.json, kept when the software is updated)
// Sessions, incidents and gait results are saved in ~/.hexapod as well.
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {RobotController} from '../vendor/controller/src/robot.js';
import {linkClass} from './node-serial-link.js';
import {LinuxGamepad, loadMap, MENU} from './linux-gamepad.js';
import {createDriveLoop} from './controls.js';
import {createLiveServer} from './live-server.js';
import {createHealth} from './health.js';
import {createRecorder} from './recorder.js';
import {createInsights} from './insights.js';
import {createClassroom, teacherCode} from './classroom.js';
import {readVersion} from './version.js';
import {BUTTONS} from '../vendor/controller/src/gamepad.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = {
  serial: process.env.HEXAPOD_SERIAL || '/dev/serial0',
  joystick: process.env.HEXAPOD_JOYSTICK || '/dev/input/js0',
  map: process.env.HEXAPOD_MAP || path.join(ROOT, 'controller-map.json'),
  livePort: Number(process.env.HEXAPOD_LIVE_PORT ?? 5181),
  stats: process.env.HEXAPOD_STATS || path.join(os.homedir(), '.hexapod', 'servo-stats.json'),
  battery: {low: Number(process.env.HEXAPOD_BATTERY_LOW || 7.0), critical: Number(process.env.HEXAPOD_BATTERY_CRITICAL || 6.6), capacityMah: Number(process.env.HEXAPOD_BATTERY_MAH) || null},
  data: path.join(os.homedir(), '.hexapod'),
};
const LOOP_MS = 20;        // read the controller 50 times a second
const RECONNECT_MS = 3000; // retry the Servo 2040 link this often while it is down

let live = null; // Live View (read-only web page), started below
const log = (text, error = /^ERROR/.test(text)) => { console.log(`${new Date().toISOString().slice(11, 19)}  ${text}`); live?.log(text, error); };
log(`Hexapod driving service starting: board ${config.serial}, controller ${config.joystick}`);

const robot = new RobotController({links: {uart: linkClass({path: config.serial})}});
if (config.livePort) {
  const recorder = createRecorder({dir: config.data, log: text => console.log(text)});
  // A board restart also goes in the service log (journalctl -u hexapod-drive), not only the Health page.
  const health = createHealth({statsFile: config.stats, battery: config.battery, onEvent: event => {
    if (event.text.startsWith('Servo 2040 restarted')) log(`ERROR ${event.text}`);
    return recorder.event(event);
  }});
  const insights = createInsights({file: path.join(config.data, 'insights.json'), battery: config.battery});
  const code = teacherCode({file: path.join(config.data, 'teacher-code')});
  // Only in the service log (journalctl -u hexapod-drive), never on the web page.
  console.log(`Live View teacher code: ${code}  (change it in ${path.join(config.data, 'teacher-code')})`);
  live = createLiveServer({root: path.join(ROOT, 'live'), port: config.livePort, log, health, recorder, insights,
    classroom: createClassroom({code}), version: readVersion(ROOT)});
  robot.subscribe(() => live.robot(robot.getSnapshot()));
  live.watchLink(robot); // message inspector: every command to the board and its reply
}
let lastMessage = robot.getSnapshot().message.text, lastConnection = ''; // skip the browser's opening hint
robot.subscribe(() => {
  const {message, connection} = robot.getSnapshot();
  if (connection !== lastConnection) { lastConnection = connection; log(`Board link: ${connection}`); }
  if (message.text !== lastMessage) { lastMessage = message.text; log(`${message.error ? 'ERROR ' : ''}${message.text}`); }
});

const gamepad = new LinuxGamepad({device: config.joystick, map: loadMap(config.map), log});
const PAD_BUTTONS = {...BUTTONS, menu: MENU}; // what the Live View shows as held
const readPads = () => { const pads = gamepad.pads(); live?.pad(pads[0], PAD_BUTTONS); return pads; };
const step = createDriveLoop({robot, readPads, log, onAction: (action, detail) => live?.action(action, detail)});
const loop = setInterval(() => { try { step(); } catch (error) { log(`ERROR in drive loop: ${error.stack || error}`); } }, LOOP_MS);

async function keepConnected() {
  if (robot.getSnapshot().connection === 'offline') {
    try { await robot.connect('uart'); } catch (error) { log(`ERROR connecting: ${error.message}`); }
  }
}
keepConnected();
const reconnect = setInterval(keepConnected, RECONNECT_MS);

// systemctl stop / Ctrl+C: finish the step if walking, then exit. With no more
// commands, the board's 3-second watchdog then releases the motors.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return; stopping = true;
  log(`${signal}: stopping`);
  clearInterval(loop); clearInterval(reconnect); gamepad.close(); live?.close();
  if (robot.walking) {
    robot.stopWalk();
    for (let i = 0; i < 30 && robot.walking; i++) await new Promise(r => setTimeout(r, 100));
  }
  try { await robot.link?.close(); } catch {}
  log('Stopped. The board releases the motors 3 seconds after the last command.');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
