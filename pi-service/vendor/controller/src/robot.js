// Hexapod Remote: robot connection and driving logic (no React, no DOM).
// Speaks the same 'hexapod-motion-v1' protocol as Motion Studio, through the same
// SerialLink / SimulatedLink classes, and runs the same walk checks before sending.
import {NAMES,clone,setBoardLimits,checkWalk,checkStopTo,postureTarget,DEFAULT_OFFSETS,DEFAULT_POSTURE_SETTINGS,walkFigures} from '../../webapp/dist/model.js';

export const GAITS = [
  {id: 'tripod', label: 'Tripod', note: 'Fast'},
  {id: 'ripple', label: 'Ripple', note: 'Natural'},
  {id: 'wave', label: 'Wave', note: 'Most stable'},
];
export const DEFAULT_SETTINGS = {gait: 'ripple', speed: 0.7, lift: 20, hipSwing: 15};
export const SETTING_RANGES = {speed: [0.1, 2.5], lift: [0, 60], hipSwing: [2, 60]};
// One press of a game controller button changes a setting by this much.
export const SETTING_STEPS = {speed: 0.1, lift: 2, hipSwing: 2};
const SETTING_TEXT = {speed: ['Speed', v => `${v.toFixed(2)} steps/s`], lift: ['Step height', v => `${v} mm`], hipSwing: ['Stride angle', v => `${v}°`]};
const SETTING_COMMIT_MS = 400; // while walking, send once button presses pause this long

const IDLE_POLL_MS = 650;      // keeps the board's 3 s watchdog fed while idle
const WALK_POLL_MS = 200;      // faster while walking so the 3D view follows the robot
const STEER_INTERVAL_MS = 150; // at most one steering command per interval
const STEER_THRESHOLD = 0.08;  // ignore joystick changes smaller than this
const RELEASE_GRACE_MS = 300;  // letting go this briefly (e.g. switching keys) does not start a stop

const round = value => Math.round(value * 100) / 100;
export const isZero = direction => direction.every(value => Math.abs(value) < 1e-6);
const differs = (a, b) => !b || a.some((value, i) => Math.abs(value - b[i]) >= STEER_THRESHOLD);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const ENABLE_GLIDE_MS = 1500; // Enable glides to the home stance (board switches legs on one by one if their pose is unknown)

// Board walk parameters from the user's settings (same mapping as Motion Studio).
export function walkParams(direction, {gait, speed, lift, hipSwing}) {
  return {gait, direction, stride: 40, lift, hipSwing, period: clamp(Math.round(1000 / speed), 400, 20000), cycles: 0};
}
export function walkSummary(settings) {
  const figures = walkFigures(settings);
  return {step: figures.step, speed: figures.speed, cycle: 1 / settings.speed};
}
// Joystick + turn input → board direction [forward, lateral(left +), turn(left +)], each -1..1.
export function driveDirection({x = 0, y = 0, turn = 0}) {
  return [round(clamp(-y, -1, 1)), round(clamp(-x, -1, 1)), round(clamp(turn, -1, 1))].map(v => (Object.is(v, -0) ? 0 : v));
}

// Plain-language reasons for the usual Web Serial connection failures.
export function connectError(error) {
  if (error?.name === 'NotFoundError') return 'No port selected.';
  if (error?.name === 'InvalidStateError') return 'This port is already open in this page. Reload the page and connect again.';
  if (error?.name === 'NetworkError' || /Failed to open serial port/i.test(error?.message ?? ''))
    return 'The USB port is busy: another tab or program is using it. Disconnect Motion Studio (or close its tab), close Thonny, then press Connect USB again. If it still fails, unplug and replug the robot.';
  return error?.message ?? String(error);
}

export class RobotController {
  constructor({links, timers = globalThis, now = () => Date.now()} = {}) {
    this.links = links;            // {usb: LinkClass, sim: LinkClass}
    this.timers = timers; this.now = now;
    this.link = null; this.inflight = 0; this.offsets = clone(DEFAULT_OFFSETS);
    this.desired = [0, 0, 0]; this.sentDirection = null; this.lastSteer = 0; this.walkStarting = false;
    this.listeners = new Set(); this.pollTimer = null; this.lastPoll = 0; this.retry = null; this.walkBase = null; this.pendingPosture = null; this.features = new Set(); this.releasedAt = -Infinity;
    this.state = {
      connection: 'offline',   // offline | connecting | online
      simulated: false, live: null, busy: false,
      message: {text: 'Connect the robot over USB, or try the simulator.', error: false},
      settings: {...DEFAULT_SETTINGS}, posture: {...DEFAULT_POSTURE_SETTINGS},
    };
  }

