// The robot as built, drawn as shaded solids for the Live View: black chassis and perforated
// shell, red sensor box at the front, red 20 kg hip servos, black FT5320M upper-leg and knee
// servos with gold horns, carbon upper-leg plates and curved red feet (see images/labelled/).
// Plain SVG strings, no library: each part is a box or plate whose hidden faces are skipped and
// whose visible faces are painted far-to-near along the camera's viewing direction.
import {legJoints, project} from './motion-geometry.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return mul(a, 1 / l); };
const avg = pts => mul(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
const turn = ([x, y, z], c, s) => [c * x - s * y, s * x + c * y, z];
const UP = [0, 0, 1];

// Direction towards the camera for each view in motion-geometry's project() (angled: the
// direction that projects to a single point, on the side above the robot).
const YAW = 0.12;
export const VIEW_DIR = {
  angled: norm([0.882 * Math.sin(YAW), 0.882 * Math.cos(YAW), 0.6076]),
  top: [0, 0, 1], front: [0, -1, 0], side: [1, 0, 0],
};
const LIGHT = norm([-0.35, 0.45, 0.85]);

// Colours of the real parts (RGB).
const C = {
  shell: [36, 39, 44], chassis: [30, 33, 37], carbon: [48, 52, 58], servo: [34, 36, 40],
  hipServo: [168, 26, 38], sensor: [200, 24, 30], foot: [208, 32, 38], gold: [226, 162, 44],
};
const shade = (rgb, n, lift = 0) => {
  const k = 0.42 + 0.7 * Math.max(0, dot(n, LIGHT)) + lift;
  return `rgb(${rgb.map(v => Math.round(Math.min(255, v * k + 6))).join(',')})`;
};

// A list of painted shapes for one group (a leg, or the body), sorted by depth when output.
class Mesh {
  constructor(cam) { this.cam = cam; this.v = VIEW_DIR[cam] ?? VIEW_DIR.angled; this.items = []; }
  pt(p) { return project(p, this.cam).map(v => v.toFixed(1)).join(','); }
  pts(list) { return list.map(p => this.pt(p)).join(' '); }
  depth(p) { return dot(p, this.v); }
  raw(z, svg) { this.items.push({z, svg}); }
  // A flat face with outward normal n; skipped when it faces away from the camera.
  face(pts, n, rgb, {extra = '', bias = 0, stroke = 'rgba(0,0,0,.45)', glow = false} = {}) {
    if (dot(n, this.v) <= 0.015) return false;
    const line = glow ? 'stroke="#e7f7bc" stroke-width="2"' : `stroke="${stroke}" stroke-width=".8"`;
    this.raw(this.depth(avg(pts)) + bias, `<polygon points="${this.pts(pts)}" fill="${shade(rgb, n)}" ${line} stroke-linejoin="round"/>${extra}`);
    return true;
  }
  // A box: centre c, unit axes ax[3] (perpendicular), half-sizes h[3]. decorate(axis, sign) may
  // return extra SVG for a face (drawn on top of it).
  box(c, ax, h, rgb, decorate) {
    for (let i = 0; i < 3; i++) for (const s of [1, -1]) {
      const j = (i + 1) % 3, k = (i + 2) % 3, fc = add(c, mul(ax[i], h[i] * s));
      const corner = (a, b) => add(fc, add(mul(ax[j], h[j] * a), mul(ax[k], h[k] * b)));
      const extra = decorate?.(i, s, fc, mul(ax[j], h[j]), mul(ax[k], h[k])) ?? '';
      this.face([corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)], mul(ax[i], s), rgb, {extra});
    }
  }
  // A solid between two rings of points (same count): side faces, plus the top face.
  prism(bottom, top, rgb, topExtra = () => '') {
    const centre = avg([...bottom, ...top]);
    for (let i = 0; i < bottom.length; i++) {
      const a = bottom[i], b = bottom[(i + 1) % bottom.length], quad = [a, b, top[(i + 1) % top.length], top[i]];
      let n = norm(cross(sub(b, a), sub(quad[3], a)));
      if (dot(n, sub(avg(quad), centre)) < 0) n = mul(n, -1);
      this.face(quad, n, rgb);
    }
    this.face(top, UP, rgb, {extra: topExtra(), bias: 0.5});
    this.face(bottom, mul(UP, -1), rgb);
  }
  svg() { return this.items.sort((a, b) => a.z - b.z).map(i => i.svg).join(''); }
}

