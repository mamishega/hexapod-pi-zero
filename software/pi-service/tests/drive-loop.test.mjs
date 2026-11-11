import test from 'node:test';
import assert from 'node:assert/strict';
import {SimulatedLink} from '../vendor/webapp/dist/simulator.js';
import {RobotController} from '../vendor/controller/src/robot.js';
import {toStandardPad, DEFAULT_MAP} from '../src/linux-gamepad.js';
import {createDriveLoop} from '../src/controls.js';

// The whole Pi pipeline against the simulated board: Linux controller state ->
// standard pad -> drive loop -> RobotController -> board commands.
async function setup() {
  let time = 1000;
  const now = () => time, timeouts = [];
  const timers = {setInterval: () => 1, clearInterval: () => {}, setTimeout: fn => { timeouts.push(fn); return timeouts.length; }};
  class Sim extends SimulatedLink { constructor(event, lost) { super(event, lost, {now}); } }
  const robot = new RobotController({links: {uart: Sim}, timers, now});
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  await robot.connect('uart');
  const sent = [], send = robot.link.send.bind(robot.link);
  robot.link.send = (op, args, guard) => { sent.push({op, ...args}); return send(op, args, guard); };
  const raw = {connected: true, axes: [0, 0, -32767, 0, 0, -32767, 0, 0], buttons: [0, 0, 0, 0, 0, 0, 0]};
  const step = createDriveLoop({robot, readPads: () => { const p = toStandardPad(raw, DEFAULT_MAP); return p ? [p] : []; }, now});
  const frame = async (ms = 20) => { time += ms; step(); await settle(); };
  const flush = async () => { while (timeouts.length) timeouts.shift()(); await settle(); };
  await frame(); // controller found with nothing pressed (buttons held at that moment are ignored)
  return {robot, raw, sent, frame, flush, settle, advance: ms => { time += ms; }};
}

test('A enables, the left stick walks and steers, letting go stops', async () => {
  const {robot, raw, sent, frame, flush, settle, advance} = await setup();
  await frame();
  raw.buttons[0] = 1; await frame();             // press A
  raw.buttons[0] = 0; await frame();
  assert.equal(sent[0].op, 'arm');
  advance(1000); await robot.poll(); await settle(); // legs reach the home stance
  raw.axes[1] = -32767; await frame();            // left stick up
  const walk = sent.find(s => s.op === 'walk');
  assert.deepEqual(walk.direction, [1, 0, 0]);
  advance(500); await robot.poll(); await settle();
  raw.axes[3] = -32767; await frame(200);         // right stick left: curve left
  assert.deepEqual(sent.at(-1), {op: 'walk', direction: [1, 0, 1], checked: true});
  raw.axes[1] = 0; raw.axes[3] = 0; await frame(); // let go
  advance(400); await flush();
  assert.equal(sent.at(-1).op, 'walk_stop');
});

test('the triggers at rest never move the robot', async () => {
  const {robot, raw, sent, frame, settle, advance} = await setup();
  raw.buttons[0] = 1; await frame(); raw.buttons[0] = 0; await frame();
  advance(1000); await robot.poll(); await settle();
  for (let i = 0; i < 10; i++) await frame();
  assert.deepEqual(sent.map(s => s.op).filter(op => op !== 'status'), ['arm'], 'only Enable; no walk from the -1 triggers');
  assert.equal(robot.walking, false);
});

test('a controller that drops out mid-walk stops the robot; View stops the motors', async () => {
  const {robot, raw, sent, frame, flush, settle, advance} = await setup();
  raw.buttons[0] = 1; await frame(); raw.buttons[0] = 0; await frame();
  advance(1000); await robot.poll(); await settle();
  raw.axes[1] = -32767; await frame();
  assert.ok(robot.walking);
  raw.connected = false; await frame();           // battery flat / out of range
  advance(400); await flush();
  assert.equal(sent.at(-1).op, 'walk_stop');
  raw.connected = true; raw.axes[1] = 0; raw.buttons[6] = 0; await frame();
  raw.buttons[6] = 1; await frame();              // View (button 6 in the default map)
  assert.equal(sent.at(-1).op, 'off');
});

test('D-pad and shoulder buttons change the walk settings', async () => {
  const {robot, raw, frame} = await setup();
  const before = {...robot.getSnapshot().settings};
  raw.axes[7] = -32767; await frame(); raw.axes[7] = 0; await frame();  // d-pad up
  raw.buttons[5] = 1; await frame(); raw.buttons[5] = 0; await frame(); // RB
  raw.axes[6] = -32767; await frame(); raw.axes[6] = 0; await frame();  // d-pad left
  const after = robot.getSnapshot().settings;
  assert.equal(after.speed, Math.round((before.speed + 0.1) * 100) / 100);
  assert.equal(after.lift, before.lift + 2);
  assert.equal(after.hipSwing, before.hipSwing - 2);
});

