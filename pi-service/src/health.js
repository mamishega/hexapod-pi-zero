// Robot health for the Live View's Health and Servo care pages (read-only, like the rest of the page).
// - ServoStats: how hard each of the 18 servos works (angle travel, time close to a limit), from the
//   angles the Servo 2040 reports. Lifetime totals are saved to a small JSON file.
// - createHealth: samples the Pi (temperature, power warnings, Wi-Fi), the controller (connection,
//   battery), the board link (reply times, errors) and the battery, and keeps a list of events.
// Nothing here ever throws into the driving service: every reading is optional.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';

export const LEG_NAMES = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
export const JOINT_NAMES = ['hip', 'upper leg', 'knee'];
export const NEAR_DEG = 10;            // "close to a limit": within this many degrees of the end of travel
export const SERVO_RANGE = 90;         // a servo's own travel: -90..90 degrees (500..2500 us pulses)
export const LARGE_OFFSET_DEG = 25;    // an offset this big uses up a lot of travel on one side: move the horn a tooth (about 14°)
const MAX_STEP_DEG = 60;               // a bigger jump between two updates is a re-enable, not movement
const MAX_DT_MS = 2000;                // gaps longer than this (link lost) are not counted as time
const round = (v, k = 10) => Math.round(v * k) / k;

// ---------------------------------------------------------------- servo statistics
const blank = () => Array.from({length: 18}, () => ({travel: 0, activeMs: 0, nearMs: 0, hits: 0}));