// The direction each hip servo points (fixed to the body): the leg's direction at the home stance.
const MOUNT_DIR = [0, 1, 2, 3, 4, 5].map(i => {
  const [h, c] = legJoints([0, 175, 70], i);
  return norm([c[0] - h[0], c[1] - h[1], 0]);
});

// One leg. joints: [hip, end of hip bracket, knee, foot] already turned with the body;
// theta: body heading; lifted: foot in the air (outlined, as in the legend).
export function legSvg(joints, i, theta, cam, lifted = false) {
  const m = new Mesh(cam), [h, c, k, f] = joints, cs = Math.cos(theta), sn = Math.sin(theta);
  const u = norm([c[0] - h[0], c[1] - h[1], 0]), w = [-u[1], u[0], 0];
  const u0 = turn(MOUNT_DIR[i], cs, sn), w0 = [-u0[1], u0[0], 0];
  // In-plane perpendicular to a direction d lying in the leg's (u, up) plane, pointing outwards / up.
  const across = d => norm(add(mul(u, -d[2]), mul(UP, dot(d, u))));
  const screws = (fc, a, b) => [[0.55, 0.6], [-0.55, 0.6]].map(([x, y]) => {
    const [px, py] = project(add(fc, add(mul(a, x), mul(b, y))), cam);
    return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="1.5" fill="#b9c0c7"/>`;
  }).join('');

  // Hip: red 20 kg servo under the chassis edge, and the black bracket it turns.
  m.box(add(h, [0, 0, -16]), [u0, w0, UP], [20, 10, 12], C.hipServo);
  m.box(add(h, mul(u, 22)), [u, w, UP], [30, 12, 4], C.carbon);
  // Upper leg: black FT5320M standing on the bracket, gold horn on its side.
  m.box(add(c, [0, 0, 6]), [u, w, UP], [10, 11, 19], C.servo, (axis, s, fc, a, b) => (axis === 2 && s > 0 ? screws(fc, a, b) : ''));
  m.box(add(c, mul(w, 12)), [u, w, UP], [6, 1.2, 6], C.gold);
  // Upper leg plates: two carbon links either side, from the servo to the knee.
  const d = norm(sub(k, c)), n = across(d), mid = mul(add(c, k), 0.5), half = Math.hypot(...sub(k, c)) / 2 + 9;
  for (const s of [-1, 1]) m.box(add(mid, mul(w, 14 * s)), [d, w, n], [half, 1.8, 9], C.carbon);
  // Knee: black FT5320M at the top of the foot.
  const e = norm(sub(f, k)), q = across(e);
  m.box(add(k, mul(e, 12)), [e, w, q], [19, 10, 10], C.servo, (axis, s, fc, a, b) => (axis === 1 ? '' : axis === 2 && s > 0 ? screws(fc, a, b) : ''));
  // Foot: a curved red blade, bulging outwards, with two cut-outs and a rubber tip.
  const N = 12, centre = [], outer = [], inner = [];
  for (let t = 0; t <= N; t++) {
    const x = t / N, base = add(k, mul(sub(f, k), x)), off = 15 * Math.sin(Math.PI * x) * (1 - 0.25 * x), wd = 10.5 * (1 - x) + 2.5;
    centre.push(add(base, mul(q, off))); outer.push(add(base, mul(q, off + wd))); inner.push(add(base, mul(q, off - wd)));
  }
  const cutout = (from, to, side) => {
    const a = [], b = [];
    for (let t = 0; t <= 6; t++) {
      const x = from + (to - from) * t / 6, idx = x * N, lo = Math.floor(idx), fr = idx - lo;
      const p = add(mul(centre[lo], 1 - fr), mul(centre[Math.min(N, lo + 1)], fr));
      const wd = (10.5 * (1 - x) + 2.5) * 0.45 * Math.sin(Math.PI * t / 6);
      a.push(add(add(p, mul(q, wd)), mul(w, side))); b.unshift(add(add(p, mul(q, -wd)), mul(w, side)));
    }
    return `<polygon points="${m.pts([...a, ...b])}" fill="#2a0c0f" opacity=".9"/>`;
  };
  const footDepth = m.depth(avg(centre));
  m.raw(footDepth - 0.4, `<polyline points="${m.pts(centre)}" fill="none" stroke="${shade(C.foot, UP, -0.1)}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const s of [-1, 1]) {
    const side = mul(w, 4.5 * s), outline = [...outer.map(p => add(p, side)), ...[...inner].reverse().map(p => add(p, side))];
    m.face(outline, mul(w, s), C.foot, {glow: lifted, extra: cutout(0.12, 0.42, 4.6 * s) + cutout(0.5, 0.76, 4.6 * s)});
  }
  const [tx, ty] = project(f, cam);
  m.raw(m.depth(f) + 1, `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3.6" fill="#111417"/>`);
  return m.svg();
}

// Hexagon holes in the shell top (body coordinates, before turning), worked out once.
const OCT = [[-58, -70], [0, -101], [58, -70], [72, 0], [58, 70], [0, 101], [-58, 70], [-72, 0]];
const TOP_SCALE = [0.56, 0.72], TOP_Z = 30;
const inside = (pt, poly) => {
  let hit = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a], [xb, yb] = poly[b];
    if ((ya > pt[1]) !== (yb > pt[1]) && pt[0] < (xb - xa) * (pt[1] - ya) / (yb - ya) + xa) hit = !hit;
  }
  return hit;
};
const HOLES = (() => {
  const area = OCT.map(([x, y]) => [x * TOP_SCALE[0] * 0.8, y * TOP_SCALE[1] * 0.8]), out = [];
  for (let row = -9; row <= 9; row++) for (let col = -6; col <= 6; col++) {
    const x = col * 8.6 + (row % 2 ? 4.3 : 0), y = row * 7.4 + 8;
    if (inside([x, y], area)) out.push([x, y]);
  }
  return out;
})();

