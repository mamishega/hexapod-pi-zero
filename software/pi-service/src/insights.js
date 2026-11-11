// Battery runtime estimate, battery use by activity, and a quality score for each gait and setting.
// Worked out from the robot updates the Live View already receives (read-only). Gait results are
// saved to a small JSON file so they build up over many sessions.
import fs from 'node:fs';
import path from 'node:path';
import {bodyStep, balance} from '../live/motion-geometry.js';

const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const MAX_DT = 2000;
const TREND_EVERY_MS = 10000, TREND_KEEP_MS = 15 * 60000, TREND_MIN_MS = 3 * 60000; // voltage trend: a point every 10 s, 15 minutes
const MIN_GAIT_MS = 10000; // a setting needs 10 s of walking before it gets a score

// Least-squares slope (volts per minute) of points [{t, v}].
export function slope(points) {
  if (points.length < 3) return null;
  const n = points.length, mt = points.reduce((s, p) => s + p.t, 0) / n, mv = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0, den = 0;
  for (const p of points) { num += (p.t - mt) * (p.v - mv); den += (p.t - mt) ** 2; }
  return den ? (num / den) * 60000 : null;
}
// Minutes until the smoothed voltage reaches `low`, from the trend, or why there is no estimate yet.
export function runtime(points, low, now) {
  const recent = points.filter(p => p.t >= now - TREND_KEEP_MS);
  if (!recent.length || now - recent[0].t < TREND_MIN_MS) return {minutes: null, reason: 'collecting', needMinutes: Math.ceil((TREND_MIN_MS - (recent.length ? now - recent[0].t : 0)) / 60000)};
  const k = slope(recent), v = recent.at(-1).v;
  if (v <= low) return {minutes: 0, reason: 'low'};
  if (k === null || k > -0.002) return {minutes: null, reason: 'steady'}; // not falling measurably (resting, or charging)
  return {minutes: Math.min(600, Math.round((v - low) / -k)), reason: 'trend', perMinute: r2(k * 1000) / 1000, basedOnMinutes: Math.round((now - recent[0].t) / 60000)};
}

