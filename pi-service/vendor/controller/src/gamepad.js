// Xbox (and other "standard" layout) game controller input, via the browser
// Gamepad API. No React and no DOM, so it can be tested with fake controllers.
//
//   Left stick   walk (forward / back / sideways)
//   Right stick  turn left / right
//   A  Enable    Y  Stand    X  Sit
//   B  stop the walk gently (finish the step in the starting stance)
//   View (the two-squares button)  STOP MOTORS: releases all servo torque
//   D-pad up / down     speed + / -
//   RB / LB             step height + / -
//   D-pad right / left  stride angle + / -     (hold any of these to repeat)
//
// Letting go of both sticks stops the walk, exactly like releasing the on-screen
// joystick. If the controller disconnects (cable pulled, battery flat) the drive
// input drops to zero, so the robot stops walking too.

export const STICK_DEADZONE = 0.18; // worn Xbox sticks often rest at 0.1-0.15
const STEP = 0.05;                  // round stick values so resting jitter is not re-sent every frame

// Standard Gamepad API button numbers (Xbox labels).
export const BUTTONS = {a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, view: 8, up: 12, down: 13, left: 14, right: 15};
export const ACTIONS = {a: 'enable', b: 'stopWalk', x: 'sit', y: 'stand', view: 'stopMotors',
  up: 'speedUp', down: 'speedDown', rb: 'liftUp', lb: 'liftDown', right: 'angleUp', left: 'angleDown'};
// Setting buttons repeat while held: first after REPEAT_DELAY_MS, then every REPEAT_MS.
const REPEATS = new Set(['up', 'down', 'lb', 'rb', 'left', 'right']);
export const REPEAT_DELAY_MS = 450, REPEAT_MS = 150;

const quantize = value => { const q = Math.round(value / STEP) * STEP; return Object.is(q, -0) ? 0 : Math.round(q * 100) / 100; };

// Radial dead zone, rescaled so movement starts smoothly just outside it.
export function deadzone(x, y, zone = STICK_DEADZONE) {
  const mag = Math.hypot(x, y);
  if (!(mag > zone)) return {x: 0, y: 0};
  const scale = Math.min(1, (mag - zone) / (1 - zone)) / mag;
  return {x: quantize(x * scale), y: quantize(y * scale)};
}

// Drive input from one controller: stick {x, y} (x right +, y down +, as the
// on-screen joystick) and turn (right +, as the on-screen turn slider).
export function readPad(pad) {
  const axis = i => (Number.isFinite(pad.axes?.[i]) ? pad.axes[i] : 0);
  const stick = deadzone(axis(0), axis(1));
  const turn = deadzone(axis(2), 0).x;
  return {stick, turn};
}

const pressed = (pad, index) => { const b = pad.buttons?.[index]; return !!(b && (typeof b === 'object' ? b.pressed : b > 0.5)); };

// Picks the first connected controller and reports changes once per poll.
export class GamepadInput {
  // held: button name -> time it next repeats (Infinity: no repeat).
  constructor() { this.index = null; this.id = null; this.held = new Map(); this.last = {stick: {x: 0, y: 0}, turn: 0}; }

  // pads: navigator.getGamepads(). Returns {connected, id, drive (only when it
  // changed, else null), actions (buttons newly pressed, or repeating, this poll)}.
  poll(pads, now = Date.now()) {
    const list = Array.from(pads || []);
    let pad = this.index !== null ? list[this.index] : null;
    if (!pad?.connected) {
      // Only the standard layout: on other mappings axis 2 is often a trigger that rests at -1,
      // which would read as "turn right" and walk the robot with nobody touching the controller.
      pad = list.find(p => p?.connected && p.mapping === 'standard') || null;
      this.index = pad ? pad.index : null;
      this.held.clear(); // a newly found controller must not fire buttons already held down
      if (pad) for (const [name, index] of Object.entries(BUTTONS)) if (pressed(pad, index)) this.held.set(name, Infinity);
    }
    this.id = pad?.id ?? null;
    const input = pad ? readPad(pad) : {stick: {x: 0, y: 0}, turn: 0};
    const changed = input.stick.x !== this.last.stick.x || input.stick.y !== this.last.stick.y || input.turn !== this.last.turn;
    this.last = input;
    const actions = [];
    if (pad) {
      for (const [name, index] of Object.entries(BUTTONS)) {
        if (!pressed(pad, index)) { this.held.delete(name); continue; }
        if (!this.held.has(name)) {
          this.held.set(name, REPEATS.has(name) ? now + REPEAT_DELAY_MS : Infinity);
          actions.push(ACTIONS[name]);
        } else if (now >= this.held.get(name)) {
          const due = this.held.get(name) + REPEAT_MS;
          this.held.set(name, due > now ? due : now + REPEAT_MS); // after a stalled frame: one repeat, not a burst
          actions.push(ACTIONS[name]);
        }
      }
    }
    // Stop motors always comes first if pressed together with anything else.
    actions.sort((p, q) => (q === 'stopMotors') - (p === 'stopMotors'));
    // A controller is plugged in but not in the standard layout: ignored, and said so.
    const unsupported = !pad && list.some(p => p?.connected);
    return {connected: !!pad, id: this.id, unsupported, drive: changed ? input : null, actions};
  }
}
