// Hexapod Live View: draws the live robot, the Xbox controller and the signal path from
// Server-Sent Events sent by the driving service. Read-only: this page sends no commands.
import {LEG_NAMES, DEFAULT_POSE, copyPose, legJoints, project, bodyStep, balance} from './motion-geometry.js';
import {Timeline} from './timeline.js';
import {drawGaitChart} from './gait-chart.js';
import {drawPower} from './power-chart.js';
import {createInspector} from './messages.js';
import {drawLegInspector} from './leg-inspector.js';
import {fillJoin} from './join.js';

const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const clock = t => new Date(t).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});

// ---------------------------------------------------------------- explanations
const ACTIONS = {
  enable: ['A', 'Enable: motors on', 'The Pi sends an "enable" command down the serial wires. The Servo 2040 switches the servos on and glides every leg to the home stance.'],
  stand: ['Y', 'Stand up', 'The Pi sends a pose: where each of the six feet should be, and how long to take. The board moves every foot smoothly there, recalculating all 18 angles every 20 ms.'],
  sit: ['X', 'Sit down', 'Same as standing, with the feet higher relative to the body, so the body lowers gently to the ground.'],
  stopWalk: ['B', 'Stop walking', 'The board finishes the step it is in, then puts all six feet back in the starting stance. Stopping mid-step could leave a leg in the air.'],
  gait: ['☰', 'Change gait', 'The Menu button picks the next gait: ripple, wave, tripod.'],
  stopMotors: ['View', 'Motors off (emergency stop)', 'The board stops sending pulses to the servos at once. The legs go limp, which is why the body must be supported.'],
  speedUp: ['↑', 'Faster', 'More steps per second. The board blends the new speed in without stopping the walk.'],
  speedDown: ['↓', 'Slower', 'Fewer steps per second. Slow walking is easier to watch: try it to see which legs lift together.'],
  liftUp: ['RB', 'Higher steps', 'Each foot lifts higher while it swings forward: better for clearing obstacles.'],
  liftDown: ['LB', 'Lower steps', 'Each foot lifts less: a steadier, quieter walk on flat ground.'],
  angleUp: ['→', 'Longer stride', 'Each hip swings further per step, so the robot covers more ground with every step.'],
  angleDown: ['←', 'Shorter stride', 'Each hip swings less per step: shorter, more careful steps.'],
};
const WALKING = ['L', 'Walking', 'The Pi turns the stick position into a direction and sends a "walk" command. The Servo 2040 runs the gait itself, 50 times a second: the Pi only steers. The right stick turns.'];
const STOPPED = ['■', 'Stopped', 'Both sticks are released, so the Pi tells the board to finish its step and stand still.'];
const GAITS = {ripple: 'Ripple: legs lift one after another in a wave, so about four feet are always down.', tripod: 'Tripod: three legs lift together while the other three push. Fast.', wave: 'Wave: one leg at a time. Slow and very stable.', crawl: 'Crawl', 'insect-tripod': 'Insect tripod', 'insect-ripple': 'Insect ripple', 'insect-wave': 'Insect wave'};
// Shown when the Menu button changes the gait.
const GAIT_LESSON = {
  tripod: ['Tripod gait', 'Three legs lift together (front and back on one side, middle on the other) while the other three push. Always a stable triangle on the ground. The fastest gait.'],
  ripple: ['Ripple gait', 'The legs lift one after another in a wave down each side, so about four feet are always on the ground. Smooth and natural, like many insects.'],
  wave: ['Wave gait', 'Only one leg lifts at a time, so five feet are always on the ground. The slowest gait, and the most stable: good for rough ground.'],
};

// ---------------------------------------------------------------- state
const view = {robot: null, pad: {connected: false}, online: false};
let dirty = true, lastDraw = 0; // redraw the robot only when something changed
const scene = {pose: copyPose(DEFAULT_POSE), lastT: 0, body: {x: 0, y: 0, theta: 0}, camera: 'angled', trails: true, balance: true, prints: []};
// Everything shown comes from this buffer of robot updates, drawn LIVE_DELAY behind the newest one
// so there is always a next update to glide towards. Pause / slow motion / replay move the playhead.
const timeline = new Timeline();
const LIVE_DELAY = 260, REPLAY_MS = 20000;
const play = {mode: 'live', t: 0, speed: 1, last: 0}; // mode: live | paused | replay
const ui = {leg: 0, power: [], serverOffset: 0, lastPower: -Infinity};

// ---------------------------------------------------------------- robot scene
const poly = (points, cam) => points.map(p => project(p, cam).map(v => v.toFixed(1)).join(',')).join(' ');
function rotate([x, y, z], theta) { const c = Math.cos(theta), s = Math.sin(theta); return [c * x - s * y, s * x + c * y, z]; }