export class ServoStats {
  constructor({file = null, now = Date.now, servoRange = SERVO_RANGE, readFile = fs.readFileSync, writeFile = fs.writeFileSync} = {}) {
    this.file = file; this.now = now; this.servoRange = servoRange; this.writeFile = writeFile;
    this.session = blank(); this.lifetime = blank(); this.startedAt = now(); this.firstUse = now();
    this.seen = Array.from({length: 18}, () => ({min: null, max: null}));
    this.prev = null; this.prevT = null; this.near = new Array(18).fill(false);
    this.limits = [[-180, 180], [-180, 180], [-180, 180]]; this.offsets = null; this.angles = null; this.released = [];
    this.activeMs = 0; this.lifetimeActiveMs = 0; this.dirty = false;
    if (file) {
      try {
        const saved = JSON.parse(readFile(file, 'utf8'));
        if (Array.isArray(saved.servos) && saved.servos.length === 18) {
          this.lifetime = saved.servos.map(s => ({travel: +s.travel || 0, activeMs: +s.activeMs || 0, nearMs: +s.nearMs || 0, hits: +s.hits || 0}));
          this.lifetimeActiveMs = +saved.activeMs || 0; this.firstUse = +saved.firstUse || this.firstUse;
        }
      } catch { /* no file yet, or unreadable: start counting from zero */ }
    }
  }
  // The usable range of one joint: the board's joint limit, inside the servo's own travel.
  range(joint) {
    const [low, high] = this.limits[joint] || [-180, 180];
    return [Math.max(low, -this.servoRange), Math.min(high, this.servoRange)];
  }
  // live: the board's state ({active, angles: 6 x 3 degrees, joint_limits, offsets, released}).
  update(live, t = this.now()) {
    if (!live) { this.prev = null; return; }
    if (Array.isArray(live.joint_limits) && live.joint_limits.length === 3) this.limits = live.joint_limits.map(p => [+p[0], +p[1]]);
    if (Array.isArray(live.offsets)) this.offsets = live.offsets;
    this.released = Array.isArray(live.released) ? live.released : [];
    const angles = Array.isArray(live.angles) && live.angles.length === 6 ? live.angles : null;
    this.angles = angles;
    if (!live.active || !angles) { this.prev = null; this.near.fill(false); return; }
    const dt = this.prevT === null ? 0 : t - this.prevT;
    const counted = this.prev && dt > 0 && dt <= MAX_DT_MS;
    if (counted) { this.activeMs += dt; this.lifetimeActiveMs += dt; }
    for (let leg = 0; leg < 6; leg++) for (let j = 0; j < 3; j++) {
      const k = leg * 3 + j, a = angles[leg]?.[j];
      if (!Number.isFinite(a)) continue;
      const seen = this.seen[k];
      seen.min = seen.min === null ? a : Math.min(seen.min, a); seen.max = seen.max === null ? a : Math.max(seen.max, a);
      const [low, high] = this.range(j), near = a <= low + NEAR_DEG || a >= high - NEAR_DEG;
      if (near && !this.near[k]) { this.session[k].hits++; this.lifetime[k].hits++; }
      this.near[k] = near;
      if (!counted) continue;
      const step = Math.abs(a - this.prev[leg][j]);
      for (const s of [this.session[k], this.lifetime[k]]) {
        if (step <= MAX_STEP_DEG) s.travel += step;
        s.activeMs += dt; if (near) s.nearMs += dt;
      }
    }
    this.prev = angles.map(row => row.slice()); this.prevT = t; this.dirty = true;
  }
  // One row per servo, in output order (L1 hip = output 1 ... R3 knee = output 18).
  rows() {
    return Array.from({length: 18}, (_, k) => {
      const leg = Math.floor(k / 3), j = k % 3, [low, high] = this.range(j), s = this.session[k], l = this.lifetime[k];
      const angle = this.angles?.[leg]?.[j], offset = this.offsets?.[leg]?.[j];
      const margin = Number.isFinite(angle) ? Math.min(angle - low, high - angle) : null;
      const flags = [];
      if (Number.isFinite(margin) && margin <= NEAR_DEG) flags.push('near-limit');
      if (s.activeMs > 30000 && s.nearMs / s.activeMs > 0.2) flags.push('often-near-limit');
      if (Number.isFinite(offset) && Math.abs(offset) >= LARGE_OFFSET_DEG) flags.push('large-offset');
      if (this.released.includes?.(leg)) flags.push('released'); // the board lists released legs
      return {output: k + 1, leg: LEG_NAMES[leg], joint: JOINT_NAMES[j], angle: Number.isFinite(angle) ? round(angle) : null,
        low, high, margin: margin === null ? null : round(margin), min: this.seen[k].min, max: this.seen[k].max,
        offset: Number.isFinite(offset) ? round(offset) : null,
        session: {travel: Math.round(s.travel), nearPct: s.activeMs ? round(100 * s.nearMs / s.activeMs) : 0, hits: s.hits},
        lifetime: {travel: Math.round(l.travel), nearPct: l.activeMs ? round(100 * l.nearMs / l.activeMs) : 0, hits: l.hits},
        flags};
    });
  }
  summary() {
    return {rows: this.rows(), nearDeg: NEAR_DEG, servoRange: this.servoRange, largeOffset: LARGE_OFFSET_DEG,
      session: {since: this.startedAt, activeSec: Math.round(this.activeMs / 1000)},
      lifetime: {since: this.firstUse, activeSec: Math.round(this.lifetimeActiveMs / 1000)}, saved: !!this.file};
  }
  save() {
    if (!this.file || !this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), {recursive: true});
      const data = {format: 'hexapod-servo-stats', version: 1, firstUse: this.firstUse, savedAt: this.now(), activeMs: Math.round(this.lifetimeActiveMs),
        servos: this.lifetime.map(s => ({travel: Math.round(s.travel), activeMs: Math.round(s.activeMs), nearMs: Math.round(s.nearMs), hits: s.hits}))};
      const tmp = `${this.file}.tmp`;
      this.writeFile(tmp, JSON.stringify(data)); fs.renameSync(tmp, this.file); this.dirty = false;
    } catch (error) { console.error(`Servo stats not saved: ${error.message}`); }
  }
}

// ---------------------------------------------------------------- Pi readings
// `vcgencmd get_throttled` -> what is wrong now, and what has gone wrong since the Pi started.
export function parseThrottled(text) {
  const m = /throttled=(0x[0-9a-f]+)/i.exec(text || '');
  if (!m) return null;
  const v = parseInt(m[1], 16), bit = n => !!(v & (1 << n));
  return {raw: m[1], underVoltage: bit(0), freqCapped: bit(1), throttled: bit(2), softTemp: bit(3),
    underVoltageSeen: bit(16), freqCappedSeen: bit(17), throttledSeen: bit(18), softTempSeen: bit(19)};
}
// /proc/net/wireless -> Wi-Fi signal of the first wireless interface (dBm, and link quality out of 70).
export function parseWireless(text) {
  const line = (text || '').split('\n').find(l => /^\s*\w+:\s+\d/.test(l));
  if (!line) return null;
  const [, iface, , quality, level] = /^\s*(\w+):\s+(\d+)\s+([-\d.]+)\.?\s+([-\d.]+)/.exec(line) || [];
  if (!iface) return null;
  const dbm = Number(level);
  return {iface, quality: Number(quality), dbm: Number.isFinite(dbm) ? dbm : null};
}
export const wifiText = dbm => !Number.isFinite(dbm) ? null : dbm >= -60 ? 'strong' : dbm >= -70 ? 'good' : dbm >= -78 ? 'weak' : 'very weak';
export function batteryState(volts, {low, critical}) {
  if (!Number.isFinite(volts)) return null;
  return volts <= critical ? 'critical' : volts <= low ? 'low' : 'ok';
}

