// Reads an Xbox controller through the Linux joystick interface (/dev/input/js0) and
// presents it exactly like the browser Gamepad API's "standard" layout, so the tested
// GamepadInput (gamepad.js) drives the robot unchanged.
//
// Linux numbers buttons and axes differently per driver (xpad, xpadneo, hid-generic over
// Bluetooth), so the numbers come from a mapping file made by `npm run controller-setup`.
// Only mapped axes are read: an unmapped trigger resting at -1 can never act as a stick.
import fs from 'node:fs';
import path from 'node:path';

export const JS_EVENT_SIZE = 8;
const JS_BUTTON = 0x01, JS_AXIS = 0x02, JS_INIT = 0x80;

// Common xpad / xpadneo layout. Verify with `npm run controller-setup`.
export const DEFAULT_MAP = {
  axes: {lx: {axis: 0}, ly: {axis: 1}, rx: {axis: 3}, ry: {axis: 4}},
  buttons: {a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, view: 6, menu: 7},
  dpad: {up: {axis: 7, sign: -1}, down: {axis: 7, sign: 1}, left: {axis: 6, sign: -1}, right: {axis: 6, sign: 1}},
};
// Standard Gamepad API button numbers (as gamepad.js expects).
const STANDARD = {a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, view: 8, menu: 9, up: 12, down: 13, left: 14, right: 15};
// Standard Gamepad API number of the Menu (start) button, used for changing gait.
export const MENU = STANDARD.menu;

// One 8-byte js_event: u32 time (ms), s16 value, u8 type, u8 number.
export function parseEvents(buffer) {
  const events = [];
  for (let at = 0; at + JS_EVENT_SIZE <= buffer.length; at += JS_EVENT_SIZE) {
    const type = buffer.readUInt8(at + 6);
    events.push({time: buffer.readUInt32LE(at), value: buffer.readInt16LE(at + 4), kind: type & ~JS_INIT, init: !!(type & JS_INIT), number: buffer.readUInt8(at + 7)});
  }
  return events;
}

export function loadMap(file) {
  try { return withDefaultButtons({...DEFAULT_MAP, ...JSON.parse(fs.readFileSync(file, 'utf8'))}); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`Controller map ${file} is not valid: ${error.message}`); return DEFAULT_MAP; }
}

// A map made before a button was added (Menu, for changing gait) gets the usual number for it,
// unless that number is already one of the map's own buttons.
export function withDefaultButtons(map) {
  const taken = new Set(Object.values(map.buttons || {}));
  const extra = Object.entries(DEFAULT_MAP.buttons).filter(([name, n]) => !(name in (map.buttons || {})) && !taken.has(n));
  return {...map, buttons: {...map.buttons, ...Object.fromEntries(extra)}};
}

// Raw controller state -> a standard-layout pad object, or null when disconnected.
export function toStandardPad(raw, map, name = 'Linux game controller') {
  if (!raw.connected) return null;
  const axis = spec => {
    if (!spec) return 0;
    const v = (raw.axes[spec.axis] ?? 0) / 32767;
    return Math.max(-1, Math.min(1, spec.invert ? -v : v));
  };
  const buttons = Array.from({length: 17}, () => ({pressed: false, value: 0}));
  const press = (name, on) => { if (on) buttons[STANDARD[name]] = {pressed: true, value: 1}; };
  for (const [name, number] of Object.entries(map.buttons || {})) press(name, !!raw.buttons[number]);
  for (const [name, spec] of Object.entries(map.dpad || {})) {
    if (typeof spec === 'number') press(name, !!raw.buttons[spec]);             // d-pad as buttons
    else if (spec) press(name, (raw.axes[spec.axis] ?? 0) * spec.sign > 16000); // d-pad as a hat axis
  }
  const {axes} = map;
  return {id: name, index: 0, connected: true, mapping: 'standard', axes: [axis(axes.lx), axis(axes.ly), axis(axes.rx), axis(axes.ry)], buttons};
}

// Keeps a controller open, reconnecting when it is switched back on.
//
// The device is opened non-blocking and drained on every pads() call (the drive loop
// calls it 50 times a second). A blocking read stream would park a libuv worker thread
// in read() on the joystick, and Node cannot exit while that thread is stuck, so
// `systemctl stop` hung until systemd killed the service.
export class LinuxGamepad {
  constructor({device = '/dev/input/js0', map = DEFAULT_MAP, log = () => {}, fsModule = fs} = {}) {
    Object.assign(this, {device, map, log, fs: fsModule});
    this.raw = {connected: false, axes: [], buttons: []};
    this.fd = null; this.rest = Buffer.alloc(0); this.buffer = Buffer.alloc(JS_EVENT_SIZE * 64);
    this.name = 'Linux game controller'; this.nextTry = 0; this.lastError = '';
  }
  get connected() { return this.fd !== null; }
  // Called every loop: returns [pad] or [] (disconnected), like navigator.getGamepads().
  pads(now = Date.now()) {
    if (this.fd === null && now >= this.nextTry) this.open(now);
    if (this.fd !== null) this.drain();
    const pad = toStandardPad(this.raw, this.map, this.name);
    return pad ? [pad] : [];
  }
  open(now) {
    this.nextTry = now + 1000;
    if (!this.fs.existsSync(this.device)) return;
    try { this.name = this.fs.readFileSync(`/sys/class/input/${path.basename(this.device)}/device/name`, 'utf8').trim() || this.name; } catch {}
    try { this.fd = this.fs.openSync(this.device, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK); }
    catch (error) {
      // Retried every second: say it once, not 60 times a minute (for example a permissions problem).
      if (error.message !== this.lastError) this.log(`Controller could not be opened (${error.message})`);
      this.lastError = error.message; return;
    }
    this.lastError = '';
    this.rest = Buffer.alloc(0);
    this.raw = {connected: true, axes: [], buttons: []};
    this.log(`Controller connected: ${this.name}`);
  }
  // Reads every event waiting in the kernel; EAGAIN just means there are none yet.
  drain() {
    for (;;) {
      let count;
      try { count = this.fs.readSync(this.fd, this.buffer, 0, this.buffer.length, null); }
      catch (error) { if (error.code !== 'EAGAIN') this.lost(error); return; }
      if (!count) return;
      const data = Buffer.concat([this.rest, this.buffer.subarray(0, count)]);
      const whole = data.length - (data.length % JS_EVENT_SIZE);
      for (const e of parseEvents(data.subarray(0, whole))) this.apply(e);
      this.rest = Buffer.from(data.subarray(whole));
    }
  }
  lost(error) {
    this.close();
    this.raw = {connected: false, axes: [], buttons: []}; // all released: the robot stops walking
    this.log(`Controller disconnected${error?.message ? ` (${error.message})` : ''}`);
  }
  apply(e) {
    if (e.kind === JS_BUTTON) this.raw.buttons[e.number] = e.value;
    else if (e.kind === JS_AXIS) this.raw.axes[e.number] = e.value;
  }
  close() { const fd = this.fd; this.fd = null; if (fd !== null) { try { this.fs.closeSync(fd); } catch {} } }
}