function drawScene(now) {
  const {pose, body, camera: cam} = scene;
  const ground = Math.max(...pose.map(p => p[2]));
  const world = pt => rotate(pt, body.theta);
  let out = '<defs><radialGradient id="g"><stop offset="0" stop-color="#244950" stop-opacity=".55"/><stop offset="1" stop-color="#122c33" stop-opacity="0"/></radialGradient><linearGradient id="shell" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#335954"/><stop offset="1" stop-color="#17363c"/></linearGradient></defs><rect width="620" height="440" fill="url(#g)"/>';
  // Ground grid, shifted so it slides under the walking robot (the camera follows the body).
  const ox = -(((body.x % 40) + 40) % 40), oy = -(((body.y % 40) + 40) % 40);
  let grid = '';
  for (let v = -320; v <= 320; v += 40) {
    grid += `<polyline points="${poly([[-300, v + oy, -ground], [300, v + oy, -ground]], cam)}"/><polyline points="${poly([[v + ox, -300, -ground], [v + ox, 300, -ground]], cam)}"/>`;
  }
  out += `<g fill="none" stroke="#2b474b" stroke-width=".7" opacity=".7">${grid}</g>`;
  // Footprints: where grounded feet have been, in world space.
  if (scene.trails && scene.prints.length) {
    out += '<g>' + scene.prints.map(p => {
      const age = (now - p.t) / 6000; if (age >= 1) return '';
      const [sx, sy] = project([p.x - body.x, p.y - body.y, -ground], cam);
      return `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="3.2" fill="${p.leg < 3 ? '#7fd3c3' : '#c8e68f'}" opacity="${(0.55 * (1 - age)).toFixed(2)}"/>`;
    }).join('') + '</g>';
  }
  const shell = [[-58, -70, 9], [0, -101, 9], [58, -70, 9], [72, 0, 9], [58, 70, 9], [0, 101, 9], [-58, 70, 9], [-72, 0, 9]].map(world);
  out += `<polygon points="${poly(shell.map(([x, y]) => [x, y, -ground]), cam)}" fill="#091e25" opacity=".45"/>`;
  // Balance: the area between the feet on the ground, and the body's centre. Inside = stable.
  if (scene.balance) {
    const b = balance(pose);
    if (b.hull.length >= 3) {
      const colour = b.stable ? '#86efac' : '#f87171';
      out += `<polygon points="${poly(b.hull.map(([x, y]) => [...rotate([x, y, 0], body.theta).slice(0, 2), -ground]), cam)}" fill="${colour}" fill-opacity=".14" stroke="${colour}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    }
    const [cx, cy] = project([0, 0, -ground], cam);
    out += `<g stroke="${b.stable ? '#86efac' : '#f87171'}" stroke-width="2"><circle cx="${cx}" cy="${cy}" r="7" fill="none"/><path d="M${cx - 11} ${cy}h22M${cx} ${cy - 11}v22"/></g>`;
  }
  // Painter's order: draw the far side first. "Nearer" depends on the camera.
  const depth = {angled: p => project(p, 'angled')[1], top: p => p[2], front: p => -p[1], side: p => p[0]}[cam];
  const legs = pose.map((xyz, i) => ({i, joints: legJoints(xyz, i).map(world), lift: ground - xyz[2]}))
    .sort((a, b) => depth(a.joints[0]) - depth(b.joints[0]));
  const centre = depth(world([0, 0, 0]));
  const back = cam === 'top' ? legs : legs.filter(l => depth(l.joints[0]) < centre);
  const front = legs.filter(l => !back.includes(l));
  const drawLeg = ({i, joints, lift}) => {
    const pts = joints.map(p => project(p, cam)), foot = pts[3], shadow = project([joints[3][0], joints[3][1], -ground], cam);
    const up = lift > 1, k = 1 - Math.min(Math.max(lift, 0), 30) / 90;
    let g = `<ellipse cx="${shadow[0]}" cy="${shadow[1]}" rx="${(cam === 'top' ? 11 : 13) * k}" ry="${(cam === 'top' ? 11 : 5) * k}" fill="#071c22" opacity="${0.5 - Math.min(Math.max(lift, 0), 30) / 90}"/>`;
    if (up) g += `<line x1="${foot[0]}" y1="${foot[1]}" x2="${shadow[0]}" y2="${shadow[1]}" stroke="#6c9680" stroke-dasharray="3 4"/>`;
    const colours = up ? ['#9fbf8c', '#d6eaa7', '#a2c58b'] : ['#567c73', '#8eaca0', '#63897c'];
    for (let j = 0; j < 3; j++) {
      g += `<line x1="${pts[j][0]}" y1="${pts[j][1]}" x2="${pts[j + 1][0]}" y2="${pts[j + 1][1]}" stroke="#0b2026" stroke-width="${[16, 13, 10][j]}" stroke-linecap="round"/>`;
      g += `<line x1="${pts[j][0]}" y1="${pts[j][1]}" x2="${pts[j + 1][0]}" y2="${pts[j + 1][1]}" stroke="${colours[j]}" stroke-width="${[11, 8, 5][j]}" stroke-linecap="round"/>`;
    }
    for (let j = 0; j < 3; j++) g += `<circle cx="${pts[j][0]}" cy="${pts[j][1]}" r="${j ? 6 : 7}" fill="#183b40" stroke="#8cab92" stroke-width="1.5"/><circle cx="${pts[j][0]}" cy="${pts[j][1]}" r="2" fill="#c8dfa0"/>`;
    if (up) g += `<circle cx="${foot[0]}" cy="${foot[1]}" r="11" fill="#e7f7bc" opacity=".22"/>`;
    g += `<circle cx="${foot[0]}" cy="${foot[1]}" r="5" fill="${up ? '#e7f7bc' : '#a6c290'}"/>`;
    g += `<text x="${foot[0] + (i < 3 ? -16 : 16)}" y="${foot[1] + 4}" text-anchor="${i < 3 ? 'end' : 'start'}" fill="#bbd1be" font-size="12" font-family="system-ui,sans-serif">${LEG_NAMES[i]}</text>`;
    return g;
  };
  out += back.map(drawLeg).join('');
  out += `<polygon points="${poly(shell, cam)}" fill="url(#shell)" stroke="#8cab92" stroke-width="2"/>`;
  out += `<polygon points="${poly([[-13, -78, 10], [0, -97, 10], [13, -78, 10]].map(world), cam)}" fill="#c8e68f"/>`;
  const label = project(world([0, 6, 11]), cam);
  out += `<text x="${label[0]}" y="${label[1]}" text-anchor="middle" fill="#d6eaa7" font-size="11" font-weight="600" font-family="system-ui,sans-serif" letter-spacing=".08em">FRONT ▲</text>`;
  out += front.map(drawLeg).join('');
  for (const svg of visibleRobotViews()) svg.innerHTML = out;
}
const visibleRobotViews = () => [...document.querySelectorAll('svg.robot-view')].filter(svg => svg.getClientRects().length);

// Called every animation frame with the playhead time: the pose there, and the body moved by
// the feet that pushed it since the last frame (only when playing forwards).
function stepScene(t) {
  const pose = timeline.poseAt(t);
  if (!pose) return false;
  const prev = scene.pose, forward = t >= scene.lastT && t - scene.lastT < 250;
  scene.lastT = t;
  if (pose.every((p, i) => p[0] === prev[i][0] && p[1] === prev[i][1] && p[2] === prev[i][2])) return false;
  if (forward && timeline.frameAt(t)?.walking) {
    const s = bodyStep(prev, pose);
    if (Number.isFinite(s.dx)) {
      const c = Math.cos(scene.body.theta), si = Math.sin(scene.body.theta);
      scene.body = {x: scene.body.x + c * s.dx - si * s.dy, y: scene.body.y + si * s.dx + c * s.dy, theta: scene.body.theta + s.dtheta};
    }
  }
  scene.pose = pose;
  return true;
}

function recordFootprints(now) {
  const pose = scene.pose, ground = Math.max(...pose.map(p => p[2]));
  pose.forEach((p, i) => {
    if (ground - p[2] > 1) return;
    const [x, y] = rotate(legJoints(p, i)[3], scene.body.theta);
    const wx = x + scene.body.x, wy = y + scene.body.y;
    const last = scene.prints.findLast?.(q => q.leg === i) ?? [...scene.prints].reverse().find(q => q.leg === i);
    if (!last || Math.hypot(last.x - wx, last.y - wy) > 14) scene.prints.push({leg: i, x: wx, y: wy, t: now});
  });
  if (scene.prints.length > 240) scene.prints.splice(0, scene.prints.length - 240);
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  scene.camera = button.dataset.view; dirty = true;
  // Every page with a robot shares the same camera.
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === scene.camera)));
}));
$('trails').addEventListener('click', event => {
  scene.trails = !scene.trails; dirty = true; event.currentTarget.setAttribute('aria-pressed', String(scene.trails));
});
$('balance').addEventListener('click', event => {
  scene.balance = !scene.balance; dirty = true; event.currentTarget.setAttribute('aria-pressed', String(scene.balance));
});

// ---------------------------------------------------------------- pause, slow motion, replay
function setMode(mode) {
  play.mode = mode;
  timeline.hold = mode === 'paused'; // keep the paused moment however long it stays paused
  const live = mode === 'live';
  $('play').querySelector('use').setAttribute('href', mode === 'paused' ? '#i-play' : '#i-pause');
  $('play').setAttribute('aria-label', mode === 'paused' ? 'Play' : 'Pause');
  $('go-live').hidden = live;
}
function setSpeed(speed) {
  play.speed = speed;
  document.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed)));
}
function goLive() { setSpeed(1); setMode('live'); }
function togglePlay() {
  if (play.mode === 'paused') {
    const [lo] = replayRange(performance.now());
    if (play.t < lo) play.t = lo; // paused longer than the replay window: resume from its oldest moment
    setMode('replay');
  } else setMode('paused');
}
$('play').addEventListener('click', togglePlay);
$('go-live').addEventListener('click', goLive);
document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
  setSpeed(Number(b.dataset.speed));
  if (play.mode === 'live' && play.speed < 1) setMode('replay'); // slow motion from now: falls behind live
}));
const replayRange = now => [Math.max(timeline.start, now - REPLAY_MS), now - LIVE_DELAY];
let scrubbing = false;
$('scrub').addEventListener('input', () => {
  scrubbing = true;
  const [lo, hi] = replayRange(performance.now());
  play.t = lo + (hi - lo) * Number($('scrub').value) / 1000;
  if (play.mode === 'live') setMode('paused');
});
$('scrub').addEventListener('change', () => { scrubbing = false; });
addEventListener('keydown', e => {
  if (e.code !== 'Space' || page !== 'live' || /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  e.preventDefault(); togglePlay();
});

// ---------------------------------------------------------------- controller diagram
const PAD = {
  // id: [shape, x, y, size, letter, label, label side, label y]
  lb: ['bumper', 108, 44, 0, 'LB', 'Lower steps', 'left', 40],
  rb: ['bumper', 292, 44, 0, 'RB', 'Higher steps', 'right', 40],
  view: ['round', 178, 102, 8, '⧉', 'Motors OFF', 'left', 128],
  menu: ['round', 222, 102, 8, '≡', 'Change gait', 'right', 226],
  y: ['round', 292, 82, 12, 'Y', 'Stand', 'right', 74],
  b: ['round', 316, 106, 12, 'B', 'Stop walk', 'right', 102],
  a: ['round', 292, 130, 12, 'A', 'Enable', 'right', 130],
  x: ['round', 268, 106, 12, 'X', 'Sit', 'right', 158],
  up: ['dpad', 158, 150, 0, '', 'Speed + / −', 'left', 176],
  down: ['dpad', 158, 182, 0, '', '', '', 0],
  left: ['dpad', 142, 166, 0, '', 'Stride − / +', 'left', 206],
  right: ['dpad', 174, 166, 0, '', '', '', 0],
};
const STICKS = {left: {x: 122, y: 102, label: 'Walk', side: 'left', ly: 92}, right: {x: 248, y: 166, label: 'Turn', side: 'right', ly: 196}};
const PAD_X = 80; // the controller is drawn in the middle, labels at the sides

const LABEL_OF = {down: 'up', right: 'left'}; // D-pad pairs share one label

function buildPad() {
  let leads = '', parts = '';
  const lead = (x1, y1, side, ly, id, text) => {
    if (!text) return;
    const lx = side === 'left' ? 74 : 486, anchor = side === 'left' ? 'end' : 'start';
    leads += `<polyline class="pad-lead" fill="none" points="${x1},${y1} ${side === 'left' ? 96 : 464},${ly} ${lx + (side === 'left' ? 4 : -4)},${ly}"/><text id="lbl-${id}" class="pad-label" x="${lx}" y="${ly + 4}" text-anchor="${anchor}">${text}</text>`;
  };
  for (const [id, [shape, x0, y, size, letter, label, side, ly]] of Object.entries(PAD)) {
    const x = x0 + PAD_X;
    if (shape === 'bumper') parts += `<rect id="pad-${id}" class="pad-part" x="${x - 34}" y="${y - 9}" width="68" height="16" rx="8"/><text id="let-${id}" class="pad-letter" x="${x}" y="${y - 1}">${letter}</text>`;
    if (shape === 'round') parts += `<circle id="pad-${id}" class="pad-part" cx="${x}" cy="${y}" r="${size}"/><text id="let-${id}" class="pad-letter" x="${x}" y="${y}">${letter}</text>`;
    if (shape === 'dpad') parts += `<rect id="pad-${id}" class="pad-part" x="${x - 9}" y="${y - 9}" width="18" height="18" rx="3"/>`;
    lead(shape === 'bumper' ? x + (side === 'left' ? -34 : 34) : x + (side === 'left' ? -size : size), y, side, ly, id, label);
  }
  for (const [id, s] of Object.entries(STICKS)) {
    const x = s.x + PAD_X;
    parts += `<circle class="stick-well" cx="${x}" cy="${s.y}" r="24"/><line id="vec-${id}" class="stick-vector" x1="${x}" y1="${s.y}" x2="${x}" y2="${s.y}"/><circle id="cap-${id}" class="stick-cap" cx="${x}" cy="${s.y}" r="13"/>`;
    lead(x + (s.side === 'left' ? -24 : 24), s.y, s.side, s.ly, `stick-${id}`, s.label);
  }
  // Body outline centred on the buttons (centre x = 200 + PAD_X); leader lines sit under the parts.
  const body = `<path class="pad-body" transform="translate(${30 + PAD_X} 0)" d="M80 58 C52 58 36 74 28 104 C18 146 8 214 34 236 C60 254 86 222 104 198 C118 182 222 182 236 198 C254 222 280 254 306 236 C332 214 322 146 312 104 C304 74 288 58 260 58 C232 50 108 50 80 58 Z"/>`;
  const logo = `<circle cx="${200 + PAD_X}" cy="76" r="11" class="pad-part"/><circle cx="${200 + PAD_X}" cy="76" r="5" fill="none" class="pad-lead"/>`;
  $('pad').innerHTML = body + leads + logo + parts;
}

function renderPad(pad) {
  const held = new Set(pad.connected ? pad.held : []);
  $('pad').classList.toggle('pad-off', !pad.connected);
  const labelsOn = new Set([...held].map(id => LABEL_OF[id] || id));
  for (const id of Object.keys(PAD)) {
    $(`pad-${id}`).classList.toggle('on', held.has(id));
    $(`let-${id}`)?.classList.toggle('on', held.has(id));
    $(`lbl-${id}`)?.classList.toggle('on', labelsOn.has(id));
  }
  const axes = pad.connected ? pad.axes : [0, 0, 0, 0];
  for (const [id, s] of Object.entries(STICKS)) {
    const [ax, ay] = id === 'left' ? [axes[0], axes[1]] : [axes[2], axes[3]];
    const moved = Math.hypot(ax, ay) > 0.18, x = s.x + PAD_X + ax * 13, y = s.y + ay * 13;
    $(`cap-${id}`).setAttribute('cx', x); $(`cap-${id}`).setAttribute('cy', y);
    $(`cap-${id}`).classList.toggle('on', moved);
    $(`vec-${id}`).setAttribute('x2', x); $(`vec-${id}`).setAttribute('y2', y);
    $(`lbl-stick-${id}`)?.classList.toggle('on', moved);
  }
  $('pad-name').textContent = pad.connected ? pad.name || 'connected' : 'not connected';
  // The phone key under the controller.
  const moved = id => { const [ax, ay] = id === 'stick-left' ? [axes[0], axes[1]] : [axes[2], axes[3]]; return Math.hypot(ax, ay) > 0.18; };
  for (const li of document.querySelectorAll('.pad-key li')) {
    const k = li.dataset.k;
    li.classList.toggle('on', k.startsWith('stick') ? moved(k) : labelsOn.has(k) || (k === 'rb' && held.has('lb')));
  }
}
// Phones: crop the drawing to the controller itself (the key below replaces the side labels).
const narrowPad = matchMedia('(max-width: 560px)');
const fitPad = () => $('pad').setAttribute('viewBox', narrowPad.matches ? '100 28 380 230' : '0 0 580 260');
narrowPad.addEventListener?.('change', fitPad);

function explain([key, title, text]) {
  for (const box of document.querySelectorAll('.explain')) {
    box.querySelector('.explain-key').textContent = key;
    box.querySelector('.explain-title').textContent = title;
    box.querySelector('.explain-text').textContent = text;
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
  }
}

// ---------------------------------------------------------------- signal path
// Laid out left-to-right on wide cards and top-to-bottom on narrow ones (phones), so the
// text never has to shrink to fit.
const NODES = [
  {title: 'Xbox controller', sub: ['2 sticks, 11 buttons', 'you are here']},
  {title: 'Raspberry Pi Zero 2 W', sub: ['reads the controller', '50× a second, decides']},
  {title: 'Servo 2040 board', sub: ['gait + inverse kinematics', 'new angles every 20 ms']},
  {title: '18 servo motors', sub: ['6 legs × 3 joints', 'hip · upper · lower']},
];
const LINKS = [['Bluetooth', 'wireless'], ['UART serial wires', '115 200 bits/s'], ['PWM pulses', 'one wire per servo']];
const packets = [];
const hot = [-Infinity, -Infinity, -Infinity, -Infinity]; // when a message last reached each step
let flow = null; // geometry of the current layout

function flowLayout(vertical) {
  if (!vertical) {
    const xs = [0, 315, 650, 985], ws = [175, 200, 195, 175], h = 104, y = 8;
    return {vertical, w: 1160, h: h + 16, boxes: xs.map((x, i) => ({x, y, w: ws[i], h})),
      links: xs.slice(0, 3).map((x, i) => ({x1: x + ws[i], y1: y + h / 2, x2: xs[i + 1], y2: y + h / 2}))};
  }
  const w = 340, h = 92, gap = 74;
  const boxes = NODES.map((_, i) => ({x: 0, y: 2 + i * (h + gap), w, h}));
  return {vertical, w, h: boxes[3].y + h + 4, boxes,
    links: boxes.slice(0, 3).map((b, i) => ({x1: 34, y1: b.y + h, x2: 34, y2: boxes[i + 1].y}))};
}
function buildFlow() {
  const width = $('flow').getBoundingClientRect().width;
  if (!width && flow) return; // on a hidden page: lay out when it is shown
  const vertical = width > 0 && width < 640;
  if (flow && flow.vertical === vertical) return;
  flow = flowLayout(vertical);
  const svg = $('flow');
  svg.setAttribute('viewBox', `0 0 ${flow.w} ${flow.h}`);
  let out = '';
  flow.links.forEach((l, i) => {
    const [label, sub] = LINKS[i];
    out += `<line class="flow-link" x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"/>`;
    out += vertical
      ? `<text class="flow-link-label" x="${l.x1 + 22}" y="${(l.y1 + l.y2) / 2 - 3}">${label}</text><text class="flow-link-sub" x="${l.x1 + 22}" y="${(l.y1 + l.y2) / 2 + 14}">${sub}</text>`
      : `<text class="flow-link-label" x="${(l.x1 + l.x2) / 2}" y="${l.y1 - 12}" text-anchor="middle">${label}</text><text class="flow-link-sub" x="${(l.x1 + l.x2) / 2}" y="${l.y1 + 22}" text-anchor="middle">${sub}</text>`;
  });
  flow.boxes.forEach((b, i) => {
    const n = NODES[i];
    out += `<g class="flow-node" id="node-${i}"><rect x="${b.x + 1}" y="${b.y}" width="${b.w - 2}" height="${b.h}" rx="12"/>` +
      `<text class="step" x="${b.x + 16}" y="${b.y + 22}">STEP ${i + 1}</text><text class="title" x="${b.x + 16}" y="${b.y + 44}">${n.title}</text>` +
      `<text class="sub" x="${b.x + 16}" y="${b.y + 64}">${n.sub[0]}</text><text class="sub" x="${b.x + 16}" y="${b.y + 81}">${n.sub[1]}</text></g>`;
  });
  svg.innerHTML = out + '<g id="packets"></g>';
}
function packet(link, dir, now) {
  if (packets.filter(p => p.link === link && p.dir === dir).length > 3) return;
  packets.push({link, dir, t0: now});
}
function drawFlow(now) {
  let out = '';
  for (let k = packets.length - 1; k >= 0; k--) {
    const p = packets[k], t = (now - p.t0) / 550;
    if (t >= 1) { hot[p.dir === 'down' ? p.link + 1 : p.link] = now; packets.splice(k, 1); continue; }
    const l = flow.links[p.link], k2 = p.dir === 'down' ? t : 1 - t, side = p.dir === 'down' ? -4 : 4;
    const x = l.x1 + (l.x2 - l.x1) * k2 + (flow.vertical ? side : 0), y = l.y1 + (l.y2 - l.y1) * k2 + (flow.vertical ? 0 : side);
    out += `<circle class="packet ${p.dir}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>`;
  }
  $('packets').innerHTML = out;
  hot.forEach((t, i) => $(`node-${i}`).classList.toggle('hot', now - t < 250));
}
// Deferred a frame: rebuilding changes the card's height, which would re-trigger the observer at once.
new ResizeObserver(() => requestAnimationFrame(buildFlow)).observe($('flow').parentElement);

