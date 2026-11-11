import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLiveServer, robotView, padView, onHotspot} from '../src/live-server.js';
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

test('battery history: at most one sample a second, kept for new viewers', async () => {
  let clock = 0;
  const live = await new Promise(resolve => { const l = createLiveServer({root: ROOT, port: 0, host: '127.0.0.1', now: () => clock}); l.server.on('listening', () => resolve(l)); });
  try {
    const at = (t, v) => { clock = t; live.robot({...snapshot, live: {...snapshot.live, power: {voltage: v, current: 1.2}}}); };
    at(0, 7.4); at(300, 7.3); at(999, 7.2); at(1000, 7.1); at(2500, 7.0);
    const events = listen(live.server.address().port, 1);
    const [hello] = await events;
    assert.deepEqual(hello.data.power.map(p => p.v), [7.4, 7.1, 7.0]);
    assert.equal(hello.data.power[0].w, 1, 'marked as walking');
  } finally { await live.close(); }
});

test('the message inspector sees each command and reply, and does not change them', async () => {
  const {live, port} = await start();
  try {
    const sent = [];
    const listeners = new Set();
    const robot = {link: {send: (op, args) => { sent.push([op, args]); return Promise.resolve({ok: true, positions: [[1.23, 175, 70]], calibration: {x: 1}}); }},
      subscribe: fn => listeners.add(fn)};
    live.watchLink(robot);
    const events = listen(port, 2);
    await new Promise(r => setTimeout(r, 50));
    const reply = await robot.link.send('walk', {direction: [1, 0, 0]});
    assert.deepEqual(sent, [['walk', {direction: [1, 0, 0]}]], 'the board gets exactly what was sent');
    assert.equal(reply.calibration.x, 1, 'the robot gets the full reply');
    live.watchLink(robot); for (const fn of listeners) fn();            // watching twice must not wrap twice
    const [, batch] = await events;
    assert.equal(batch.type, 'msgs');
    assert.deepEqual(batch.data.map(m => [m.dir, m.op]), [['out', 'walk'], ['in', 'walk']]);
    assert.equal(batch.data[0].text, '{"op":"walk","direction":[1,0,0]}');
    assert.equal(batch.data[1].text, '{"ok":true,"positions":[[1.2,175,70]]}', 'rounded, calibration left out');
  } finally { await live.close(); }
});

test('/info shows the hotspot password only to devices on the hotspot', async () => {
  const fs = await import('node:fs'), os = await import('node:os');
  const conf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hexapod-')), 'wifi.conf');
  fs.writeFileSync(conf, 'MODE=auto\nHOTSPOT_SSID=Hexapod-1234\nHOTSPOT_PASSWORD="secret-pass"\n');
  const make = list => new Promise(resolve => { const l = createLiveServer({root: ROOT, port: 0, host: '127.0.0.1', wifiConf: conf, addresses: () => list, hostname: () => 'hexapod'}); l.server.on('listening', () => resolve(l)); });
  const info = async l => JSON.parse((await get(l.server.address().port, '/info')).body);
  let live = await make([{name: 'wlan0', ip: '10.42.0.1'}]);
  try {
    const i = await info(live);   // the test connects from 127.0.0.1, treated like the robot itself
    assert.deepEqual(i.hotspot, {active: true, ssid: 'Hexapod-1234', password: 'secret-pass'});
    assert.equal(i.hostname, 'hexapod');
  } finally { await live.close(); }
  live = await make([{name: 'wlan0', ip: '192.168.20.28'}]);
  try {
    const i = await info(live);
    assert.equal(i.hotspot.active, false);
    assert.equal(i.hotspot.password, null, 'not on the hotspot: never sent');
    assert.deepEqual(i.addresses, ['192.168.20.28']);
  } finally { await live.close(); }
});

test('which devices count as being on the hotspot', () => {
  for (const a of ['10.42.0.23', '::ffff:10.42.0.99', '127.0.0.1', '::1']) assert.equal(onHotspot(a), true, a);
  for (const a of ['192.168.20.5', '::ffff:192.168.20.27', '10.42.1.5', '110.42.0.5', '', undefined]) assert.equal(onHotspot(a), false, String(a));
});