// Score out of 100 for each setting: stability 50, speed 30, battery efficiency 20 (speed and
// efficiency relative to the best setting tried).
export function scoreRows(rows) {
  const ok = rows.filter(r => r.ms >= MIN_GAIT_MS);
  const best = (f) => Math.max(1e-9, ...ok.map(f));
  const bestSpeed = best(r => r.distance / r.ms), bestEff = best(r => (r.ampMs > 0 ? r.distance / r.ampMs : 0));
  return rows.map(r => {
    const scored = r.ms >= MIN_GAIT_MS, avgMargin = r.marginN ? r.marginSum / r.marginN : null, stablePct = r.marginN ? 100 * r.stableN / r.marginN : null;
    const speed = r.ms ? r.distance / r.ms * 1000 : 0, eff = r.ampMs > 0 ? r.distance / r.ampMs : null;
    let score = null, parts = null;
    if (scored && avgMargin !== null) {
      const stability = Math.max(0, Math.min(1, avgMargin / 80)) * 50 * (stablePct / 100);
      const fast = 30 * Math.min(1, (r.distance / r.ms) / bestSpeed), thrift = eff === null ? 0 : 20 * Math.min(1, eff / bestEff);
      parts = {stability: Math.round(stability), speed: Math.round(fast), efficiency: Math.round(thrift)};
      score = parts.stability + parts.speed + parts.efficiency;
    }
    return {gait: r.gait, speed: r.speed, lift: r.lift, hipSwing: r.hipSwing, seconds: Math.round(r.ms / 1000), distanceM: r2(r.distance / 1000),
      mmPerSecond: Math.round(speed), avgMargin: avgMargin === null ? null : Math.round(avgMargin), minMargin: r.minMargin === null ? null : Math.round(r.minMargin),
      stablePct: stablePct === null ? null : r1(stablePct), avgCurrent: r.ms ? r2(r.ampMs / r.ms) : null,
      metresPerAh: eff === null ? null : r1(eff * 3600), score, parts, scored};
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.seconds - a.seconds);
}

export function createInsights({file = null, now = Date.now, battery = {}, fsModule = fs} = {}) {
  const low = Number(battery.low ?? 7.0), capacityMah = Number(battery.capacityMah) || null;
  const gaits = new Map(); // "gait|speed|lift|hipSwing" -> totals
  const usage = {};         // off / standing / <gait> -> {ms, ampMs}
  const trend = [];         // smoothed voltage points
  let prev = null, smooth = null, lastTrend = -Infinity, dirty = false;
  if (file) {
    try {
      const saved = JSON.parse(fsModule.readFileSync(file, 'utf8'));
      for (const g of saved.gaits || []) gaits.set(`${g.gait}|${g.speed}|${g.lift}|${g.hipSwing}`, {...g});
      Object.assign(usage, saved.usage || {});
    } catch { /* first run */ }
  }
  const api = {
    robot(snapshot) {
      const t = now(), live = snapshot?.live, st = snapshot?.settings || {};
      if (!live) { prev = null; return; }
      const dt = prev ? Math.min(MAX_DT, Math.max(0, t - prev.t)) : 0, w = live.walking, amps = live.power?.current, volts = live.power?.voltage;
      // Battery use by activity
      const state = !live.active ? 'off' : w ? w.gait : 'standing';
      if (dt) { const u = usage[state] || (usage[state] = {ms: 0, ampMs: 0}); u.ms += dt; if (Number.isFinite(amps)) u.ampMs += amps * dt; dirty = true; }
      // Smoothed voltage (1-minute time constant) for the runtime trend
      if (Number.isFinite(volts)) {
        smooth = smooth === null || !dt ? volts : smooth + (volts - smooth) * Math.min(1, dt / 60000);
        if (t - lastTrend >= TREND_EVERY_MS) { lastTrend = t; trend.push({t, v: smooth}); while (trend.length && trend[0].t < t - TREND_KEEP_MS) trend.shift(); }
      }
      // Gait quality: only while walking (not stopping or blending into another gait)
      if (w && !w.stopping && !w.blending && live.positions && prev?.walking && prev.positions && dt) {
        const key = `${w.gait}|${st.speed}|${st.lift}|${st.hipSwing}`;
        const g = gaits.get(key) || {gait: w.gait, speed: st.speed, lift: st.lift, hipSwing: st.hipSwing, ms: 0, distance: 0, ampMs: 0, marginSum: 0, marginN: 0, stableN: 0, minMargin: null};
        g.ms += dt;
        const step = bodyStep(prev.positions, live.positions);
        if (Number.isFinite(step.dx)) g.distance += Math.hypot(step.dx, step.dy);
        if (Number.isFinite(amps)) g.ampMs += amps * dt;
        try {
          const b = balance(live.positions);
          if (Number.isFinite(b.margin)) { g.marginSum += b.margin; g.marginN++; if (b.stable) g.stableN++; g.minMargin = g.minMargin === null ? b.margin : Math.min(g.minMargin, b.margin); }
          else { g.marginN++; }
        } catch {}
        gaits.set(key, g); dirty = true;
      }
      prev = {t, walking: !!w, positions: live.positions};
    },
    battery() {
      const est = runtime(trend, low, now());
      const use = Object.entries(usage).filter(([, u]) => u.ms >= 5000).map(([state, u]) => {
        const amps = u.ampMs / u.ms;
        return {state, minutes: Math.round(u.ms / 60000), avgCurrent: r2(amps), fullBatteryMinutes: capacityMah && amps > 0.05 ? Math.round(capacityMah * 0.8 / (amps * 1000) * 60) : null};
      }).sort((a, b) => b.avgCurrent - a.avgCurrent);
      return {...est, low, capacityMah, usage: use};
    },
    gaits() { return scoreRows([...gaits.values()]); },
    reset() { gaits.clear(); for (const k of Object.keys(usage)) delete usage[k]; dirty = true; },
    save() {
      if (!file || !dirty) return;
      try {
        fsModule.mkdirSync(path.dirname(file), {recursive: true});
        fsModule.writeFileSync(`${file}.tmp`, JSON.stringify({format: 'hexapod-insights', version: 1, gaits: [...gaits.values()], usage}));
        fsModule.renameSync(`${file}.tmp`, file); dirty = false;
      } catch (error) { console.error(`Insights not saved: ${error.message}`); }
    },
  };
  return api;
}