// ---------------------------------------------------------------- walking + settings + servos
function renderCompass(walking) {
  const [fwd, left, turn] = walking?.target || [0, 0, 0];
  let out = '<circle class="compass-ring" r="54"/><circle class="compass-inner" r="34"/>';
  out += [['F', 0, -44], ['B', 0, 44], ['L', -44, 0], ['R', 44, 0]].map(([t, x, y]) => `<text class="compass-tick" x="${x}" y="${y}">${t}</text>`).join('');
  out += '<rect class="compass-body" x="-11" y="-15" width="22" height="30" rx="9"/><path class="compass-nose" d="M-5 -9 0 -15 5 -9Z"/>';
  if (Math.hypot(fwd, left) > 0.01) out += `<line class="compass-arrow" x1="0" y1="0" x2="${(-left * 34).toFixed(1)}" y2="${(-fwd * 34).toFixed(1)}"/><circle class="compass-head" cx="${(-left * 34).toFixed(1)}" cy="${(-fwd * 34).toFixed(1)}" r="5"/>`;
  if (Math.abs(turn) > 0.01) {
    const sweep = clamp(Math.abs(turn), 0.15, 1) * 150 * Math.PI / 180, start = -Math.PI / 2, end = turn > 0 ? start - sweep : start + sweep, r = 25;
    const p = a => `${(r * Math.cos(a)).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)}`;
    out += `<path class="compass-turn" d="M${p(start)} A${r} ${r} 0 0 ${turn > 0 ? 0 : 1} ${p(end)}"/>`;
  }
  $('compass').innerHTML = out;
}

