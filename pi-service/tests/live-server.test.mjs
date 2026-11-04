import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLiveServer, robotView, padView} from '../src/live-server.js';
import {BUTTONS} from '../vendor/controller/src/gamepad.js';
import {toStandardPad, DEFAULT_MAP} from '../src/linux-gamepad.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'live');

function start() {
  return new Promise(resolve => {
    const live = createLiveServer({root: ROOT, port: 0, host: '127.0.0.1', log: () => {}});
    live.server.on('listening', () => resolve({live, port: live.server.address().port}));
  });
}
// Raw request (no URL normalising), so odd paths reach the server exactly as sent.
function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, path: rawPath, method: 'GET'}, res => {
      let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({status: res.statusCode, type: res.headers['content-type'], body}));
    });
    req.on('error', reject); req.end();
  });
}
// Collects Server-Sent Events until `count` have arrived.
function listen(port, count) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get({host: '127.0.0.1', port, path: '/events'}, res => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, at); buffer = buffer.slice(at + 2);
          const type = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
          if (type) events.push({type, data: JSON.parse(data)});
          if (events.length >= count) { req.destroy(); resolve(events); }
        }
      });
    });
    req.on('error', error => { if (events.length < count) reject(error); });
  });
}
const snapshot = {connection: 'online', message: {text: 'Ready', error: false}, settings: {gait: 'ripple', speed: 0.7, lift: 20, hipSwing: 15},
  live: {active: true, moving: true, positions: [[1.234, 175.06, 70]], angles: [[-12.345, 40.01, 9.99]], power: {voltage: 6.1, current: 0.8},
    walking: {gait: 'ripple', target: [1, 0, 0], direction: [1, 0, 0], stopping: false, blending: false, cycle: 0.3}, offsets: [[0, 0, 0]], calibration: {}}};

test('robot view keeps what the page needs, rounded, and drops the rest', () => {
  const view = robotView(snapshot);
  assert.deepEqual(view.live.positions, [[1.2, 175.1, 70]]);
  assert.deepEqual(view.live.angles, [[-12.3, 40, 10]]);
  assert.equal(view.live.walking.gait, 'ripple');
  assert.equal(view.live.offsets, undefined, 'calibration details are not sent');
  assert.equal(robotView({...snapshot, connection: 'offline', live: null}).live, null);
});

test('pad view lists held buttons and the four stick axes', () => {
  const raw = {connected: true, axes: [0, -32767, -32767, 16384, 0, -32767, 0, -32767], buttons: [1, 0, 0, 0, 0, 1, 0]};
  const view = padView(toStandardPad(raw, DEFAULT_MAP, 'Xbox'), BUTTONS);
  assert.deepEqual(view.axes, [0, -1, 0.5, 0]);
  assert.deepEqual(view.held.sort(), ['a', 'rb', 'up']);
  assert.deepEqual(padView(null, BUTTONS), {connected: false});
});

test('serves the page, refuses other files, and survives bad requests', async () => {
  const {live, port} = await start();
  try {
    assert.equal((await get(port, '/')).status, 200);
    assert.match((await get(port, '/app.js')).type, /javascript/);
    assert.equal((await get(port, '/../src/main.js')).status, 404);
    assert.equal((await get(port, '/%2e%2e/%2e%2e/package.json')).status, 404);
    assert.equal((await get(port, '//')).status, 200, 'a leading double slash once crashed the service');
    assert.equal((await get(port, '/%E0%A4%A')).status, 400);
    assert.equal((await get(port, '/app.js')).status, 200, 'still serving after bad requests');
  } finally { await live.close(); }
});

test('a new viewer gets the current state, then live updates', async () => {
  const {live, port} = await start();
  try {
    live.robot(snapshot);
    live.log('Hello class');
    const events = listen(port, 5);
    await new Promise(r => setTimeout(r, 50));
    live.pad(toStandardPad({connected: true, axes: [0, 0, -32767, 0, 0, -32767, 0, 0], buttons: [1, 0, 0, 0, 0, 0, 0]}, DEFAULT_MAP), BUTTONS);
    live.action('enable');
    live.robot({...snapshot, live: {...snapshot.live, active: false}});
    live.log('ERROR Board link lost', true);
    const got = await events;
    assert.equal(got[0].type, 'hello');
    assert.equal(got[0].data.robot.live.active, true);
    assert.deepEqual(got[0].data.log.map(e => e.text), ['Hello class']);
    const by = type => got.find(e => e.type === type)?.data;
    assert.deepEqual(by('pad').held, ['a']);
    assert.equal(by('action').action, 'enable');
    assert.equal(by('robot').live.active, false);
    assert.equal(by('log').error, true);
  } finally { await live.close(); }
});

test('unchanged controller state is not re-sent', async () => {
  const {live, port} = await start();
  try {
    const events = listen(port, 3);
    await new Promise(r => setTimeout(r, 50));
    const pad = toStandardPad({connected: true, axes: [0, 0, -32767, 0, 0, -32767, 0, 0], buttons: [0, 0, 0, 0, 0, 0, 0]}, DEFAULT_MAP);
    for (let i = 0; i < 20; i++) live.pad(pad, BUTTONS);   // the drive loop calls this 50 times a second
    await new Promise(r => setTimeout(r, 120));
    live.log('end');
    const got = await events;
    assert.deepEqual(got.map(e => e.type), ['hello', 'pad', 'log']);
  } finally { await live.close(); }
});

test('the Live View never throws into the driving service', async () => {
  const {live} = await start();
  try {
    assert.doesNotThrow(() => live.robot(null));                    // a broken snapshot
    assert.doesNotThrow(() => live.pad({axes: null, buttons: 5}, null));
    assert.doesNotThrow(() => live.log(undefined));
  } finally { await live.close(); }
});

test('a viewer that stops reading is dropped instead of filling memory', async () => {
  const {live, port} = await start();
  try {
    // A client that connects and never reads (like a laptop that went to sleep).
    const net = await import('node:net');
    const socket = net.connect(port, '127.0.0.1');
    socket.write('GET /events HTTP/1.1\r\nHost: x\r\n\r\n');
    socket.pause();
    await new Promise(r => setTimeout(r, 100));
    assert.equal(live.viewers, 1);
    const big = 'x'.repeat(16 * 1024);
    for (let i = 0; i < 400 && live.viewers; i++) { live.log(big); await new Promise(r => setImmediate(r)); }
    assert.equal(live.viewers, 0, 'dropped once its backlog passed the limit');
    socket.destroy();
  } finally { await live.close(); }
});
