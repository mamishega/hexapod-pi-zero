// Health and Servo care: servo statistics, Pi readings, events and alerts, and the page helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {ServoStats, createHealth, parseThrottled, parseWireless, batteryState, wifiText, findPadBattery, NEAR_DEG} from '../src/health.js';
import {createLiveServer} from '../src/live-server.js';
import {careChecks, healthTiles, duration, travel, renderAlerts} from '../live/health-view.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'live');
const angles = (hip = 0, upper = 30, knee = 20) => Array.from({length: 6}, () => [hip, upper, knee]);
const live = (a, extra = {}) => ({active: true, angles: a, joint_limits: [[-80, 80], [-90, 90], [-90, 90]], offsets: Array.from({length: 6}, () => [0, 0, 0]), released: [], ...extra});

test('servo stats add up movement and active time, and ignore jumps and gaps', () => {
  const s = new ServoStats();
  s.update(live(angles(0)), 0);
  s.update(live(angles(10)), 200);
  s.update(live(angles(-5)), 400);
  s.update(live(angles(85)), 600);      // 90 degree jump: a re-enable, not movement
  s.update(live(angles(80)), 5000);     // 4.4 s gap: link lost, not counted
  const hip = s.rows()[0];
  assert.equal(hip.session.travel, 25, '10 + 15 degrees');
  assert.equal(s.summary().session.activeSec, 1, '0.6 s of counted time, rounded');
  assert.equal(hip.min, -5); assert.equal(hip.max, 85);
  s.update({...live(angles(0)), active: false}, 5200);
  s.update(live(angles(40)), 5400);     // first update after the motors come back: no step from 0
  assert.equal(s.rows()[0].session.travel, 25);
});

test('servo stats: usable range, near-limit time, hits, offsets and released legs', () => {
  const s = new ServoStats({servoRange: 90});
  assert.deepEqual(s.range(0), [-90, 90], "before the board reports limits: the servo travel");
  s.update(live(angles(0)), 0);
  assert.deepEqual(s.range(0), [-80, 80], 'the board limit inside the servo travel');
  s.update(live(angles(75)), 100);      // within 10 degrees of the hip's 80 degree limit
  s.update(live(angles(76)), 200);
  s.update(live(angles(0)), 300);
  s.update(live(angles(79)), 400);
  const hip = s.rows()[0];
  assert.equal(hip.session.hits, 2, 'two separate visits to the end of travel');
  assert.equal(hip.flags.includes('near-limit'), true);
  assert.equal(hip.margin, 1);
  assert.equal(s.rows()[1].flags.includes('near-limit'), false, 'upper leg at 30 degrees is fine');
  const offsets = Array.from({length: 6}, () => [0, 0, 0]); offsets[4][2] = -28; offsets[4][1] = 20;
  s.update(live(angles(0), {offsets, released: [2]}), 500);
  const rows = s.rows();
  assert.deepEqual(rows[14].flags, ['large-offset'], 'R2 knee (output 15) offset of -28 degrees');
  assert.deepEqual(rows[13].flags, [], 'an offset of 20 degrees is normal');
  assert.equal(rows[6].flags.includes('released'), true, 'L3 released');
  assert.equal(rows[14].output, 15); assert.equal(rows[14].leg, 'R2'); assert.equal(rows[14].joint, 'knee');
  assert.equal(NEAR_DEG, 10);
});

test('lifetime servo totals are saved and read back; the session starts from zero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexapod-stats-')), file = path.join(dir, 'sub', 'servo-stats.json');
  const a = new ServoStats({file});
  a.update(live(angles(0)), 0); a.update(live(angles(20)), 500);
  a.save();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.format, 'hexapod-servo-stats'); assert.equal(saved.servos[0].travel, 20);
  const b = new ServoStats({file});
  assert.equal(b.rows()[0].lifetime.travel, 20);
  assert.equal(b.rows()[0].session.travel, 0);
  b.update(live(angles(0)), 0); b.update(live(angles(5)), 100);
  assert.equal(b.rows()[0].lifetime.travel, 25);
  fs.writeFileSync(file, 'not json');
  assert.equal(new ServoStats({file}).rows()[0].lifetime.travel, 0, 'a damaged file starts again from zero');
  fs.rmSync(dir, {recursive: true, force: true});
});

