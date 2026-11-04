// The last 25 seconds of robot updates, for smooth live motion, pause / slow motion / replay,
// the gait chart and the leg inspector. Times are this page's clock (performance.now(), ms).
import {copyPose, mixPose} from './motion-geometry.js';

// Same table as WALK_GAITS in the board program (motion_bridge.py): fraction of the cycle each
// foot is on the ground, and the cycle phase at which legs L1, L2, L3, R1, R2, R3 start their swing.
export const WALK_GAITS = {
  tripod: [1 / 2, [0, 1 / 2, 0, 1 / 2, 0, 1 / 2]],
  ripple: [2 / 3, [2 / 3, 1 / 3, 0, 1 / 6, 5 / 6, 1 / 2]],
  wave: [5 / 6, [2 / 6, 1 / 6, 0, 5 / 6, 4 / 6, 3 / 6]],
};
export const KEEP_MS = 25000;
export const STALE_MS = 1500;   // no update for this long: stop guessing the feet
const HOLD_MAX = 4000;          // updates kept while paused (at up to 10 a second: about 7 minutes)
const mod1 = x => ((x % 1) + 1) % 1;

// Which feet are on the ground (true) at cycle position `cycle` of a gait, as the board computes it.
export function feetDown(gait, cycle) {
  const table = WALK_GAITS[gait];
  if (!table) return null;
  const [stance, phases] = table, swing = 1 - stance;
  return phases.map(phase => mod1(cycle - phase) >= swing);
}

export class Timeline {
  // hold: true while paused, so the paused moment is not thrown away as time passes.
  constructor() { this.frames = []; this.hold = false; }
  // frame: {t, positions, angles, active, walking: {gait, cycle, period, stopping, blending} | null}
  push(frame) {
    if (!frame.positions) return;
    const last = this.frames.at(-1);
    if (last && frame.t < last.t) this.frames.length = 0; // clock went backwards: start again
    this.frames.push(frame);
    const oldest = frame.t - KEEP_MS;
    if (this.hold) { if (this.frames.length > HOLD_MAX) this.frames.shift(); return; }
    while (this.frames.length > 2 && this.frames[1].t < oldest) this.frames.shift();
  }
  get start() { return this.frames[0]?.t ?? 0; }
  // Why feetAt() is null at t: 'off' (motors off) or 'stale' (no recent update).
  why(t) { const f = this.frameAt(t); return !f ? 'stale' : !f.active ? 'off' : t - f.t > STALE_MS ? 'stale' : null; }
  get end() { return this.frames.at(-1)?.t ?? 0; }
  clear() { this.frames.length = 0; }
  // Index of the last frame at or before t (binary search), or -1.
  indexAt(t) {
    let lo = 0, hi = this.frames.length - 1, found = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.frames[mid].t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1; }
    return found;
  }
  frameAt(t) { const i = this.indexAt(t); return i < 0 ? this.frames[0] ?? null : this.frames[i]; }
  // Pose at time t, gliding between the two updates around it.
  poseAt(t) {
    const i = this.indexAt(t), f = this.frames;
    if (!f.length) return null;
    if (i < 0) return copyPose(f[0].positions);
    if (i >= f.length - 1) return copyPose(f[i].positions);
    const a = f[i], b = f[i + 1], k = (t - a.t) / Math.max(1, b.t - a.t);
    return mixPose(a.positions, b.positions, k);
  }
  anglesAt(t) {
    const i = this.indexAt(t), f = this.frames;
    if (!f.length) return null;
    const a = f[Math.max(0, i)], b = f[Math.min(f.length - 1, i + 1)];
    if (!a.angles) return null;
    if (!b.angles || a === b) return a.angles;
    const k = Math.min(1, Math.max(0, (t - a.t) / Math.max(1, b.t - a.t)));
    return a.angles.map((row, leg) => row.map((v, j) => v + (b.angles[leg][j] - v) * k));
  }
  // Feet on the ground at time t from the board's gait timing (exact, unlike the 5-a-second poses).
  // null: motors off, or no update for STALE_MS (never guess a walk that may have stopped). All true: standing.
  feetAt(t) {
    const frame = this.frameAt(t);
    if (!frame || !frame.active || t - frame.t > STALE_MS) return null;
    const w = frame.walking;
    if (!w || !Number.isFinite(w.cycle) || !(w.period > 0)) return [true, true, true, true, true, true];
    return feetDown(w.gait, w.cycle + (t - frame.t) / w.period) ?? [true, true, true, true, true, true];
  }
}
