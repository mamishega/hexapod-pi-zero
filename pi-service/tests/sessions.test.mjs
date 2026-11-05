// Session recorder, battery runtime and gait scores, follow-the-teacher, version, and their web routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createRecorder, CSV_HEADER} from '../src/recorder.js';
import {createInsights, runtime, slope, scoreRows} from '../src/insights.js';
import {createClassroom, teacherCode} from '../src/classroom.js';
import {readVersion} from '../src/version.js';
import {createLiveServer} from '../src/live-server.js';
import {DEFAULT_POSE} from '../live/motion-geometry.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'live');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hexapod-'));
const pose = () => DEFAULT_POSE.map(p => p.slice());
const snap = ({active = true, walking = null, v = 7.4, a = 1.5} = {}) => ({connection: 'online', message: {text: ''}, settings: {gait: 'ripple', speed: 0.7, lift: 20, hipSwing: 15},
  live: {active, positions: pose(), angles: Array.from({length: 6}, () => [0, 30, 20]), power: {voltage: v, current: a}, walking}});

test('battery runtime: from the voltage trend, after 3 minutes, and not when steady', () => {
  const pts = Array.from({length: 31}, (_, i) => ({t: i * 10000, v: 7.6 - i * 10000 / 60000 * 0.04}));  // falling 0.04 V a minute for 5 min
  assert.ok(Math.abs(slope(pts) + 0.04) < 1e-9);
  const r = runtime(pts, 7.0, 300000);
  assert.equal(r.reason, 'trend'); assert.equal(r.minutes, 10, '(7.4 - 7.0) / 0.04'); assert.equal(r.basedOnMinutes, 5);
  assert.equal(runtime(pts.slice(0, 10), 7.0, 90000).reason, 'collecting');
  assert.equal(runtime(Array.from({length: 31}, (_, i) => ({t: i * 10000, v: 7.5})), 7.0, 300000).reason, 'steady');
  assert.equal(runtime([{t: 0, v: 6.9}, {t: 200000, v: 6.9}, {t: 300000, v: 6.9}], 7.0, 300000).reason, 'low');
});

test('gait scores: stability, speed and battery use; short walks are not scored', () => {
  const rows = scoreRows([
    {gait: 'tripod', speed: 1, lift: 20, hipSwing: 15, ms: 60000, distance: 12000, ampMs: 150000, marginSum: 40 * 100, marginN: 100, stableN: 100, minMargin: 20},
    {gait: 'wave', speed: 1, lift: 20, hipSwing: 15, ms: 60000, distance: 6000, ampMs: 100000, marginSum: 80 * 100, marginN: 100, stableN: 100, minMargin: 60},
    {gait: 'ripple', speed: 1, lift: 20, hipSwing: 15, ms: 5000, distance: 900, ampMs: 10000, marginSum: 600, marginN: 10, stableN: 10, minMargin: 50},
  ]);
  const by = g => rows.find(r => r.gait === g);
  assert.deepEqual(by('wave').parts, {stability: 50, speed: 15, efficiency: 15});
  assert.deepEqual(by('tripod').parts, {stability: 25, speed: 30, efficiency: 20});
  assert.equal(by('ripple').score, null, 'only 5 s: not scored'); assert.equal(by('ripple').scored, false);
  assert.equal(rows[0].gait, 'wave', 'best first'); assert.equal(by('tripod').mmPerSecond, 200); assert.equal(by('tripod').metresPerAh, 288);
});