test('Pi readings: throttled flags, Wi-Fi signal, battery state, controller battery', () => {
  assert.deepEqual(parseThrottled('throttled=0x0').underVoltage, false);
  const t = parseThrottled('throttled=0x50005');
  assert.equal(t.underVoltage, true); assert.equal(t.throttled, true); assert.equal(t.underVoltageSeen, true); assert.equal(t.throttledSeen, true); assert.equal(t.softTemp, false);
  assert.equal(parseThrottled(''), null); assert.equal(parseThrottled(null), null);
  const wireless = 'Inter-| sta-|   Quality        |   Discarded packets\n face | tus | link level noise |  nwid  crypt\n wlan0: 0000   57.  -53.  -256        0      0\n';
  assert.deepEqual(parseWireless(wireless), {iface: 'wlan0', quality: 57, dbm: -53});
  assert.equal(parseWireless('Inter-| sta-|\n face | tus |\n'), null);
  assert.equal(wifiText(-55), 'strong'); assert.equal(wifiText(-74), 'weak'); assert.equal(wifiText(null), null);
  const th = {low: 7.0, critical: 6.6};
  assert.equal(batteryState(7.4, th), 'ok'); assert.equal(batteryState(6.9, th), 'low'); assert.equal(batteryState(6.5, th), 'critical'); assert.equal(batteryState(NaN, th), null);
  const files = {'/ps': ['AC', 'xpadneo-battery'], '/ps/AC/model_name': 'Mains', '/ps/xpadneo-battery/model_name': 'Xbox Wireless Controller', '/ps/xpadneo-battery/capacity_level': 'Normal', '/ps/xpadneo-battery/status': 'Discharging'};
  const fake = {readdirSync: d => files[d], readFileSync: f => { if (!(f in files)) throw new Error('no'); return files[f]; }};
  assert.deepEqual(findPadBattery('/ps', fake), {level: 'Normal', percent: null, status: 'Discharging'});
  assert.equal(findPadBattery('/missing', fake), null);
});

test('health events and alerts: controller drops, board link, watchdog, battery, servos at a limit', async () => {
  let t = 1000;
  const h = createHealth({now: () => t, battery: {low: 7.0, critical: 6.6}});
  const snap = (extra = {}, liveExtra = {}) => ({connection: 'online', message: {text: 'Walking'}, ...extra, live: {...live(angles(0)), power: {voltage: 7.5, current: 1}, ...liveExtra}});
  h.robot(snap());
  h.pad(true); t += 5000;
  h.pad(false);
  assert.match(h.snapshot().events[0].text, /disconnected while the motors were on/);
  assert.equal(h.snapshot().events[0].level, 'bad');
  t += 4000; h.pad(true);
  assert.match(h.snapshot().events[0].text, /reconnected after 4 s/);
  assert.equal(h.snapshot().controller.drops, 1);
  h.robot(snap({message: {text: 'Connection timeout: the board disabled the motors.'}}));
  assert.match(h.snapshot().events[0].text, /Watchdog/);
  h.robot(snap({connection: 'offline'}));
  assert.match(h.snapshot().events[0].text, /link lost/);
  assert.ok(h.alerts().some(a => /link offline/.test(a.text)));
  h.robot(snap({}, {power: {voltage: 6.9, current: 2}}));
  assert.equal(h.snapshot().battery.state, 'low');
  assert.ok(h.snapshot().events.some(e => /Battery low: 6.90 V/.test(e.text)));
  h.robot(snap({}, {power: {voltage: 6.5}, angles: angles(78)}));
  const alerts = h.alerts();
  assert.equal(alerts[0].level, 'bad'); assert.match(alerts[0].text, /Battery critical/);
  assert.ok(alerts.some(a => /6 servos at the end of travel/.test(a.text)));
  h.reply(12); h.reply(30); h.reply(500, false, true);
  const b = h.snapshot().board;
  assert.deepEqual([b.replies, b.errors, b.timeouts, b.replyMs.max], [3, 1, 1, 500]);
  assert.equal(h.snapshot().battery.min, 6.5);
});