  // ---- store (for React's useSyncExternalStore) ----
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  publish(patch) { this.state = {...this.state, ...patch}; for (const listener of this.listeners) listener(); }
  say(text, error = false) { this.publish({message: {text, error}}); }

  // ---- derived state ----
  get live() { return this.state.live; }
  get online() { return this.state.connection === 'online' && !!this.link; }
  get walking() { return !!this.live?.walking; }
  canDrive() { const live = this.live; return this.online && !!live?.active && !!live.positions && !live.moving_pose; }

  // ---- connection ----
  async connect(kind) {
    if (this.state.connection !== 'offline') return;
    const Link = this.links[kind];
    if (kind === 'usb' && !globalThis.navigator?.serial) {
      this.say('USB control needs desktop Chrome or Edge (Web Serial). Try the simulator here instead.', true); return;
    }
    this.publish({connection: 'connecting'});
    this.walkBase = null; // a walk already running on the board started from a stance this page does not know
    const link = new Link(event => this.onEvent(link, event), error => this.onLost(link, error));
    this.link = link;
    try {
      const state = await link.open();
      if (this.link !== link) return;
      this.offsets = clone(state.offsets || DEFAULT_OFFSETS);
      this.features = new Set(state.features || []); // newer board files blend moves together
      let outdated = '';
      try { setBoardLimits(state.limits, state.joint_limits); } catch (error) { outdated = error.message; }
      if (!('walking' in state)) outdated = outdated || 'live walking is not supported.';
      this.publish({connection: 'online', simulated: !!link.simulated, live: state});
      if (outdated) this.say(`Connected, but the board files are out of date: ${outdated} Copy the current Board Files to the board.`, true);
      else if (!this.features.has('resume')) this.say('Connected, but the board files are older: the robot stops between moves. Copy Board Files/motion_bridge.py to the board (in Thonny) so it switches moves without stopping.', true);
      else this.say(link.simulated ? 'Simulator connected. Nothing is sent over USB.' : 'Robot connected. Support the body, then press Enable.');
      this.schedulePoll();
    } catch (error) {
      if (this.link === link) { this.link = null; this.publish({connection: 'offline', live: null}); }
      try { await link.close(); } catch {}
      this.say(connectError(error), true);
    }
  }
  async disconnect() {
    const link = this.link; if (!link) return;
    this.release(); this.publish({busy: true});
    try { await link.send('off'); } catch {}
    this.link = null; this.stopPolling();
    try { await link.close(); } finally {
      this.publish({connection: 'offline', live: null, busy: false, simulated: false});
      this.say('Disconnected. Motors were told to switch off.');
    }
  }
  onEvent(link, event) {
    if (this.link !== link) return;
    this.apply(event.state);
    if (event.event === 'timeout') this.say('Connection timeout: the board disabled the motors.', true);
    if (event.event === 'error') this.say(`The board stopped the movement: ${event.error}`, true);
  }
  onLost(link, error) {
    if (this.link !== link) return;
    this.link = null; this.stopPolling(); this.release();
    this.publish({connection: 'offline', live: null, busy: false});
    this.say(`${error.message} The board's 3-second timeout releases the motors.`, true);
    link.close().catch(() => {});
  }
  apply(state) {
    if (!state) return;
    if (state.offsets) this.offsets = clone(state.offsets);
    const wasWalking = !!this.live?.walking, toPose = !!this.live?.walking?.stopping_to_pose, wasBlending = !!this.live?.walking?.blending;
    const live = {...this.live, ...state, moving_pose: !!state.moving && !state.walking};
    this.publish({live});
    if (wasBlending && state.walking && !state.walking.blending && !state.walking.stopping && !this.state.message.error)
      this.say(`Now walking in ${state.walking.gait}.`);
    if (wasWalking && !state.walking && state.active && !this.state.message.error)
      this.say(toPose ? 'Settled into the posture. Push the joystick to walk from here.' : 'Stopped in the starting stance. Push the joystick to walk again.');
    if (this.enabling && (!state.active || !state.moving)) {
      this.enabling = false;
      if (state.active && state.positions) this.say('Ready: the legs are at the home stance. Push the joystick to walk.');
    }
    if (!state.walking) { this.sentDirection = null; }
    this.reconcile();
  }

