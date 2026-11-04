import test from 'node:test';
import assert from 'node:assert/strict';
import {STEPS, detect, allReleased, buildMap, markUsed} from '../src/setup-core.js';
import {toStandardPad} from '../src/linux-gamepad.js';
import {readPad} from '../vendor/controller/src/gamepad.js';

const step = key => STEPS.find(s => s.key === key);
const fresh = () => ({axes: new Set(), buttons: new Set()});
// hid-generic over Bluetooth style: right stick on axes 2/3, triggers on 4/5 resting at -32767, hat on 6/7.
const rest = [0, 0, 0, 0, -32767, -32767, 0, 0];
const raw = (axes = {}, buttons = []) => ({axes: rest.map((v, i) => axes[i] ?? v), buttons: Array.from({length: 15}, (_, i) => (buttons.includes(i) ? 1 : 0))});

test('triggers resting at -1 are not mistaken for a pushed stick', () => {
  assert.equal(detect(step('lx'), rest, raw(), fresh()), null);
  assert.ok(allReleased(rest, raw()));
});

test('learns stick axes and their direction', () => {
  assert.deepEqual(detect(step('lx'), rest, raw({0: 32767}), fresh()), {axis: 0});
  assert.deepEqual(detect(step('ly'), rest, raw({1: -32767}), fresh()), {axis: 1, invert: true}, 'down reads negative: inverted');
  const used = fresh(); used.axes.add(0);
  assert.equal(detect(step('lx'), rest, raw({0: 32767}), used), null, 'an axis is not used twice');
});

test('learns buttons, and the d-pad as buttons or a hat axis', () => {
  assert.equal(detect(step('a'), rest, raw({}, [3]), fresh()), 3);
  assert.equal(detect(step('a'), rest, raw({0: 32767}), fresh()), null, 'a stick is not a button');
  assert.equal(detect(step('up'), rest, raw({}, [11]), fresh()), 11);
  assert.deepEqual(detect(step('up'), rest, raw({7: -32767}), fresh()), {axis: 7, sign: -1});
});

test('a learned map drives the standard layout correctly', () => {
  const answers = {}, used = fresh();
  const presses = {lx: raw({0: 32767}), ly: raw({1: 32767}), rx: raw({2: 32767}), ry: raw({3: 32767}),
    a: raw({}, [0]), b: raw({}, [1]), x: raw({}, [3]), y: raw({}, [4]), lb: raw({}, [6]), rb: raw({}, [7]), view: raw({}, [10]), menu: raw({}, [11]),
    up: raw({7: -32767}), down: raw({7: 32767}), left: raw({6: -32767}), right: raw({6: 32767})};
  for (const s of STEPS) { answers[s.key] = detect(s, rest, presses[s.key], used); markUsed(s, answers[s.key], used); }
  const map = buildMap(answers);
  assert.deepEqual(map.axes, {lx: {axis: 0}, ly: {axis: 1}, rx: {axis: 2}, ry: {axis: 3}});
  // Right stick right with both triggers at rest: a turn, nothing else.
  const pad = toStandardPad({connected: true, ...raw({2: 32767}, [10])}, map);
  assert.deepEqual(readPad(pad), {stick: {x: 0, y: 0}, turn: 1});
  assert.equal(pad.buttons[8].pressed, true, 'View');
  assert.equal(map.buttons.menu, 11, 'Menu learned (for changing gait)');
  assert.equal(toStandardPad({connected: true, ...raw({}, [11])}, map).buttons[9].pressed, true, 'Menu');
  assert.equal(toStandardPad({connected: true, ...raw({6: 32767})}, map).buttons[15].pressed, true, 'd-pad right');
});
