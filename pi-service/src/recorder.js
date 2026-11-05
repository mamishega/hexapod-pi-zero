// Session recorder for the Live View (read-only: it only listens).
// - Sessions: from the motors being switched on until they have been off for a while. Each one is
//   saved as a CSV file (twice a second: angles, battery, gait, balance) plus a summary.
// - Incidents: when something goes wrong (controller lost while walking, board link lost, watchdog,
//   battery critical, Pi power too low) the last 30 seconds and the next 5 are saved for replay.
// Files go to ~/.hexapod/sessions and ~/.hexapod/incidents, within a size limit so the microSD card
// never fills up. Writes are batched (every 10 s) to spare the card.
import fs from 'node:fs';
import path from 'node:path';
import {bodyStep, balance} from '../live/motion-geometry.js';

const KEEP_MS = 35000;          // frames kept in memory for incidents
const BEFORE_MS = 30000, AFTER_MS = 5000;
const ROW_MS = 500;             // CSV rows: twice a second
const FLUSH_MS = 10000;         // write the CSV every 10 s
const END_AFTER_MS = 30000;     // a session ends 30 s after the motors go off
const MIN_SESSION_MS = 5000;    // shorter sessions (a quick enable/disable) are not kept
export const LEGS = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'], JOINTS = ['hip', 'upper', 'knee'];
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const stamp = t => new Date(t).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261105-143012

export const CSV_HEADER = ['time_s', 'motors', 'walking', 'gait', 'speed', 'step_height', 'stride', 'voltage', 'current', 'controller', 'balance_mm',
  ...LEGS.flatMap(l => JOINTS.map(j => `${l}_${j}`))].join(',');