  // ---- commands ----
  async send(op, args = {}, success) {
    const link = this.link; if (!link) return null;
    this.inflight++; this.publish({busy: true});
    let state = null, failure = null;
    try { state = await link.send(op, args); } catch (error) { failure = error; }
    // Lower the in-flight count before applying, so apply() → reconcile() can act on it.
    this.inflight--; if (this.inflight === 0) this.publish({busy: false});
    if (this.link !== link) return null;
    if (failure) { this.say(failure.message, true); return null; }
    this.apply(state); if (success) this.say(success);
    return state;
  }
  enable() {
    if (this.walking) { this.say('Stop walking first.', true); return; }
    this.pendingPosture = null; this.enabling = true;
    return this.send('arm', {glide_ms: ENABLE_GLIDE_MS}, 'Enabling: the legs glide to the home stance…');
  }
  // Stand / Sit. While walking (or still gliding) the robot first finishes its step,
  // then glides into the posture; reconcile() sends it once the robot is still.
  posture(id) {
    if (!this.live?.active) { this.say('Press Enable first.', true); return; }
    let frame;
    try { frame = postureTarget(id, this.state.posture, this.offsets); } catch (error) { this.say(error.message, true); return; }
    const word = id === 'stand' ? 'standing' : 'sitting';
    const walking = this.live.walking;
    if (walking && !walking.stopping && this.features.has('stop_to_pose') && this.inflight === 0) {
      // One continuous move: the steps die down while the body settles into the posture.
      this.release(); this.pendingPosture = null;
      // Checked here (the board's own full check takes over 3 s and would freeze the legs).
      try { checkStopTo(this.walkBase ?? this.live.positions, frame.positions, {...walkParams(walking.target, this.state.settings), gait: walking.gait}, this.offsets); }
      catch (error) { this.say(`${error.message} Finishing this step first instead.`, true); this.pendingPosture = id; return this.send('walk_stop', {}); }
      return this.send('walk_stop', {positions: frame.positions, checked: true}, `Settling into ${id === 'stand' ? 'Stand' : 'Sit'} as the steps die down…`)
        .then(state => { if (!state && this.walking && !this.live.walking.stopping) { this.pendingPosture = id; return this.send('walk_stop', {}, `Finishing this step, then ${word}…`); } return state; });
    }
    if (this.walking || this.live.moving_pose || this.inflight > 0) {
      this.pendingPosture = id; this.release();
      if (walking && !walking.stopping) return this.send('walk_stop', {}, `Finishing this step, then ${word}…`);
      this.say(`Finishing the current move, then ${word}…`);
      return;
    }
    this.pendingPosture = null;
    return this.send('pose', {positions: frame.positions, duration_ms: frame.duration_ms, ease: 'smooth'}, id === 'stand' ? 'Standing up.' : 'Sitting down.');
  }
  // Emergency stop: release torque immediately (same as Esc in Motion Studio).
  stop() {
    this.release(); this.pendingPosture = null;
    if (!this.link) return;
    return this.send('off', {}, 'Motors disabled. Keep the robot supported.');
  }
  // Gentle stop: finish the step and settle in the starting stance.
  stopWalk() {
    this.release();
    if (this.walking && !this.live.walking.stopping) return this.send('walk_stop', {}, 'Stopping in the starting stance…');
  }
  release() { this.desired = [0, 0, 0]; }

