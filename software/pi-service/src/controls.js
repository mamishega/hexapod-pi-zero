// Turns controller input into robot commands, exactly as Hexapod Remote does in the browser
// (same GamepadInput, same RobotController, same button actions).
import {GamepadInput} from '../vendor/controller/src/gamepad.js';
import {driveDirection, GAITS} from '../vendor/controller/src/robot.js';
import {MENU} from './linux-gamepad.js';

const NUDGES = {speedUp: ['speed', 1], speedDown: ['speed', -1], liftUp: ['lift', 1], liftDown: ['lift', -1], angleUp: ['hipSwing', 1], angleDown: ['hipSwing', -1]};

export function createDriveLoop({robot, readPads, now = Date.now, log = () => {}, onAction = () => {}}) {
  const input = new GamepadInput();
  let connected = null;
  let menuDown = true; // must be released before it counts, like the other buttons

  // Menu: the next gait in the list. While walking the board blends into it without stopping;
  // otherwise it is used for the next walk.
  function nextGait() {
    const s = robot.getSnapshot(), order = GAITS.map(g => g.id);
    const current = s.live?.walking?.gait || s.settings.gait;
    const gait = order[(order.indexOf(current) + 1) % order.length];
    robot.setSettings({gait});
    // Blends now only while really walking; while finishing the last step it waits for the next walk.
    const blend = !!s.live?.walking && !s.live.walking.stopping;
    if (!blend) robot.say?.(`Gait: ${GAITS.find(g => g.id === gait).label}. The next walk uses it.`);
    return {gait, blend};
  }

  function act(action) {
    const s = robot.getSnapshot(), live = s.live, ready = s.connection === 'online';
    log(`Button: ${action}`);
    const detail = {};
    if (action === 'gait') Object.assign(detail, nextGait());
    else if (action === 'stopMotors') robot.stop();
    else if (action === 'stopWalk') robot.stopWalk();
    else if (action === 'enable') { if (ready && !live?.walking && !s.busy) robot.enable(); }
    else if (NUDGES[action]) robot.nudge(...NUDGES[action]);
    else if (ready && live?.active) robot.posture(action);
    // After the command, and guarded: a display problem must never block a button (above all View = motors off).
    try { onAction(action, detail); } catch {}
  }

  return function step() {
    const pads = readPads();
    const result = input.poll(pads, now());
    if (result.connected !== connected) {
      connected = result.connected;
      if (!connected) robot.release(); // belt and braces: no controller, no driving
    }
    for (const action of result.actions) act(action);
    const menu = !!pads[0]?.buttons?.[MENU]?.pressed;
    if (menu && !menuDown && result.connected) act('gait');
    menuDown = menu || !result.connected;
    if (result.drive) robot.drive(driveDirection({x: result.drive.stick.x, y: result.drive.stick.y, turn: -result.drive.turn}));
  };
}