test('insights: battery use by activity, saved and read back', () => {
  let t = 0; const dir = tmp(), file = path.join(dir, 'insights.json');
  const ins = createInsights({file, now: () => t, battery: {low: 7.0, capacityMah: 2000}});
  for (; t <= 10000; t += 500) ins.robot(snap({walking: {gait: 'tripod', cycle: 0.1, period: 1000}, a: 2}));
  for (; t <= 20000; t += 500) ins.robot(snap({a: 0.5}));
  const use = ins.battery().usage;
  assert.deepEqual(use.map(u => u.state), ['tripod', 'standing']);
  assert.equal(use[0].avgCurrent, 2); assert.equal(use[0].fullBatteryMinutes, 48, '2000 mAh x 80 % / 2 A');
  assert.equal(ins.gaits()[0].gait, 'tripod');
  ins.save();
  const again = createInsights({file, now: () => t, battery: {capacityMah: 2000}});
  assert.equal(again.battery().usage.length, 2);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('recorder: sessions with CSV rows and a summary; short ones are dropped', () => {
  let t = Date.UTC(2026, 10, 5, 9, 0, 0); const dir = tmp();
  const rec = createRecorder({dir, now: () => t});
  rec.pad(true);
  for (let i = 0; i < 100; i++, t += 100) rec.robot(snap({walking: i > 20 ? {gait: 'wave', cycle: i / 100, period: 1400} : null, v: 7.5 - i * 0.001}));
  assert.equal(rec.sessions()[0].current, true);
  for (let i = 0; i < 400; i++, t += 100) rec.robot(snap({active: false}));  // 40 s with the motors off
  const [s] = rec.sessions();
  assert.equal(s.current, undefined); assert.equal(s.seconds, 10); assert.deepEqual(s.gaits, ['wave']); assert.equal(s.minVoltage, 7.4);
  const csv = rec.csv(s.id).trim().split('\n');
  assert.equal(csv[0], CSV_HEADER); assert.equal(csv.length, 21, 'header + 2 rows a second for 10 s');
  assert.equal(csv[1].split(',').length, CSV_HEADER.split(',').length);
  assert.equal(rec.csv('../../etc/passwd'), null);
  // A 2-second session is not kept
  for (let i = 0; i < 20; i++, t += 100) rec.robot(snap());
  for (let i = 0; i < 400; i++, t += 100) rec.robot(snap({active: false}));
  assert.equal(rec.sessions().length, 1);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('recorder: incidents keep 30 s before and 5 s after, then appear in the list', () => {
  let t = 1e12; const rec = createRecorder({now: () => t}); // no folder: kept in memory (the demo)
  for (let i = 0; i < 400; i++, t += 100) rec.robot(snap());
  const id = rec.event({t, level: 'bad', text: 'Controller disconnected while the motors were on'});
  assert.match(id, /^[0-9]{8}-[0-9]{6}-[a-z0-9]+$/);
  assert.equal(rec.event({t, level: 'warn', text: 'minor'}), null, 'only serious events');
  assert.equal(rec.incidents()[0].saving, true);
  for (let i = 0; i < 60; i++, t += 100) rec.robot(snap());
  const inc = rec.incident(id);
  assert.equal(inc.saving, undefined); assert.equal(inc.text, 'Controller disconnected while the motors were on');
  assert.ok(inc.frames.length >= 300 && inc.frames.length <= 360, `${inc.frames.length} frames`);
  assert.ok(inc.frames[0].t >= inc.t - 30000 && inc.frames.at(-1).t >= inc.t + 5000);
  assert.equal(rec.incident('nope'), null);
});

test('recorder: old sessions are deleted over the size limit', () => {
  let t = Date.UTC(2026, 10, 5, 9, 0, 0); const dir = tmp();
  const rec = createRecorder({dir, now: () => t, maxBytes: 3000});
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 80; i++, t += 100) rec.robot(snap());
    for (let i = 0; i < 400; i++, t += 100) rec.robot(snap({active: false}));
    t += 1000;
  }
  const list = rec.sessions();
  assert.ok(list.length < 3, `${list.length} sessions kept`);
  assert.equal(fs.readdirSync(path.join(dir, 'sessions')).filter(f => f.endsWith('.csv')).length, list.length);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('classroom: teacher code, following, questions and anonymous answers', () => {
  const room = createClassroom({code: '482913'});
  assert.equal(room.login('000000'), null); assert.equal(room.login(''), null);
  const token = room.login('482913');
  assert.ok(token);
  assert.equal(room.setFollow('stolen', {active: true}), false);
  assert.equal(room.setFollow(token, {active: true, page: 'servos', view: 'top', lesson: 'walking', step: 1, question: 'walking-tripod'}), true);
  assert.deepEqual([room.follow.page, room.follow.view, room.follow.step, room.follow.reveal], ['servos', 'top', 1, false]);
  room.setFollow(token, {page: '<script>', view: 'nope'});
  assert.deepEqual([room.follow.page, room.follow.view], ['servos', 'top'], 'unknown values are ignored');
  assert.equal(room.answer('device-aaaa', 'walking-tripod', 1), true);
  assert.equal(room.answer('device-bbbb', 'walking-tripod', 3), true);
  assert.equal(room.answer('device-aaaa', 'walking-tripod', 2), true, 'a device can change its answer');
  assert.equal(room.answer('device-cccc', 'other-question', 0), false, 'only the question on show');
  assert.equal(room.answer('x', 'walking-tripod', 0), false, 'bad client id');
  assert.deepEqual(room.tally().counts.slice(0, 4), [0, 0, 1, 1]); assert.equal(room.tally().total, 2);
  room.setFollow(token, {reveal: true}); assert.equal(room.follow.reveal, true);
  room.setFollow(token, {question: 'walking-stable'}); assert.equal(room.follow.reveal, false, 'a new question starts hidden');
  assert.equal(room.clearAnswers('stolen', 'walking-tripod'), false);
  assert.equal(room.clearAnswers(token, 'walking-tripod'), true); assert.equal(room.tally('walking-tripod').total, 0);
});

test('teacher code and version files', () => {
  const dir = tmp(), file = path.join(dir, 'teacher-code');
  assert.equal(teacherCode({code: '2468', file}), '2468');
  const fresh = teacherCode({code: '', file});
  assert.match(fresh, /^\d{6}$/); assert.equal(teacherCode({code: undefined, file}), fresh, 'saved and reused');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600', 'only the robot user can read it');
  assert.match(readVersion(dir), /^unknown$/);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"version": "0.3.0"}');
  assert.equal(readVersion(dir), '0.3.0 (development copy)');
  fs.writeFileSync(path.join(dir, 'VERSION'), 'abc1234 · 5 Nov 2026 17:30\n');
  assert.equal(readVersion(dir), 'abc1234 · 5 Nov 2026 17:30');
  fs.rmSync(dir, {recursive: true, force: true});
});

// ---------------------------------------------------------------- web routes
function request(port, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({host: '127.0.0.1', port, path: url, method, headers: {...(data ? {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data)} : {}), ...headers}}, res => {
      let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({status: res.statusCode, type: res.headers['content-type'], text, json: (() => { try { return JSON.parse(text); } catch { return null; } })()}));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

test('web routes: status, sessions, CSV, incidents, teacher and answers (with limits)', async () => {
  let t = Date.UTC(2026, 10, 5, 10, 0, 0);
  const recorder = createRecorder({now: () => t}), classroom = createClassroom({code: '1357'});
  const live = createLiveServer({root: ROOT, port: 0, host: '127.0.0.1', log: () => {}, recorder, insights: createInsights(), classroom, version: 'test 1'});
  await new Promise(r => live.server.on('listening', r));
  const port = live.server.address().port;
  try {
  for (let i = 0; i < 30; i++, t += 100) live.robot(snap());
  const status = await request(port, 'GET', '/status');
  assert.deepEqual(status.json, {connection: 'online', motorsOn: true, walking: false, viewers: 0, version: 'test 1'});
  const sessions = await request(port, 'GET', '/sessions');
  assert.equal(sessions.json.length, 1); assert.equal(sessions.json[0].current, true);
  const csv = await request(port, 'GET', `/sessions/${sessions.json[0].id}.csv`);
  assert.equal(csv.status, 200); assert.match(csv.type, /text\/csv/); assert.ok(csv.text.startsWith('time_s,'));
  assert.equal((await request(port, 'GET', '/sessions/20260101-000000.csv')).status, 404);
  assert.equal((await request(port, 'GET', '/incidents/20260101-000000-abcd')).status, 404);
  assert.deepEqual((await request(port, 'GET', '/incidents')).json, []);
  // Teacher
  assert.equal((await request(port, 'POST', '/teacher/login', {code: '0000'})).status, 403);
  const token = (await request(port, 'POST', '/teacher/login', {code: '1357'})).json.token;
  assert.ok(token);
  assert.equal((await request(port, 'POST', '/teacher/follow', {active: true, page: 'how'})).status, 403, 'needs the token');
  assert.equal((await request(port, 'POST', '/teacher/follow', {active: true, page: 'how', question: 'signal-uart'}, {'X-Teacher-Token': token})).status, 200);
  assert.equal(classroom.follow.page, 'how');
  assert.equal((await request(port, 'POST', '/answer', {client: 'phone-123456', question: 'signal-uart', choice: 2})).status, 200);
  assert.equal(classroom.tally().counts[2], 1);
  assert.equal((await request(port, 'POST', '/answer', '{not json')).status, 400);
  assert.equal((await request(port, 'POST', '/answer', {client: 'phone-123456', question: 'signal-uart', choice: 2, pad: 'x'.repeat(5000)})).status, 413);
  assert.equal((await request(port, 'POST', '/somewhere', {})).status, 405, 'no other POST routes');
  let limited = false;
  for (let i = 0; i < 35 && !limited; i++) limited = (await request(port, 'POST', '/answer', {client: 'phone-123456', question: 'signal-uart', choice: 1})).status === 429;
  assert.equal(limited, true, 'too many requests are refused');
  } finally { await live.close(); }
});