  // ---- driving ----
  // Called continuously by the joystick / keyboard with the wanted direction.
  drive(direction) {
    const wasZero = isZero(this.desired);
    this.desired = direction.map(v => clamp(v, -1, 1));
    if (!wasZero && isZero(this.desired)) this.releasedAt = this.now();
    if (!isZero(this.desired)) this.pendingPosture = null; // driving cancels a waiting Stand / Sit
    if (!isZero(this.desired) && this.online && !this.live?.active && !this.state.message.error) this.say('Press Enable before driving.', true);
    this.reconcile();
  }
  reconcile() {
    if (!this.online || this.walkStarting) return;
    const live = this.live, want = this.desired, walking = live?.walking;
    if (this.pendingPosture) {
      if (!live?.active) { this.pendingPosture = null; return; }
      if (!walking && !live.moving_pose && this.inflight === 0) this.posture(this.pendingPosture);
      return;
    }
    if (isZero(want)) {
      if (!walking || walking.stopping) return;
      // A brief release (switching direction) keeps walking; a real release stops.
      const wait = RELEASE_GRACE_MS - (this.now() - this.releasedAt);
      if (wait > 0) { this.later(wait); return; }
      if (this.inflight === 0) this.send('walk_stop', {}, 'Stopping in the starting stance…');
      return;
    }
    if (!walking) {
      if (!this.canDrive() || this.inflight > 0) return;
      if (live.mid_step) { this.say('The last walk stopped mid-step. Press Stand before walking again.', true); this.release(); return; }
      this.startWalk(want);
      return;
    }
    if (walking.stopping) {
      // Pushed again while slowing down: carry straight on in the new direction.
      if (this.features.has('resume') && this.inflight === 0) {
        // Full settings too: if the stop has already finished on the board, it starts a fresh walk instead.
        const params = walkParams([...want], this.state.settings), settling = !!walking.stopping_to_pose;
        if (!settling && !this.checked(params)) return;
        this.sentDirection = [...want]; this.lastSteer = this.now(); this.pendingPosture = null;
        this.send('walk', {...this.walkArgs(params), resume: true, checked: !settling}, 'Walking on without stopping.');
        // Resuming part way into a posture walks on from a stance between the two, which this
        // page does not know: later steering lets the board run its own full check.
        if (settling) this.walkBase = null;
      }
      return; // older board files: wait for the stop to finish, then a new walk starts
    }
    const now = this.now();
    if (this.inflight === 0 && now - this.lastSteer >= STEER_INTERVAL_MS && differs(want, this.sentDirection ?? walking.target)) {
      this.lastSteer = now; this.sentDirection = [...want];
      // Checked here first, so the board skips its own check and keeps the legs moving. If the
      // walk's stance is unknown (connected mid-walk, or resumed part way into a posture), the
      // board must check it itself: it pauses the gait briefly but never trusts a wrong stance.
      if (!this.walkBase) this.send('walk', {direction: [...want]});
      else if (this.checked(walkParams([...want], this.state.settings))) this.send('walk', {direction: [...want], checked: true});
    } else if (differs(want, this.sentDirection ?? walking.target)) {
      this.later(STEER_INTERVAL_MS); // throttled: try again shortly so the last position is not lost
    }
  }
  later(ms) {
    if (!this.retry) this.retry = this.timers.setTimeout(() => { this.retry = null; this.reconcile(); }, ms);
  }
  walkArgs(params) {
    return {gait: params.gait, direction: params.direction, stride: params.stride, lift: params.lift, hip_swing: params.hipSwing, period_ms: params.period, cycles: 0};
  }
  // Full walk check on the laptop (same maths as the board), so the board can skip
  // its 1.4 s check and keep the legs moving. False (with a message) if unreachable.
  checked(params) {
    try { checkWalk(this.walkBase ?? this.live.positions, params, this.offsets); return true; }
    catch (error) { this.say(`${error.message} Keeping the current direction.`, true); return false; }
  }
  async startWalk(direction) {
    const params = walkParams([...direction], this.state.settings);
    try { checkWalk(this.live.positions, params, this.offsets); }
    catch (error) { this.say(`${error.message} Try a smaller stride angle or step height.`, true); this.release(); return; }
    this.walkStarting = true; this.sentDirection = [...direction]; this.lastSteer = this.now(); this.walkBase = clone(this.live.positions);
    try {
      await this.send('walk', {...this.walkArgs(params), checked: true},
        `Walking (${params.gait}). Let go to stop.`);
    } finally { this.walkStarting = false; }
    this.reconcile();
  }
  // Sliders call setSettings while dragging and commitSettings when released.
  setSettings(patch) {
    this.publish({settings: {...this.state.settings, ...patch}});
    // A new gait cannot be blended into mid-stride (the legs' timing differs), so the
    // robot slows to its stance over one cycle and walks on in the new gait.
    const walking = this.live?.walking;
    if (!('gait' in patch) || !walking || walking.stopping || patch.gait === walking.gait) return;
    if (this.features.has('gait_blend')) {
      // The board shifts each leg's timing over one step; tripod <-> wave passes through ripple.
      const via = (walking.gait === 'tripod' && patch.gait === 'wave') || (walking.gait === 'wave' && patch.gait === 'tripod') ? ' (through ripple)' : '';
      this.send('walk', {gait: patch.gait, checked: true}, `Blending into ${patch.gait}${via} without stopping…`);
    } else if (!isZero(this.desired)) {
      // Older board files: slow to the stance over one cycle and walk on in the new gait.
      this.send('walk_stop', {}, `Changing to ${patch.gait}: finishing this step, then walking on.`);
    }
  }
  commitSettings() {
    // While walking, speed / step height / stride angle blend in on the board; a gait change applies to the next walk.
    const walking = this.live?.walking;
    if (!walking || walking.stopping) return;
    const params = walkParams(walking.target, this.state.settings);
    const args = {lift: params.lift, hip_swing: params.hipSwing, period_ms: params.period};
    // Unknown stance (connected mid-walk, or resumed part way into a posture): the board checks fully.
    if (this.walkBase) {
      try { checkWalk(this.walkBase, params, this.offsets); }
      catch (error) { this.say(`${error.message} The walk keeps its current settings.`, true); return; }
      args.checked = true;
    }
    return this.send('walk', args, 'New settings sent: the robot blends into them over about one step.');
  }
  // Game controller: step speed / step height / stride angle up or down by one press.
  // While walking, each step is checked first (refused if a foot could not reach), and
  // the board is sent the result once the presses pause, not once per press.
  nudge(key, direction) {
    const [low, high] = SETTING_RANGES[key], [label, text] = SETTING_TEXT[key];
    const old = this.state.settings[key];
    const value = Math.round(Math.min(high, Math.max(low, old + direction * SETTING_STEPS[key])) * 100) / 100;
    if (value === old) { this.say(`${label} is already at its ${direction > 0 ? 'maximum' : 'minimum'}: ${text(old)}.`); return false; }
    const walking = this.live?.walking;
    if (walking && !walking.stopping && this.walkBase) {
      try { checkWalk(this.walkBase, walkParams(walking.target, {...this.state.settings, [key]: value}), this.offsets); }
      catch (error) { this.say(`${label} ${text(value)} is out of reach: ${error.message} Keeping ${text(old)}.`, true); return false; }
    }
    this.setSettings({[key]: value});
    this.say(`${label}: ${text(value)}${walking && !walking.stopping ? ' (blends in when you stop pressing)' : ''}`);
    const token = this.nudgeToken = (this.nudgeToken || 0) + 1;
    this.timers.setTimeout(() => { if (token === this.nudgeToken) this.commitSettings(); }, SETTING_COMMIT_MS);
    return true;
  }
  updatePosture(patch) { this.publish({posture: {...this.state.posture, ...patch}}); }