export function createRecorder({dir = null, now = Date.now, maxBytes = 50 * 1024 * 1024, maxIncidents = 30, fsModule = fs, log = () => {}} = {}) {
  const sessionsDir = dir && path.join(dir, 'sessions'), incidentsDir = dir && path.join(dir, 'incidents');
  const frames = [];
  let session = null, pad = false, lastRow = -Infinity, lastFlush = -Infinity, prevPositions = null;
  const pending = []; // incidents still collecting their "after" frames
  const memory = [];  // finished incidents when there is no folder to save them in (the demo)
  const safe = fn => { try { return fn(); } catch (error) { log(`Recorder: ${error.message}`); return undefined; } };
  const ensure = d => d && fsModule.mkdirSync(d, {recursive: true});

  // ---------------------------------------------------------------- saved files
  const indexFile = () => path.join(sessionsDir, 'index.json');
  function readIndex() {
    if (!sessionsDir) return [];
    try { const list = JSON.parse(fsModule.readFileSync(indexFile(), 'utf8')); return Array.isArray(list) ? list : []; } catch { return []; }
  }
  function writeIndex(list) { ensure(sessionsDir); fsModule.writeFileSync(indexFile(), JSON.stringify(list)); }
  // Oldest sessions go first once the folder is over its size limit.
  function prune(list) {
    const size = s => { try { return fsModule.statSync(path.join(sessionsDir, `${s.id}.csv`)).size; } catch { return 0; } };
    let total = list.reduce((sum, s) => sum + size(s), 0);
    while (list.length > 1 && total > maxBytes) {
      const old = list.shift(); total -= size(old);
      try { fsModule.unlinkSync(path.join(sessionsDir, `${old.id}.csv`)); } catch {}
    }
    return list;
  }
  function flush(force = false) {
    if (!session || !sessionsDir || (!force && now() - lastFlush < FLUSH_MS) || !session.rows.length) return;
    lastFlush = now();
    safe(() => {
      ensure(sessionsDir);
      const file = path.join(sessionsDir, `${session.id}.csv`);
      if (!session.written) { fsModule.writeFileSync(file, `${CSV_HEADER}\n`); session.written = true; }
      fsModule.appendFileSync(file, `${session.rows.join('\n')}\n`); session.rows = [];
    });
  }

  // ---------------------------------------------------------------- sessions
  const summary = s => ({id: s.id, start: s.start, end: s.end ?? null, seconds: Math.round(((s.end ?? s.last) - s.start) / 1000),
    activeSeconds: Math.round(s.activeMs / 1000), walkingSeconds: Math.round(s.walkMs / 1000), distanceM: r2(s.distance / 1000), gaits: [...s.gaits],
    minVoltage: r2(s.minV), maxCurrent: r2(s.maxA), avgCurrent: s.ampMs && s.activeMs ? r2(s.ampMs / s.activeMs) : null, incidents: s.incidents,
    file: !!sessionsDir});
  function startSession(t) {
    session = {id: stamp(t), start: t, last: t, offSince: null, activeMs: 0, walkMs: 0, distance: 0, gaits: new Set(), minV: null, maxA: null, ampMs: 0,
      incidents: 0, rows: [], written: false, prevT: t};
    lastRow = -Infinity; lastFlush = t;
  }
  function endSession(t) {
    if (!session) return;
    session.end = session.offSince ?? t;
    const keep = session.end - session.start >= MIN_SESSION_MS;
    if (keep) flush(true);
    if (sessionsDir) safe(() => {
      if (!keep) { try { fsModule.unlinkSync(path.join(sessionsDir, `${session.id}.csv`)); } catch {} return; }
      writeIndex(prune([...readIndex().filter(s => s.id !== session.id), summary(session)]));
    });
    session = null;
  }

  // ---------------------------------------------------------------- incidents
  function saveIncident(inc) {
    if (!incidentsDir) { memory.unshift({id: inc.id, t: inc.t, text: inc.text, level: inc.level, frames: inc.frames}); memory.length = Math.min(memory.length, maxIncidents); return; }
    safe(() => {
      ensure(incidentsDir);
      fsModule.writeFileSync(path.join(incidentsDir, `${inc.id}.json`), JSON.stringify({id: inc.id, t: inc.t, text: inc.text, level: inc.level, frames: inc.frames}));
      const files = fsModule.readdirSync(incidentsDir).filter(f => /\.json$/.test(f)).sort();
      for (const f of files.slice(0, Math.max(0, files.length - maxIncidents))) fsModule.unlinkSync(path.join(incidentsDir, f));
    });
  }

  const api = {
    // Every robot update (the same snapshot the Live View sends).
    robot(snapshot) {
      const t = now(), live = snapshot?.live;
      const p = live?.power, w = live?.walking, st = snapshot?.settings || {};
      const frame = live ? {t, positions: live.positions || null, angles: live.angles || null, active: !!live.active,
        walking: w ? {gait: w.gait, cycle: Number.isFinite(w.cycle) ? r2(w.cycle * 100) / 100 : null, period: w.period, stopping: !!w.stopping} : null,
        v: r2(p?.voltage), a: r2(p?.current), pad} : {t, positions: null, angles: null, active: false, walking: null, v: null, a: null, pad};
      frames.push(frame);
      while (frames.length && frames[0].t < t - KEEP_MS) frames.shift();
      for (const inc of pending.slice()) {
        inc.frames.push(frame);
        if (t >= inc.until) { saveIncident(inc); pending.splice(pending.indexOf(inc), 1); }
      }
      // Session bookkeeping
      if (frame.active) { if (!session) startSession(t); session.offSince = null; }
      else if (session && session.offSince === null) session.offSince = t;
      if (!session) { prevPositions = null; return; }
      if (session.offSince !== null && t - session.offSince >= END_AFTER_MS) { endSession(t); prevPositions = null; return; }
      const dt = Math.min(2000, Math.max(0, t - session.prevT)); session.prevT = t; session.last = t;
      if (frame.active) {
        session.activeMs += dt;
        if (Number.isFinite(frame.a)) { session.ampMs += frame.a * dt; session.maxA = session.maxA === null ? frame.a : Math.max(session.maxA, frame.a); }
      }
      if (Number.isFinite(frame.v)) session.minV = session.minV === null ? frame.v : Math.min(session.minV, frame.v);
      if (w) {
        session.walkMs += dt; session.gaits.add(w.gait);
        if (prevPositions && frame.positions) { const s = bodyStep(prevPositions, frame.positions); if (Number.isFinite(s.dx)) session.distance += Math.hypot(s.dx, s.dy); }
      }
      prevPositions = frame.positions;
      if (frame.active && t - lastRow >= ROW_MS) { // rows only while the motors are on
        lastRow = t;
        let margin = null;
        if (frame.positions) { const b = safe(() => balance(frame.positions)); margin = b && Number.isFinite(b.margin) ? r1(b.margin) : null; }
        session.rows.push([r1((t - session.start) / 1000), frame.active ? 1 : 0, w ? 1 : 0, w?.gait || '', st.speed ?? '', st.lift ?? '', st.hipSwing ?? '',
          frame.v ?? '', frame.a ?? '', pad ? 1 : 0, margin ?? '', ...Array.from({length: 18}, (_, k) => r1(frame.angles?.[Math.floor(k / 3)]?.[k % 3]) ?? '')].join(','));
      }
      flush();
    },
    pad(connected) { pad = !!connected; },
    // A Health event: serious ones ('bad') are kept for replay. Returns the incident id, or null.
    event({t = now(), level, text}) {
      if (level !== 'bad') return null;
      const id = `${stamp(t)}-${Math.random().toString(36).slice(2, 6)}`;
      pending.push({id, t, text, level, until: t + AFTER_MS, frames: frames.filter(f => f.t >= t - BEFORE_MS)});
      if (session) session.incidents++;
      return id;
    },
    // The current session (live) and the saved ones, newest first.
    sessions() {
      const list = readIndex().slice().reverse();
      return session ? [{...summary(session), current: true}, ...list.filter(s => s.id !== session.id)] : list;
    },
    // CSV text of one session (saved part, plus what is still waiting to be written).
    csv(id) {
      if (!/^[0-9]{8}-[0-9]{6}$/.test(id || '')) return null;
      let text = null;
      if (sessionsDir) try { text = fsModule.readFileSync(path.join(sessionsDir, `${id}.csv`), 'utf8'); } catch {}
      if (session?.id === id && session.rows.length) text = (text || `${CSV_HEADER}\n`) + `${session.rows.join('\n')}\n`;
      return text;
    },
    incidents() {
      const out = [...pending.map(i => ({id: i.id, t: i.t, text: i.text, saving: true})), ...memory.map(i => ({id: i.id, t: i.t, text: i.text, frames: i.frames.length}))];
      if (incidentsDir) safe(() => {
        for (const f of fsModule.readdirSync(incidentsDir).filter(n => /\.json$/.test(n)).sort().reverse()) {
          try { const d = JSON.parse(fsModule.readFileSync(path.join(incidentsDir, f), 'utf8')); out.push({id: d.id, t: d.t, text: d.text, frames: d.frames?.length || 0}); } catch {}
        }
      });
      return out;
    },
    incident(id) {
      if (!/^[0-9]{8}-[0-9]{6}-[a-z0-9]{1,6}$/.test(id || '')) return null;
      const p = pending.find(i => i.id === id);
      if (p) return {id: p.id, t: p.t, text: p.text, frames: p.frames, saving: true};
      const m = memory.find(i => i.id === id);
      if (m) return m;
      if (!incidentsDir) return null;
      try { return JSON.parse(fsModule.readFileSync(path.join(incidentsDir, `${id}.json`), 'utf8')); } catch { return null; }
    },
    close() { for (const inc of pending.splice(0)) saveIncident(inc); endSession(now()); },
  };
  return api;
}