let lastSettings = {};
function setValue(id, text) {
  const el = $(id);
  if (el.textContent === text) return;
  const first = el.textContent === '—';
  el.textContent = text;
  if (!first) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}
function renderWalk(robot) {
  const s = robot?.settings, walking = robot?.live?.walking;
  if (s) {
    setValue('s-gait', (walking?.gait || s.gait || '—').replace(/^./, c => c.toUpperCase()));
    $('s-gait').title = GAITS[walking?.gait || s.gait] || '';
    setValue('s-speed', `${Number(s.speed).toFixed(1)}`);
    setValue('s-lift', `${s.lift} mm`);
    setValue('s-swing', `${s.hipSwing}°`);
    lastSettings = s;
  }
  $('walk-state').textContent = walking ? (walking.stopping ? 'finishing the step…' : walking.blending ? 'changing gait…' : 'walking') : robot?.live?.active ? 'standing still' : 'motors off';
  $('walk-state').dataset.tone = walking ? 'live' : '';
  renderCompass(walking);
}

function buildServos() {
  $('servos').innerHTML = LEG_NAMES.map((name, i) => `<div class="leg" id="leg-${i}"><h3>${name} <span>${i < 3 ? 'left' : 'right'} · ${['front', 'middle', 'back'][i % 3]}</span></h3>` +
    ['Hip', 'Upper', 'Lower'].map((joint, j) => `<div class="joint"><span>${joint}</span><div class="gauge"><i id="g-${i}-${j}"></i></div><output id="a-${i}-${j}">—</output></div>`).join('') + '</div>').join('');
  for (let i = 0; i < 6; i++) $(`leg-${i}`).addEventListener('click', () => selectLeg(i));
  selectLeg(ui.leg);
}
function selectLeg(i) {
  ui.leg = i;
  document.querySelectorAll('[data-leg]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.leg) === i)));
  for (let k = 0; k < 6; k++) $(`leg-${k}`)?.classList.toggle('selected', k === i);
}
document.querySelectorAll('[data-leg]').forEach(b => b.addEventListener('click', () => selectLeg(Number(b.dataset.leg))));
function renderServos(angles, feet) {
  for (let i = 0; i < 6; i++) {
    const lifted = !!feet && !feet[i];
    $(`leg-${i}`).classList.toggle('lifted', lifted);
    $(`leg-${i}`).querySelector('h3 span').textContent = `${i < 3 ? 'left' : 'right'} · ${['front', 'middle', 'back'][i % 3]}${lifted ? ' · lifted' : ''}`;
    for (let j = 0; j < 3; j++) {
      const a = angles?.[i]?.[j];
      $(`a-${i}-${j}`).textContent = Number.isFinite(a) ? `${a.toFixed(0)}°` : '—';
      const bar = $(`g-${i}-${j}`), v = Number.isFinite(a) ? clamp(a, -90, 90) / 90 * 50 : 0;
      bar.style.left = `${v < 0 ? 50 + v : 50}%`; bar.style.width = `${Math.abs(v)}%`;
    }
  }
}

// ---------------------------------------------------------------- status chips + feed
function chip(id, state, text) { const el = $(id); el.dataset.state = state; el.querySelector('b').textContent = text; }
function renderChips() {
  const r = view.robot, live = r?.live;
  chip('chip-view', view.online ? 'ok' : 'bad', view.online ? 'live' : 'reconnecting…');
  chip('chip-pad', view.pad.connected ? 'ok' : 'off', view.pad.connected ? 'connected' : 'off');
  const c = r?.connection || 'offline';
  chip('chip-board', c === 'online' ? 'ok' : c === 'connecting' ? 'busy' : 'bad', c);
  chip('chip-motors', live?.active ? (live.walking ? 'busy' : 'ok') : 'off', live?.active ? (live.walking ? 'walking' : 'on') : 'off');
  const p = live?.power;
  const volts = Number.isFinite(p?.voltage), amps = Number.isFinite(p?.current);
  chip('chip-power', volts ? 'ok' : 'off', volts ? `${p.voltage.toFixed(2)} V${amps ? ` · ${p.current.toFixed(2)} A` : ''}` : '—');
  const badge = $('mode-badge');
  if (!view.online) { badge.textContent = 'Live View disconnected'; badge.dataset.tone = 'warn'; }
  else if (c !== 'online') { badge.textContent = 'Board offline'; badge.dataset.tone = 'warn'; }
  else if (!live?.active) { badge.textContent = 'Motors off: press A to enable'; badge.dataset.tone = 'off'; }
  else if (live.walking) { badge.textContent = live.walking.stopping ? 'Finishing the step' : 'Walking'; badge.dataset.tone = ''; }
  else { badge.textContent = live.moving ? 'Moving to a pose' : 'Holding the pose'; badge.dataset.tone = ''; }
  const gait = live?.walking?.gait;
  $('gait-badge').hidden = !gait;
  if (gait) $('gait-badge').textContent = `${gait} gait`;
}

function addFeed({text, error, time}) {
  const li = document.createElement('li');
  const button = /^Button: /.test(text);
  if (button) { const a = ACTIONS[text.slice(8)]; text = a ? `Button ${a[0]}: ${a[1]}` : text; li.className = 'button'; }
  if (error) li.className = 'error';
  li.innerHTML = `<time>${clock(time)}</time><span>${esc(text.replace(/^ERROR /, ''))}</span>`;
  $('feed').prepend(li);
  if (page !== 'messages' && !replaying) { unread++; showUnread(); }
  while ($('feed').children.length > 60) $('feed').lastElementChild.remove();
}

// ---------------------------------------------------------------- events
let wasWalking = false, replaying = false;
function onRobot(robot, now) {
  const firstPose = !view.robot?.live?.positions;
  view.robot = robot;
  const live = robot?.live;
  if (live?.positions) {
    timeline.push({t: now, positions: live.positions, angles: live.angles, active: live.active, walking: live.walking});
    if (firstPose) { scene.pose = copyPose(live.positions); dirty = true; }
    packet(1, 'up', now);
    if (live.active && live.moving) packet(2, 'down', now);
  }
  const walking = !!live?.walking;
  if (walking && !wasWalking) explain(WALKING);
  if (!walking && wasWalking) explain(STOPPED);
  wasWalking = walking;
  const p = live?.power, serverNow = Date.now() + ui.serverOffset;
  if (Number.isFinite(p?.voltage) && serverNow - ui.lastPower >= 1000) {
    ui.lastPower = serverNow;
    ui.power.push({t: serverNow, v: p.voltage, a: Number.isFinite(p.current) ? p.current : null, w: live.walking ? 1 : 0, sim: p.simulated ? 1 : 0});
    if (ui.power.length > 700) ui.power.splice(0, ui.power.length - 700);
    ui.powerDirty = true;
  }
  renderWalk(robot); renderChips();
}
function onPad(pad, now) {
  if (pad.connected && view.pad.connected) packet(0, 'down', now);
  view.pad = pad; renderPad(pad); renderChips();
}

function connect() {
  const source = new EventSource('events');
  source.addEventListener('open', () => { view.online = true; renderChips(); });
  source.addEventListener('error', () => { view.online = false; renderChips(); });
  source.addEventListener('hello', e => {
    const d = JSON.parse(e.data), now = performance.now();
    view.online = true;
    $('feed').replaceChildren(); replaying = true; d.log.forEach(addFeed); replaying = false;
    if (Number.isFinite(d.serverTime)) ui.serverOffset = d.serverTime - Date.now();
    ui.power = Array.isArray(d.power) ? d.power.slice() : []; ui.lastPower = ui.power.at(-1)?.t ?? -Infinity; ui.powerDirty = true;
    inspector.clear(); inspector.add(d.messages || []);
    if (d.pad) onPad(d.pad, now);
    if (d.robot) onRobot(d.robot, now); else renderChips();
  });
  source.addEventListener('msgs', e => inspector.add(JSON.parse(e.data)));
  source.addEventListener('robot', e => onRobot(JSON.parse(e.data), performance.now()));
  source.addEventListener('pad', e => onPad(JSON.parse(e.data), performance.now()));
  source.addEventListener('action', e => {
    const {action, gait, blend} = JSON.parse(e.data), now = performance.now();
    if (action === 'gait' && GAIT_LESSON[gait]) {
      const [title, text] = GAIT_LESSON[gait];
      explain(['☰', title, `${text} ${blend ? 'The robot blends into it over about one step, without stopping.' : 'The next walk uses it.'}`]);
    } else if (ACTIONS[action]) explain(ACTIONS[action]);
    packet(0, 'down', now); setTimeout(() => packet(1, 'down', performance.now()), 300);
  });
  source.addEventListener('log', e => addFeed(JSON.parse(e.data)));
}

// ---------------------------------------------------------------- theme, full screen
function currentTheme() { return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); }
function showThemeIcon() { $('theme').querySelector('use').setAttribute('href', currentTheme() === 'dark' ? '#i-sun' : '#i-moon'); }
$('theme').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('hexapod-theme', next); } catch {}
  showThemeIcon();
});
showThemeIcon();
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', showThemeIcon); // device switched theme
if (document.fullscreenEnabled) $('fullscreen').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
else $('fullscreen').hidden = true; // e.g. iPhone Safari

