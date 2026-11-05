// Sessions page: gait scores, battery use, recorded sessions (CSV download) and incident replays.
import {legJoints, project} from './motion-geometry.js';
import {legSvg, bodySvg} from './robot-model.js';
import {Timeline} from './timeline.js';
import {duration} from './health-view.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const when = t => new Date(t).toLocaleString([], {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false});
const clockTime = t => new Date(t).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
const STATE_TEXT = {off: 'Motors off', standing: 'Standing (motors on)', tripod: 'Walking: tripod', ripple: 'Walking: ripple', wave: 'Walking: wave'};

// ---------------------------------------------------------------- battery
export function renderBattery(b, els) {
  if (!b) return;
  els.runtime.textContent = b.reason === 'trend' ? `About ${b.minutes} min left` : b.reason === 'low' ? 'At the low level now'
    : b.reason === 'collecting' ? `Measuring… (about ${b.needMinutes} min)` : b.reason === 'steady' ? 'Voltage steady' : '—';
  els.runtimeNote.textContent = b.reason === 'trend'
    ? `From how fast the voltage has been falling over the last ${b.basedOnMinutes} min, down to the low level (${b.low} V). It changes with what the robot is doing.`
    : `Needs a few minutes of the motors on to see how fast the voltage falls. Low level: ${b.low} V.`;
  els.usage.innerHTML = b.usage.length
    ? b.usage.map(u => `<tr><td>${esc(STATE_TEXT[u.state] || u.state)}</td><td class="num">${u.avgCurrent.toFixed(2)} A</td><td class="num">${u.fullBatteryMinutes ? `${u.fullBatteryMinutes} min` : '—'}</td><td class="num">${u.minutes} min</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Nothing measured yet.</td></tr>';
  els.usageNote.textContent = b.capacityMah ? `“On a full battery” assumes ${b.capacityMah} mAh, 80 % of it usable.` : 'Set the battery capacity (HEXAPOD_BATTERY_MAH) to see running time on a full battery.';
}

// ---------------------------------------------------------------- gaits
export function renderGaits(rows, el) {
  const scored = rows.filter(r => r.scored);
  if (!rows.length) { el.innerHTML = '<tr><td colspan="8" class="empty">Walk the robot for at least 10 seconds in a gait to see its score.</td></tr>'; return; }
  const best = scored.length ? Math.max(...scored.map(r => r.score)) : null;
  el.innerHTML = rows.map(r => `<tr class="${r.score === best && best !== null ? 'best' : ''}">
    <td><b>${esc(r.gait)}</b><small>${r.speed} steps/s · ${r.lift} mm · ${r.hipSwing}°</small></td>
    <td class="score">${r.scored ? `<span class="score-num">${r.score}</span><span class="score-bar" title="stability ${r.parts.stability} + speed ${r.parts.speed} + battery ${r.parts.efficiency}"><i class="s" style="width:${r.parts.stability}%"></i><i class="v" style="width:${r.parts.speed}%"></i><i class="e" style="width:${r.parts.efficiency}%"></i></span>` : '<small>needs 10 s</small>'}</td>
    <td class="num">${r.avgMargin ?? '—'} mm<small>lowest ${r.minMargin ?? '—'} mm</small></td>
    <td class="num">${r.stablePct ?? '—'}%</td>
    <td class="num">${r.mmPerSecond} mm/s</td>
    <td class="num">${r.avgCurrent ?? '—'} A</td>
    <td class="num">${r.metresPerAh ?? '—'} m</td>
    <td class="num">${duration(r.seconds)}</td></tr>`).join('');
}

// ---------------------------------------------------------------- sessions and incidents
export function renderSessions(list, el) {
  el.innerHTML = list.length ? list.map(s => `<tr${s.current ? ' class="current"' : ''}>
    <td><b>${esc(when(s.start))}</b>${s.current ? '<span class="pill">now</span>' : ''}</td>
    <td class="num">${duration(s.seconds)}</td><td class="num">${duration(s.walkingSeconds)}</td><td class="num">${s.distanceM ?? 0} m</td>
    <td>${esc(s.gaits.join(', ') || '—')}</td><td class="num">${s.minVoltage ?? '—'} V</td><td class="num">${s.incidents ? `<b class="warn">${s.incidents}</b>` : '0'}</td>
    <td><a class="btn-link" href="sessions/${esc(s.id)}.csv" download>CSV</a></td></tr>`).join('')
    : '<tr><td colspan="8" class="empty">No sessions yet. A session starts when the motors are switched on (A).</td></tr>';
}
export function renderIncidents(list, el, open) {
  el.innerHTML = list.length ? list.map(i => `<li><div><b>${esc(i.text)}</b><small>${esc(when(i.t))}${i.saving ? ' · saving the next 5 s…' : ''}</small></div>
    <button class="btn-link" type="button" data-incident="${esc(i.id)}"${i.saving ? ' disabled' : ''}>Replay</button></li>`).join('')
    : '<li class="empty">No incidents. Serious events (controller lost while walking, board link lost, watchdog stop, battery critical) are saved here with the 30 seconds before them.</li>';
  el.querySelectorAll('[data-incident]').forEach(b => b.addEventListener('click', () => open(b.dataset.incident)));
}

// ---------------------------------------------------------------- incident player
function drawRobot(pose, cam = 'angled') {
  const ground = Math.max(...pose.map(p => p[2]));
  let out = '<rect width="620" height="440" fill="var(--stage)"/>', grid = '';
  const poly = pts => pts.map(p => project(p, cam).map(v => v.toFixed(1)).join(',')).join(' ');
  for (let v = -320; v <= 320; v += 40) grid += `<polyline points="${poly([[-300, v, -ground], [300, v, -ground]])}"/><polyline points="${poly([[v, -300, -ground], [v, 300, -ground]])}"/>`;
  out += `<g fill="none" stroke="#2b474b" stroke-width=".7" opacity=".7">${grid}</g>`;
  const legs = pose.map((xyz, i) => ({i, joints: legJoints(xyz, i), lift: ground - xyz[2]}));
  const depth = p => project(p, cam)[1];
  legs.sort((a, b) => depth(a.joints[0]) - depth(b.joints[0]));
  const centre = depth([0, 0, 0]), back = legs.filter(l => depth(l.joints[0]) < centre), front = legs.filter(l => !back.includes(l));
  for (const l of legs) { const s = project([l.joints[3][0], l.joints[3][1], -ground], cam); out += `<ellipse cx="${s[0]}" cy="${s[1]}" rx="12" ry="5" fill="#071c22" opacity=".45"/>`; }
  const draw = l => legSvg(l.joints, l.i, 0, cam, l.lift > 1);
  return out + back.map(draw).join('') + bodySvg(0, cam) + front.map(draw).join('');
}

export function createIncidentPlayer(els) {
  let data = null, timeline = null, t = 0, playing = false, speed = 1, last = 0, raf = 0;
  const range = () => [timeline.start, timeline.end];
  function frameInfo() {
    const f = timeline.frameAt(t);
    if (!f) return;
    const rel = (t - data.t) / 1000;
    els.time.textContent = `${rel < 0 ? '−' : '+'}${Math.abs(rel).toFixed(1)} s${Math.abs(rel) < 0.3 ? ' · the incident' : ''}`;
    els.time.classList.toggle('at', Math.abs(rel) < 0.6);
    els.facts.innerHTML = [
      ['Motors', f.active ? (f.walking ? `walking (${f.walking.gait})` : 'on') : 'off'],
      ['Controller', f.pad ? 'connected' : 'not connected'],
      ['Battery', Number.isFinite(f.v) ? `${f.v.toFixed(2)} V${Number.isFinite(f.a) ? ` · ${f.a.toFixed(2)} A` : ''}` : '—'],
      ['Time', clockTime(f.t)],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
    const [lo, hi] = range();
    els.scrub.value = String(hi > lo ? Math.round((t - lo) / (hi - lo) * 1000) : 0);
  }
  function draw() {
    const pose = timeline.poseAt(t);
    els.svg.innerHTML = pose ? drawRobot(pose) : '<text x="310" y="220" text-anchor="middle" fill="#8a9ca1">No pose recorded (motors off)</text>';
    frameInfo();
  }
  function tick(now) {
    if (!playing || !data) return;
    t += (now - last) * speed; last = now;
    const [, hi] = range();
    if (t >= hi) { t = hi; setPlaying(false); }
    draw();
    raf = requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    playing = on; els.play.textContent = on ? 'Pause' : 'Play';
    if (on) { const [lo, hi] = range(); if (t >= hi) t = lo; last = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
  }
  els.play.addEventListener('click', () => data && setPlaying(!playing));
  els.slow.addEventListener('click', () => { speed = speed === 1 ? 0.25 : 1; els.slow.setAttribute('aria-pressed', String(speed < 1)); });
  els.scrub.addEventListener('input', () => { if (!data) return; const [lo, hi] = range(); t = lo + (hi - lo) * Number(els.scrub.value) / 1000; setPlaying(false); draw(); });
  els.close.addEventListener('click', () => { setPlaying(false); els.card.hidden = true; data = null; });
  return {
    async open(id) {
      els.card.hidden = false; els.title.textContent = 'Loading…'; els.svg.innerHTML = '';
      try {
        const res = await fetch(`incidents/${encodeURIComponent(id)}`, {cache: 'no-store'});
        if (!res.ok) throw new Error('not found');
        data = await res.json();
      } catch { els.title.textContent = 'This incident could not be loaded.'; return; }
      timeline = new Timeline(); timeline.hold = true;
      for (const f of data.frames) if (f.positions) timeline.push({t: f.t, positions: f.positions, angles: f.angles, active: f.active, walking: f.walking, v: f.v, a: f.a, pad: f.pad});
      els.title.textContent = data.text; els.when.textContent = when(data.t);
      if (!timeline.frames.length) { els.svg.innerHTML = '<text x="310" y="220" text-anchor="middle" fill="#8a9ca1">The motors were off: no movement recorded.</text>'; return; }
      t = Math.max(timeline.start, data.t - 10000); draw(); setPlaying(true);
      els.card.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    },
  };
}
