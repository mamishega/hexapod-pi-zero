import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseEvents, toStandardPad, LinuxGamepad, DEFAULT_MAP, loadMap, withDefaultButtons} from '../src/linux-gamepad.js';
import {readPad} from '../vendor/controller/src/gamepad.js';

// js_event bytes: u32 time, s16 value, u8 type (1 button, 2 axis, |0x80 initial), u8 number.
function ev(kind, number, value, init = false) {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(1234, 0); b.writeInt16LE(value, 4); b.writeUInt8((kind === 'button' ? 1 : 2) | (init ? 0x80 : 0), 6); b.writeUInt8(number, 7);
  return b;
}

test('parses Linux joystick events', () => {
  const events = parseEvents(Buffer.concat([ev('button', 0, 1), ev('axis', 1, -32767, true)]));
  assert.deepEqual(events, [
    {time: 1234, value: 1, kind: 1, init: false, number: 0},
    {time: 1234, value: -32767, kind: 2, init: true, number: 1},
  ]);
});

test('maps to the standard layout; unmapped triggers are ignored', () => {
  const raw = {connected: true, buttons: [1, 0, 0, 0, 0, 1, 1], axes: [0, -32767, -32767, 32767, 0, -32767, 0, -32767]};
  const pad = toStandardPad(raw, DEFAULT_MAP, 'Xbox Wireless Controller');
  assert.equal(pad.mapping, 'standard');
  assert.deepEqual(pad.axes, [0, -1, 1, 0], 'left stick up, right stick right; triggers on axes 2 and 5 unused');
  const pressed = pad.buttons.map((b, i) => (b.pressed ? i : null)).filter(i => i !== null);
  assert.deepEqual(pressed, [0, 5, 8, 12], 'A, RB, View (standard 8) and d-pad up from the hat axis');
  assert.deepEqual(readPad(pad), {stick: {x: 0, y: -1}, turn: 1});
  assert.equal(toStandardPad({connected: false, axes: [], buttons: []}, DEFAULT_MAP), null);
});

test('inverted axes and d-pad buttons from a learned map', () => {
  const map = {axes: {lx: {axis: 0}, ly: {axis: 1, invert: true}, rx: {axis: 2}, ry: {axis: 5}}, buttons: {a: 0, b: 1, x: 3, y: 4, lb: 6, rb: 7, view: 10}, dpad: {up: 11, down: 12, left: 13, right: 14}};
  const pad = toStandardPad({connected: true, buttons: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1], axes: [0, 32767, 16000]}, map);
  assert.equal(pad.axes[1], -1);
  assert.deepEqual(pad.buttons.map((b, i) => (b.pressed ? i : null)).filter(i => i !== null), [2, 8, 15], 'X, View, d-pad right');
});

test('a missing map file falls back to the default; a broken one is an error', () => {
  assert.equal(loadMap('/nonexistent/controller-map.json'), DEFAULT_MAP);
});

test('reads the device without blocking, and reconnects after the controller drops out', () => {
  // A fake non-blocking joystick: queued chunks are returned one per read, then EAGAIN.
  const devices = [];
  const fail = (code, message) => Object.assign(new Error(message), {code});
  const fakeFs = {
    existsSync: () => true, readFileSync: () => 'Xbox Wireless Controller\n',
    openSync: (file, flags) => { devices.push({queue: [], error: null, closed: false, flags}); return devices.length - 1; },
    readSync: (fd, buffer) => {
      const d = devices[fd];
      if (d.error) throw d.error;
      const chunk = d.queue.shift();
      if (!chunk) throw fail('EAGAIN', 'EAGAIN: resource temporarily unavailable, read');
      chunk.copy(buffer); return chunk.length;
    },
    closeSync: fd => { devices[fd].closed = true; },
  };
  const logs = [];
  const pad = new LinuxGamepad({fsModule: fakeFs, log: t => logs.push(t)});
  assert.equal(pad.pads(0).length, 1, 'opens on first call');
  assert.ok(devices[0].flags & fs.constants.O_NONBLOCK, 'opened non-blocking so Node can always exit');
  devices[0].queue.push(Buffer.concat([ev('axis', 1, -32767, true), ev('button', 0, 1).subarray(0, 5)]));
  devices[0].queue.push(ev('button', 0, 1).subarray(5)); // an event split across reads
  let [p] = pad.pads(10);
  assert.equal(p.id, 'Xbox Wireless Controller');
  assert.equal(p.axes[1], -1);
  assert.equal(p.buttons[0].pressed, true);
  assert.equal(pad.pads(15)[0].buttons[0].pressed, true, 'no new events (EAGAIN) keeps the state');
  devices[0].error = fail('ENODEV', 'No such device');
  assert.deepEqual(pad.pads(20), [], 'disconnected: no pad, so nothing is pressed');
  assert.match(logs.at(-1), /disconnected/);
  assert.equal(devices[0].closed, true, 'the old device is closed');
  assert.deepEqual(pad.pads(500), [], 'waits before retrying');
  assert.equal(pad.pads(1100).length, 1, 'reconnects');
  [p] = pad.pads(1110);
  assert.equal(p.buttons[0].pressed, false, 'fresh state after reconnecting');
  pad.close();
  assert.equal(devices[1].closed, true, 'close() releases the device');
});

test('a controller that cannot be opened is reported once, not every second', () => {
  const logs = [];
  let fail = true;
  const fakeFs = {existsSync: () => true, readFileSync: () => 'Xbox\n', closeSync: () => {},
    openSync: () => { if (fail) throw new Error('EACCES: permission denied'); return 7; },
    readSync: () => { throw Object.assign(new Error('again'), {code: 'EAGAIN'}); }};
  const pad = new LinuxGamepad({fsModule: fakeFs, log: t => logs.push(t)});
  for (let t = 0; t <= 10000; t += 1000) pad.pads(t);
  assert.equal(logs.filter(l => /could not be opened/.test(l)).length, 1);
  fail = false;
  assert.equal(pad.pads(11000).length, 1, 'opens once the problem is fixed');
  assert.match(logs.at(-1), /Controller connected/);
});

test('a map made before the Menu button existed gets it, unless its number is already used', () => {
  const old = {axes: DEFAULT_MAP.axes, dpad: DEFAULT_MAP.dpad, buttons: {a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, view: 6}};
  assert.equal(withDefaultButtons(old).buttons.menu, 7);
  const clash = {...old, buttons: {...old.buttons, view: 7}};       // this controller uses 7 for View
  assert.equal(withDefaultButtons(clash).buttons.menu, undefined, 'never doubles up a button');
  assert.equal(withDefaultButtons({...old, buttons: {...old.buttons, menu: 9}}).buttons.menu, 9, 'a learned Menu is kept');
});