// ---------------------------------------------------------------- message inspector
const inspector = createInspector($('msgs'), {
  showStatus: () => $('msg-status').checked,
  frozen: () => $('msg-freeze').getAttribute('aria-pressed') === 'true',
  counter: n => { $('msg-hidden').textContent = n && !$('msg-status').checked ? `(${n} hidden)` : ''; },
});
$('msg-freeze').addEventListener('click', e => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on)); e.currentTarget.textContent = on ? 'Frozen' : 'Freeze';
  if (!on) inspector.flush();
});
$('msg-status').addEventListener('change', () => inspector.add([]));

// ---------------------------------------------------------------- join card
function openJoin() { if (!$('join').open) { fillJoin($('join-body')); $('join').showModal(); } }
$('join-open').addEventListener('click', openJoin);
$('join-close').addEventListener('click', () => $('join').close());
$('join').addEventListener('click', e => { if (e.target === $('join')) $('join').close(); }); // click outside the card

// ---------------------------------------------------------------- pages
// Each page has its own address (#live, #controller, #how, #servos, #messages), so a page can be
// projected or shared, and Back works. Hidden pages are not drawn.
const PAGES = ['live', 'controller', 'how', 'servos', 'messages'];
let page = 'live', unread = 0;
function showPage(name, {scroll = true} = {}) {
  page = PAGES.includes(name) ? name : 'live';
  for (const id of PAGES) $(`page-${id}`).hidden = id !== page;
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.dataset.page === page) { a.setAttribute('aria-current', 'page'); a.scrollIntoView?.({block: 'nearest', inline: 'nearest'}); }
    else a.removeAttribute('aria-current');
  }
  document.title = `${$(`page-${page}`).dataset.title} · Hexapod Live View`;
  if (page === 'messages') { unread = 0; showUnread(); }
  dirty = true; buildFlow();
  if (page === 'how') drawFlow(performance.now()); // clear highlights left from the last visit
  if (scroll) window.scrollTo({top: 0});
}
function showUnread() { $('unread').hidden = !unread; $('unread').textContent = unread > 99 ? '99+' : String(unread); }
// #join opens the Join card over the current page (handy to put on a projector).
function route() {
  const name = location.hash.slice(1);
  if (name === 'join') { openJoin(); return; }
  showPage(name);
}
addEventListener('hashchange', route);
// Keep the side panel just below the top bar, whatever height the top bar wraps to.
new ResizeObserver(([entry]) => { const h = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight); requestAnimationFrame(() => document.documentElement.style.setProperty('--topbar-h', `${h}px`)); }).observe(document.querySelector('.topbar'));