// The body: chassis plate, perforated shell, red sensor box at the front, battery box below.
export function bodySvg(theta, cam, frontLabel = true) {
  const m = new Mesh(cam), cs = Math.cos(theta), sn = Math.sin(theta), T = p => turn(p, cs, sn);
  const ring = (sx, sy, z) => OCT.map(([x, y]) => T([x * sx, y * sy, z]));
  const hexes = () => HOLES.map(([x, y]) => {
    const pts = [0, 1, 2, 3, 4, 5].map(a => T([x + 3.3 * Math.cos(a * Math.PI / 3), y + 3.3 * Math.sin(a * Math.PI / 3), TOP_Z + 0.1]));
    return `<polygon points="${m.pts(pts)}" fill="#0c0e10" opacity=".85"/>`;
  }).join('');
  m.box(T([0, 4, -22]), [T([1, 0, 0]), T([0, 1, 0]), UP], [26, 46, 10], C.chassis);
  m.prism(ring(1, 1, -10), ring(1, 1, 3), C.chassis);
  m.prism(ring(0.86, 0.9, 3), ring(TOP_SCALE[0], TOP_SCALE[1], TOP_Z), C.shell, hexes);
  // Sensor box: red frame, black sensor board, white light.
  m.box(T([0, -84, 25]), [T([1, 0, 0]), T([0, 1, 0]), UP], [19, 8, 17], C.sensor, (axis, s, fc, a, b) => {
    if (axis !== 1 || s > 0) return '';
    const sq = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([x, y]) => add(fc, add(mul(a, 0.66 * x), mul(b, 0.7 * y))));
    const [lx, ly] = project(add(fc, mul(b, 0.25)), cam), [cx, cy] = project(add(fc, mul(b, -0.2)), cam);
    return `<polygon points="${m.pts(sq)}" fill="#15181b"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2" fill="#f1f5f9"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.6" fill="#3b2a12" stroke="#d29a2c" stroke-width=".8"/>`;
  });
  if (frontLabel && dot(UP, m.v) > 0.3) {
    const [lx, ly] = project(T([0, 6, TOP_Z + 1]), cam);
    m.raw(1e6, `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="#d6eaa7" font-size="10" font-weight="600" font-family="system-ui,sans-serif" letter-spacing=".08em" paint-order="stroke" stroke="#0b1114" stroke-width="3">FRONT ▲</text>`);
  }
  return m.svg();
}