test('each button action is reported to onAction (for the Live View)', () => {
  const calls = [], actions = [];
  const robot = {getSnapshot: () => ({connection: 'online', live: {active: true}, busy: false}),
    enable: () => calls.push('enable'), stopWalk: () => calls.push('stopWalk'), stop: () => calls.push('stop'),
    nudge: () => calls.push('nudge'), posture: id => calls.push(id), release: () => {}, drive: () => {}};
  const raw = {connected: true, axes: [0, 0, -32767, 0, 0, -32767, 0, 0], buttons: [0, 0, 0, 0, 0, 0, 0]};
  let time = 0;
  const step = createDriveLoop({robot, readPads: () => [toStandardPad(raw, DEFAULT_MAP)], now: () => time, onAction: a => actions.push(a)});
  step();                                  // controller found, nothing held
  raw.buttons[3] = 1; time += 20; step();  // Y
  raw.buttons[3] = 0; time += 20; step();
  raw.buttons[1] = 1; time += 20; step();  // B
  assert.deepEqual(actions, ['stand', 'stopWalk']);
  assert.deepEqual(calls, ['stand', 'stopWalk'], 'the robot still gets the same commands');
});

test('a failing Live View cannot block a button, including motors off', () => {
  const calls = [];
  const robot = {getSnapshot: () => ({connection: 'online', live: {active: true}, busy: false}),
    stop: () => calls.push('stop'), stopWalk: () => {}, enable: () => {}, nudge: () => {}, posture: () => {}, release: () => {}, drive: () => {}};
  const raw = {connected: true, axes: [0, 0, -32767, 0, 0, -32767, 0, 0], buttons: [0, 0, 0, 0, 0, 0, 0]};
  let time = 0;
  const step = createDriveLoop({robot, readPads: () => [toStandardPad(raw, DEFAULT_MAP)], now: () => time, onAction: () => { throw new Error('display broke'); }});
  step();
  raw.buttons[6] = 1; time += 20;          // View
  assert.doesNotThrow(step);
  assert.deepEqual(calls, ['stop'], 'the motors still switch off');
});

test('Menu cycles the gait; while walking the robot blends into it', async () => {
  const {robot, raw, sent, frame, settle, advance} = await setup();
  const MENU_RAW = DEFAULT_MAP.buttons.menu;
  const press = async () => { raw.buttons[MENU_RAW] = 1; await frame(); raw.buttons[MENU_RAW] = 0; await frame(); };
  assert.equal(robot.getSnapshot().settings.gait, 'ripple');
  await press();                                                   // standing: changes the next walk
  assert.equal(robot.getSnapshot().settings.gait, 'wave');
  assert.match(robot.getSnapshot().message.text, /Gait: Wave/);
  raw.buttons[0] = 1; await frame(); raw.buttons[0] = 0; await frame();   // A: enable
  advance(1000); await robot.poll(); await settle();                     // legs reach the home stance
  raw.axes[1] = -32767; await frame();                                   // walk forward
  assert.equal(sent.find(s => s.op === 'walk').gait, 'wave', 'the walk starts in the chosen gait');
  advance(500); await robot.poll(); await settle();
  assert.equal(robot.getSnapshot().live.walking.gait, 'wave');
  await press();                                                   // walking: blend into tripod
  assert.equal(robot.getSnapshot().settings.gait, 'tripod');
  assert.ok(sent.some(c => c.op === 'walk' && c.gait === 'tripod'), 'the board is asked to blend');
});

test('a Menu button held when the controller connects is ignored', () => {
  const settings = [];
  const robot = {getSnapshot: () => ({connection: 'online', live: {active: true}, settings: {gait: 'ripple'}}),
    setSettings: p => settings.push(p.gait), say: () => {}, release: () => {}, drive: () => {}};
  const raw = {connected: true, axes: [0, 0, -32767, 0, 0, -32767, 0, 0], buttons: [0, 0, 0, 0, 0, 0, 0, 1]};
  let time = 0;
  const step = createDriveLoop({robot, readPads: () => [toStandardPad(raw, DEFAULT_MAP)], now: () => time});
  step(); time += 20; step();
  assert.deepEqual(settings, [], 'held from the start: not a press');
  raw.buttons[7] = 0; time += 20; step(); raw.buttons[7] = 1; time += 20; step();
  assert.deepEqual(settings, ['wave']);
});

test('Menu reports whether the new gait blends now or waits for the next walk', () => {
  const details = [];
  let walking = {gait: 'ripple', stopping: false};
  const robot = {getSnapshot: () => ({connection: 'online', live: {active: true, walking}, settings: {gait: 'ripple'}}),
    setSettings: () => {}, say: () => {}, release: () => {}, drive: () => {}};
  const raw = {connected: true, axes: [0, 0, -32767, 0, 0, -32767, 0, 0], buttons: [0, 0, 0, 0, 0, 0, 0, 0]};
  let time = 0;
  const step = createDriveLoop({robot, readPads: () => [toStandardPad(raw, DEFAULT_MAP)], now: () => time, onAction: (a, d) => details.push(d)});
  const press = () => { raw.buttons[7] = 1; time += 20; step(); raw.buttons[7] = 0; time += 20; step(); };
  step();
  press();                                   // walking
  walking = {gait: 'ripple', stopping: true}; press();   // finishing the last step
  walking = null; press();                   // standing
  assert.deepEqual(details.map(d => d.blend), [true, false, false]);
  assert.deepEqual(details.map(d => d.gait), ['wave', 'wave', 'wave'], 'next after ripple each time (settings unchanged by the fake)');
});