test('a Servo 2040 restart (its uptime falls back) is an event, not silence', () => {
  let t = 0;
  const seen = [];
  const h = createHealth({now: () => t, onEvent: e => { seen.push(e.text); }});
  const snap = (up, extra = {}) => ({connection: 'online', message: {text: ''}, live: {...live(angles(0)), uptime_ms: up, ...extra}});
  h.robot(snap(50000)); t += 200; h.robot(snap(50200)); t += 200; h.robot(snap(50400));
  assert.equal(h.snapshot().board.restarts, 0, 'uptime rising: no restart');
  t += 200; h.robot(snap(900, {active: false, reset_cause: 'power-on or supply dip'}));
  assert.equal(h.snapshot().board.restarts, 1);
  assert.match(h.snapshot().events[0].text, /Servo 2040 restarted \(power-on or supply dip\)/);
  assert.equal(h.snapshot().events[0].level, 'bad');
  assert.ok(seen.some(text => text.startsWith('Servo 2040 restarted')), 'passed on (main.js logs it)');
  // A link drop and reconnect is not a restart unless the uptime fell back while connected.
  h.robot({connection: 'offline', message: {text: ''}, live: null});
  h.robot(snap(400)); t += 200; h.robot(snap(600));
  assert.equal(h.snapshot().board.restarts, 1, 'first reading after reconnecting is the new baseline');
  // Board files without uptime_ms (older, or the demo simulator): nothing to compare.
  h.robot(snap(undefined)); h.robot(snap(undefined));
  assert.equal(h.snapshot().board.restarts, 1);
});

test('simulated health (demo) has plausible Pi readings', async () => {
  const h = createHealth({simulated: true});
  h.pad(true); await h.sample();
  const s = h.snapshot();
  assert.equal(s.simulated, true); assert.ok(s.pi.temp > 40 && s.pi.temp < 55); assert.equal(s.pi.throttled.underVoltage, false);
  assert.equal(s.controller.battery.level, 'High'); assert.equal(s.servos.rows.length, 18);
});

test('page helpers: durations, travel, checks, tiles and the banner', () => {
  assert.equal(duration(42), '42 s'); assert.equal(duration(600), '10 min'); assert.equal(duration(3900), '1 h 5 min'); assert.equal(duration(-1), '—');
  assert.equal(travel(840), '840°'); assert.equal(travel(12400), '12.4k°'); assert.equal(travel(null), '—');
  const s = new ServoStats(); const offsets = Array.from({length: 6}, () => [0, 0, 0]); offsets[0][0] = 30;
  s.update(live(angles(79), {offsets}), 0);
  const checks = careChecks(s.summary());
  assert.ok(checks.some(c => /L1 hip \(output 1\): at the end of its travel/.test(c.text)));
  assert.ok(checks.some(c => /large calibration offset.*\(\+30°\)/.test(c.text)));
  const h = createHealth({now: () => 0}); h.robot({connection: 'online', message: {text: ''}, live: {...live(angles(0)), power: {voltage: 7.4, current: 0.5}}});
  const html = healthTiles(h.snapshot(), 0);
  assert.match(html, /7\.40 V · 0\.50 A/); assert.match(html, /Servo 2040 link/);
  const el = () => ({hidden: false, dataset: {}, textContent: ''}), bar = el(), text = el(), count = el();
  renderAlerts({alerts: [{level: 'warn', text: 'A'}, {level: 'bad', text: 'B'}]}, bar, text, count);
  assert.deepEqual([bar.hidden, bar.dataset.level, text.textContent, count.textContent], [false, 'bad', 'A  (+1 more)', '2']);
  renderAlerts({alerts: []}, bar, text, count);
  assert.equal(bar.hidden, true);
});

test('the Live View sends health in its first message, and times board replies', async () => {
  const h = createHealth({simulated: true});
  const liveServer = createLiveServer({root: ROOT, port: 0, host: '127.0.0.1', log: () => {}, health: h});
  await new Promise(r => liveServer.server.on('listening', r));
  const robot = {link: {send: async () => ({ok: true})}, subscribe() {}};
  liveServer.watchLink(robot);
  await robot.link.send('status');
  liveServer.robot({connection: 'online', message: {text: 'x'}, settings: {}, live: live(angles(5))});
  const hello = await new Promise((resolve, reject) => {
    const req = http.get({host: '127.0.0.1', port: liveServer.server.address().port, path: '/events'}, res => {
      let buffer = '';
      res.on('data', c => { buffer += c; const m = /event: hello\ndata: (.*)\n\n/.exec(buffer); if (m) { req.destroy(); resolve(JSON.parse(m[1])); } });
    });
    req.on('error', reject);
  });
  assert.equal(hello.health.board.replies, 1);
  assert.equal(hello.health.servos.rows[0].angle, 5);
  assert.equal(hello.health.simulated, true);
  await liveServer.close();
});
