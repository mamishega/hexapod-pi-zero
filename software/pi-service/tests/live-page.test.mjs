// The Live View's own calculations (the page modules are plain ES modules, so Node can test them).
import test from 'node:test';
import assert from 'node:assert/strict';
import {WALK_GAITS as BOARD_GAITS} from '../vendor/webapp/dist/model.js';
import {WALK_GAITS, feetDown, Timeline, KEEP_MS, STALE_MS} from '../live/timeline.js';
import {solveLeg, COXA, FEMUR} from '../live/leg-inspector.js';
import {legJoints} from '../live/motion-geometry.js';

test('the gait chart uses exactly the board\'s gait timing', () => {
  assert.deepEqual(WALK_GAITS, BOARD_GAITS, 'same table as model.js / motion_bridge.py');
});

test('feet on the ground through a cycle: tripod 3, ripple 4, wave 5', () => {
  const counts = gait => Array.from({length: 120}, (_, k) => feetDown(gait, k / 120 + 0.001).filter(Boolean).length);
  assert.ok(counts('tripod').every(n => n === 3));
  assert.ok(counts('ripple').every(n => n === 4));
  assert.ok(counts('wave').every(n => n === 5));
  // Tripod: L1, L3 and R2 move together.
  const swing = feetDown('tripod', 0.1);
  assert.deepEqual(swing, [false, true, false, true, false, true]);
  assert.equal(feetDown('crawl', 0.3), null, 'unknown gait: no guess');
});

test('the timeline glides between updates and works out feet between them', () => {
  const tl = new Timeline();
  const pose = z => Array.from({length: 6}, () => [0, 175, z]);
  tl.push({t: 1000, positions: pose(70), active: true, walking: {gait: 'tripod', cycle: 0.1, period: 1000}});
  tl.push({t: 1200, positions: pose(60), active: true, walking: {gait: 'tripod', cycle: 0.3, period: 1000}});
  assert.equal(tl.poseAt(1100)[0][2], 65, 'halfway between the two updates');
  assert.equal(tl.poseAt(900)[0][2], 70, 'before the first update: the first pose');
  assert.deepEqual(tl.feetAt(1150), feetDown('tripod', 0.25), 'extrapolated from the cycle and period');
  tl.push({t: 1300, positions: pose(60), active: false, walking: null});
  assert.equal(tl.feetAt(1300), null, 'motors off');
  tl.push({t: 1300 + KEEP_MS + 5000, positions: pose(70), active: true, walking: null});
  assert.ok(tl.frames.length <= 2, 'old updates are dropped');
});

test('the leg inspector solves the same triangle as the 3D drawing', () => {
  for (const xyz of [[0, 175, 70], [30, 160, 40], [-20, 190, 90]]) {
    const s = solveLeg(xyz);
    const joints = legJoints(xyz, 1);                 // leg L2 points straight out (along -x in body space)
    const [mx, my] = joints[0], knee = joints[2];
    const kneeOut = Math.hypot(knee[0] - mx, knee[1] - my), kneeUp = knee[2];
    assert.ok(Math.abs(kneeOut - s.knee2d[0]) < 1e-6, 'knee distance out');
    assert.ok(Math.abs(-kneeUp - s.knee2d[1]) < 1e-6, 'knee height');
    assert.ok(Math.abs(Math.hypot(s.knee2d[0] - COXA, s.knee2d[1]) - FEMUR) < 1e-6, 'femur keeps its length');
    assert.ok(s.reachable);
  }
});

test('no ghost walking when updates stop', () => {
  const tl = new Timeline();
  tl.push({t: 1000, positions: Array.from({length: 6}, () => [0, 175, 70]), active: true, walking: {gait: 'ripple', cycle: 0, period: 1000}});
  assert.ok(Array.isArray(tl.feetAt(1000 + STALE_MS - 1)));
  assert.equal(tl.feetAt(1000 + STALE_MS + 1), null, 'the board went quiet: no guessing');
  assert.equal(tl.why(1000 + STALE_MS + 1), 'stale');
});

test('a paused moment is kept however long it stays paused', () => {
  const tl = new Timeline(), pose = Array.from({length: 6}, () => [0, 175, 70]);
  tl.push({t: 0, positions: pose, active: true, walking: null});
  tl.hold = true;
  for (let t = 200; t <= 60000; t += 200) tl.push({t, positions: pose, active: true, walking: null});
  assert.equal(tl.start, 0, 'nothing thrown away while paused');
  tl.hold = false; tl.push({t: 60200, positions: pose, active: true, walking: null});
  assert.ok(tl.start >= 60200 - KEEP_MS - 200, 'trimmed again once playing');
});

test('QR codes: structure, size and Wi-Fi text (decoding was checked with the macOS QR reader)', async () => {
  const {qrMatrix, wifiText, rsRemainder} = await import('../live/qr.js');
  const m = qrMatrix('http://10.42.0.1:5181/#live');
  assert.equal(m.length, 29, 'version 3 for a 27-byte address');
  const finder = (r0, c0) => [0, 1, 2, 3, 4, 5, 6].every(i => m[r0][c0 + i] && m[r0 + 6][c0 + i] && m[r0 + i][c0] && m[r0 + i][c0 + 6]);
  assert.ok(finder(0, 0) && finder(0, 22) && finder(22, 0), 'three finder patterns');
  assert.equal(m[21][8], true, 'the dark module');
  assert.equal(qrMatrix('z'.repeat(213)).length, 57, '213 bytes fit in version 10');
  assert.throws(() => qrMatrix('z'.repeat(214)), /too long/);
  assert.equal(wifiText('Lab;1', String.raw`a:b\c`), String.raw`WIFI:T:WPA;S:Lab\;1;P:a\:b\\c;;`);
  // Reed-Solomon against the worked example in the QR specification (version 1-M, "01234567").
  assert.deepEqual(rsRemainder([0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11], 10),
    [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test('the realistic robot drawing is valid in every view and hides faces turned away', async () => {
  const {legSvg, bodySvg, VIEW_DIR} = await import('../live/robot-model.js');
  const pose = [[0, 175, 70], [20, 160, 45], [-5, 180, 70], [0, 175, 70], [0, 175, 55], [3, 170, 70]];
  for (const cam of Object.keys(VIEW_DIR)) {
    for (const theta of [0, 1.1, -2.6]) {
      let svg = bodySvg(theta, cam);
      pose.forEach((p, i) => { svg += legSvg(legJoints(p, i), i, theta, cam, i === 1); });
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${cam} view`);
      assert.match(svg, /<polygon/);
    }
  }
  // Only faces turned towards the camera are drawn, so different views draw different faces.
  const top = (bodySvg(0, 'top').match(/<polygon/g) ?? []).length, front = (bodySvg(0, 'front').match(/<polygon/g) ?? []).length;
  assert.ok(top > 0 && front > 0 && top !== front);
  // A foot in the air is outlined (the legend's "lifted"); one on the ground is not.
  assert.match(legSvg(legJoints([0, 175, 40], 0), 0, 0, 'angled', true), /#e7f7bc/);
  assert.doesNotMatch(legSvg(legJoints([0, 175, 70], 0), 0, 0, 'angled', false), /#e7f7bc/);
});