// ---------------------------------------------------------------- go
showPage(location.hash.slice(1), {scroll: false}); if (location.hash === '#join') openJoin(); buildPad(); fitPad(); buildFlow(); buildServos(); renderPad(view.pad); renderWalk(null); renderChips();
let lastPrint = 0;
// Redraw only when something changes, so an idle robot costs viewers (phones, Chromebooks) almost nothing.
let lastSlow = -Infinity, lastChart = -Infinity, lastPowerDraw = -Infinity; // the first frame draws everything
function frame(now) {
  const dt = play.last ? now - play.last : 0; play.last = now;
  const [lo, hi] = replayRange(now);
  if (play.mode === 'live') play.t = hi;
  else if (play.mode === 'replay' && !scrubbing) {
    play.t += dt * play.speed;
    if (play.t >= hi) goLive();
    else if (play.t < lo) { play.t = lo; setMode('paused'); } // slow motion fell 20 s behind: stop rather than pretend
  }
  // Paused: stays exactly where it is (the timeline keeps those updates). Otherwise: within the replay window.
  if (play.mode !== 'paused') play.t = clamp(play.t, Math.min(lo, hi), hi);
  else play.t = Math.min(play.t, hi);
  const t = play.t;
  const moved = stepScene(t);
  if (moved && now - lastPrint > 60) { recordFootprints(now); lastPrint = now; }
  const fading = scene.trails && scene.prints.some(p => now - p.t < 6000);
  if ((dirty || moved || (fading && now - lastDraw > 100)) && visibleRobotViews().length) { drawScene(now); lastDraw = now; dirty = false; }
  if ((packets.length || hot.some(h => now - h < 300)) && page === 'how') drawFlow(now);
  else if (page !== 'how') packets.length = 0; // nobody is watching the signal path
  const live = play.mode === 'live', feet = timeline.feetAt(t);
  // Gait chart, about 30 times a second while it can change.
  if (page === 'live' && now - lastChart > 33 && (timeline.frameAt(t)?.walking || !live || dirty || now - lastChart > 500)) {
    drawGaitChart($('gait-chart'), timeline, t, live ? 'now' : 'here'); lastChart = now;
  }
  if (now - lastSlow > 100) {
    lastSlow = now;
    const behind = (hi - t) / 1000;
    $('replay-time').textContent = live ? 'LIVE' : `−${behind.toFixed(1)} s${play.mode === 'paused' ? ' ⏸' : play.speed < 1 ? ` · ${play.speed === 0.5 ? '½' : '¼'}×` : ''}`;
    $('replay-time').classList.toggle('replaying', !live);
    if (!scrubbing) $('scrub').value = String(hi > lo ? clamp(Math.round((t - lo) / (hi - lo) * 1000), 0, 1000) : 1000);
    const down = feet ? feet.filter(Boolean).length : null, walk = timeline.frameAt(t)?.walking;
    $('gait-summary').textContent = feet === null ? (timeline.why(t) === 'off' ? 'motors off' : 'no recent data')
      : walk?.blending ? `blending into ${walk.gait}…` : walk ? `${walk.gait} · ${down} feet down` : `standing · ${down} feet down`;
    if (scene.balance && timeline.frames.length) {
      const b = balance(scene.pose), label = $('balance-label');
      label.hidden = false;
      label.textContent = b.stable ? `Stable · centre ${b.margin.toFixed(0)} mm inside` : 'Tipping risk: centre outside the feet';
      label.className = `legend balance-label ${b.stable ? 'ok' : 'bad'}`;
    } else $('balance-label').hidden = true;
    if (page === 'servos') {
      renderServos(timeline.anglesAt(t), feet);
      drawLegInspector($('leg-view'), $('leg-numbers'), {name: LEG_NAMES[ui.leg], xyz: timeline.frames.length ? scene.pose[ui.leg] : null, servo: timeline.anglesAt(t)?.[ui.leg], lifted: !!feet && !feet[ui.leg]});
    }
  }
  if (page === 'live' && (ui.powerDirty || now - lastPowerDraw > 5000)) {
    const r = drawPower($('power-chart'), ui.power, Date.now() + ui.serverOffset);
    document.querySelector('.power-now .pv').textContent = r ? r.text.v : '—';
    document.querySelector('.power-now .pa').textContent = r ? r.text.a : '—';
    $('power-note').textContent = r?.simulated ? 'simulated (demo)' : 'last 10 minutes';
    ui.powerDirty = false; lastPowerDraw = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
connect();