// The controller's battery, from the power_supply entry its driver (xpadneo, xpad) creates.
export function findPadBattery(root = '/sys/class/power_supply', fsModule = fs) {
  let names = [];
  try { names = fsModule.readdirSync(root); } catch { return null; }
  if (!Array.isArray(names)) return null;
  for (const name of names) {
    const read = f => { try { return fsModule.readFileSync(path.join(root, name, f), 'utf8').trim(); } catch { return null; } };
    const model = `${read('model_name') || ''} ${name}`;
    if (!/xbox|controller|gamepad|xpad/i.test(model) || read('scope') === 'System') continue;
    const capacity = Number(read('capacity'));
    return {level: read('capacity_level'), percent: Number.isFinite(capacity) && read('capacity') !== null ? capacity : null, status: read('status')};
  }
  return null;
}

const runCommand = (cmd, args, timeout = 2000) => new Promise(resolve => {
  try { execFile(cmd, args, {timeout}, (error, stdout) => resolve(error ? null : String(stdout))); } catch { resolve(null); }
});
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// ---------------------------------------------------------------- the health monitor
const EVENTS_KEEP = 40;

export function createHealth({now = Date.now, simulated = false, statsFile = null, battery = {}, run = runCommand, read = readText,
  padBattery = () => findPadBattery(), servoRange = SERVO_RANGE} = {}) {
  const thresholds = {low: Number(battery.low ?? 7.0), critical: Number(battery.critical ?? 6.6), cells: battery.cells || '2S LiPo'};
  const stats = new ServoStats({file: statsFile, now, servoRange});
  const events = [];
  const pi = {temp: null, throttled: null, wifi: null, load: null, memFreeMB: null, memTotalMB: null, uptime: null, available: !simulated && os.platform() === 'linux'};
  const pad = {connected: false, since: null, drops: 0, lastDrop: null, battery: null, everConnected: false};
  const board = {connection: 'offline', since: now(), offlineCount: 0, replies: 0, errors: 0, timeouts: 0, times: []};
  const power = {v: null, a: null, min: null, sim: false, state: null};
  let motorsOn = false, lastMessage = '';

  function event(level, text, t = now()) {
    events.push({t, level, text});
    if (events.length > EVENTS_KEEP) events.splice(0, events.length - EVENTS_KEEP);
  }
  event('info', 'Driving service started');

  const api = {
    stats,
    // The robot snapshot (connection, message, live) on every update.
    robot(snapshot) {
      const t = now(), live = snapshot?.live;
      const connection = snapshot?.connection || 'offline';
      if (connection !== board.connection) {
        if (connection === 'online') event('ok', 'Servo 2040 link connected', t);
        else if (board.connection === 'online') { board.offlineCount++; event('bad', 'Servo 2040 link lost', t); }
        board.connection = connection; board.since = t;
      }
      const text = snapshot?.message?.text || '';
      if (text !== lastMessage) {
        lastMessage = text;
        if (/Connection timeout/i.test(text)) event('bad', 'Watchdog: the board switched the motors off (no command for 3 s)', t);
        else if (/stopped the movement/i.test(text)) event('warn', text, t);
      }
      motorsOn = !!live?.active;
      stats.update(live, t);
      const p = live?.power;
      if (Number.isFinite(p?.voltage)) {
        const before = power.state;
        power.v = p.voltage; power.a = Number.isFinite(p.current) ? p.current : null; power.sim = !!p.simulated;
        power.min = power.min === null ? p.voltage : Math.min(power.min, p.voltage);
        power.state = batteryState(p.voltage, thresholds);
        if (power.state !== before && power.state !== 'ok' && before !== null) event(power.state === 'critical' ? 'bad' : 'warn', `Battery ${power.state}: ${p.voltage.toFixed(2)} V`, t);
      }
    },
    pad(connected) {
      const t = now();
      if (connected === pad.connected) return;
      if (connected) { event('ok', pad.everConnected ? `Controller reconnected${pad.lastDrop ? ` after ${Math.round((t - pad.lastDrop) / 1000)} s` : ''}` : 'Controller connected', t); pad.everConnected = true; }
      else { pad.drops++; pad.lastDrop = t; event(motorsOn ? 'bad' : 'warn', motorsOn ? 'Controller disconnected while the motors were on' : 'Controller disconnected', t); }
      pad.connected = connected; pad.since = t;
    },
    // One board reply: how long it took, and whether it failed.
    reply(ms, ok = true, timeout = false) {
      board.replies++;
      if (!ok) board.errors++;
      if (timeout) board.timeouts++;
      if (Number.isFinite(ms)) { board.times.push(ms); if (board.times.length > 50) board.times.shift(); }
    },
    // Reads the Pi and the controller battery (every few seconds).
    async sample() {
      if (simulated) {
        const t = now() / 1000;
        Object.assign(pi, {temp: round(47 + 3 * Math.sin(t / 60)), throttled: parseThrottled('throttled=0x0'), wifi: {iface: 'wlan0', quality: 52, dbm: -58 + Math.round(2 * Math.sin(t / 7))},
          load: round(0.4 + 0.15 * Math.sin(t / 30), 100), memFreeMB: 240, memTotalMB: 427, uptime: Math.round(process.uptime()) + 95});
        pad.battery = pad.connected ? {level: 'High', percent: null, status: 'Discharging'} : null;
        return;
      }
      if (!pi.available) return;
      const temp = Number(read('/sys/class/thermal/thermal_zone0/temp'));
      pi.temp = Number.isFinite(temp) && temp > 0 ? round(temp / 1000) : null;
      const before = pi.throttled;
      pi.throttled = parseThrottled(await run('vcgencmd', ['get_throttled']));
      if (pi.throttled?.underVoltage && !before?.underVoltage) event('bad', 'Pi power supply too low (under-voltage): check the 5 V converter', now());
      else if (pi.throttled?.underVoltageSeen && !before?.underVoltageSeen && before) event('warn', 'The Pi’s supply dipped below 4.63 V', now());
      if (pi.throttled?.softTemp && !before?.softTemp) event('warn', 'Pi is hot: speed reduced to cool down', now());
      pi.wifi = parseWireless(read('/proc/net/wireless'));
      pi.load = round(os.loadavg()[0], 100); pi.memFreeMB = Math.round(os.freemem() / 1048576); pi.memTotalMB = Math.round(os.totalmem() / 1048576); pi.uptime = Math.round(os.uptime());
      pad.battery = pad.connected ? padBattery() : null;
    },
    // Problems to show in the banner, most serious first.
    alerts() {
      const list = [];
      if (power.state === 'critical') list.push({level: 'bad', text: `Battery critical (${power.v.toFixed(2)} V): stop and charge it now`});
      else if (power.state === 'low') list.push({level: 'warn', text: `Battery low (${power.v.toFixed(2)} V): finish soon and charge it`});
      if (pi.throttled?.underVoltage) list.push({level: 'bad', text: 'Pi power supply too low: check the 5 V converter and its wires'});
      if (Number.isFinite(pi.temp) && pi.temp >= 80) list.push({level: 'bad', text: `Pi very hot (${pi.temp} °C)`});
      else if (Number.isFinite(pi.temp) && pi.temp >= 70) list.push({level: 'warn', text: `Pi hot (${pi.temp} °C)`});
      if (board.connection !== 'online') list.push({level: 'warn', text: 'Servo 2040 link offline'});
      if (!pad.connected && motorsOn) list.push({level: 'warn', text: 'Controller not connected while the motors are on'});
      if (/^(Low|Critical)$/i.test(pad.battery?.level || '')) list.push({level: 'warn', text: `Controller battery ${pad.battery.level.toLowerCase()}`});
      const near = stats.rows().filter(r => r.flags.includes('near-limit') && motorsOn);
      if (near.length) list.push({level: 'warn', text: `${near.length} servo${near.length > 1 ? 's' : ''} at the end of travel: ${near.slice(0, 3).map(r => `${r.leg} ${r.joint}`).join(', ')}${near.length > 3 ? '…' : ''}`});
      return list;
    },
    snapshot() {
      const times = board.times, avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
      return {t: now(), simulated,
        pi: {...pi, wifiText: wifiText(pi.wifi?.dbm), serviceUptime: Math.round(process.uptime())},
        controller: {connected: pad.connected, since: pad.since, drops: pad.drops, lastDrop: pad.lastDrop, battery: pad.battery},
        board: {connection: board.connection, since: board.since, offlineCount: board.offlineCount, replies: board.replies, errors: board.errors, timeouts: board.timeouts,
          replyMs: avg === null ? null : {avg: Math.round(avg), max: Math.round(Math.max(...times)), last: Math.round(times.at(-1))}},
        battery: {...power, ...thresholds}, motorsOn,
        alerts: api.alerts(), events: events.slice().reverse(), servos: stats.summary()};
    },
    close() { stats.save(); },
  };
  return api;
}