  // ---- keep-alive status polling ----
  schedulePoll() {
    this.stopPolling();
    this.pollTimer = this.timers.setInterval(() => this.poll(), WALK_POLL_MS);
  }
  stopPolling() { if (this.pollTimer !== null) this.timers.clearInterval(this.pollTimer); this.pollTimer = null; }
  async poll() {
    const link = this.link;
    if (!link || this.inflight > 0) return;
    // Poll quickly while anything moves (walk, Stand/Sit, Enable glide) so the view and buttons keep up.
    if (!this.live?.moving && this.now() - this.lastPoll < IDLE_POLL_MS) return;
    this.lastPoll = this.now(); this.inflight++;
    let state = null, failure = null;
    try { state = await link.send('status'); } catch (error) { failure = error; }
    this.inflight--;
    if (this.link !== link) return;
    if (failure) this.onLost(link, failure); else this.apply(state);
  }
  // Hidden tabs get slowed timers, which would let the watchdog cut power mid-step.
  pageHidden() {
    if (this.walking && !this.live.walking.stopping) {
      this.release(); this.send('walk_stop');
      this.say('The page was hidden, so the robot is stopping. Keep Hexapod Remote visible while walking.', true);
    }
  }
  destroy() { this.stopPolling(); this.listeners.clear(); }
}

export {NAMES};
