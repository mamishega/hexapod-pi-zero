// Health and Servo care pages, and the warning banner shown on every page.
// Draws the `health` updates the driving service sends every 2 seconds (src/health.js).
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

// "3 min", "2 h 5 min", "40 s"
export function duration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h < 48 ? `${h} h${m ? ` ${m} min` : ''}` : `${Math.round(h / 24)} days`;
}
// Battery time left, from the Sessions insights (src/insights.js runtime()).
export function runtimeText(rt) {
  if (!rt) return null;
  if (rt.reason === 'trend' && Number.isFinite(rt.minutes)) return `about ${rt.minutes} min left`;
  if (rt.reason === 'low') return 'at the low level now';
  if (rt.reason === 'collecting') return `time left: estimate in about ${rt.needMinutes} min`;
  if (rt.reason === 'steady') return 'voltage steady: no time estimate yet';
  return null;
}
export const ago = (t, now) => (Number.isFinite(t) ? `${duration((now - t) / 1000)} ago` : '—');
// Angle travel: 840° -> "840°", 12400° -> "12.4k°"
export const travel = deg => (!Number.isFinite(deg) ? '—' : deg >= 10000 ? `${(deg / 1000).toFixed(deg >= 100000 ? 0 : 1)}k°` : `${Math.round(deg)}°`);

// ---------------------------------------------------------------- banner (every page)
export function renderAlerts(h, bar, text, count) {
  const alerts = h?.alerts || [];
  bar.hidden = !alerts.length;
  count.hidden = !alerts.length; count.textContent = String(alerts.length);
  if (!alerts.length) return;
  bar.dataset.level = alerts.some(a => a.level === 'bad') ? 'bad' : 'warn';
  text.textContent = alerts.length > 1 ? `${alerts[0].text}  (+${alerts.length - 1} more)` : alerts[0].text;
}

// ---------------------------------------------------------------- Health page
function tile(level, title, value, detail) {
  return `<div class="tile" data-level="${level}"><span class="tile-dot"></span><div><p class="tile-title">${esc(title)}</p><p class="tile-value">${esc(value)}</p><p class="tile-detail">${esc(detail)}</p></div></div>`;
}
export function healthTiles(h, now) {
  const b = h.battery, pi = h.pi, pad = h.controller, board = h.board, th = pi.throttled;
  const out = [];
  // Battery
  if (Number.isFinite(b.v)) {
    out.push(tile(b.state === 'critical' ? 'bad' : b.state === 'low' ? 'warn' : 'ok', 'Battery', `${b.v.toFixed(2)} V${Number.isFinite(b.a) ? ` · ${b.a.toFixed(2)} A` : ''}`,
      `${b.state === 'ok' ? 'OK' : b.state === 'low' ? 'Low: finish soon' : 'Critical: stop now'}${runtimeText(h.runtime) ? ` · ${runtimeText(h.runtime)}` : ''} · lowest ${b.min?.toFixed(2)} V · warns at ${b.low} V (${b.cells})${b.sim ? ' · simulated' : ''}`));
  } else out.push(tile('off', 'Battery', '—', 'No reading from the Servo 2040'));
  // Pi power supply
  if (th) {
    const level = th.underVoltage ? 'bad' : th.underVoltageSeen ? 'warn' : 'ok';
    out.push(tile(level, 'Pi power supply', th.underVoltage ? 'Too low now' : th.underVoltageSeen ? 'Dipped earlier' : 'Steady',
      th.underVoltage ? 'Check the 5 V converter and its wires' : th.underVoltageSeen ? 'It dropped below 4.63 V since the Pi started' : 'No under-voltage since the Pi started'));
  } else out.push(tile('off', 'Pi power supply', '—', pi.available === false && !h.simulated ? 'Only measured on the robot’s Pi' : 'No reading yet'));
  // Pi temperature
  if (Number.isFinite(pi.temp)) {
    out.push(tile(pi.temp >= 80 ? 'bad' : pi.temp >= 70 ? 'warn' : 'ok', 'Pi temperature', `${pi.temp.toFixed(0)} °C`,
      th?.softTemp || th?.throttled ? 'Slowed down to cool' : pi.temp >= 70 ? 'Hot: give it air' : 'Normal (slows down at 80 °C)'));
  } else out.push(tile('off', 'Pi temperature', '—', 'No reading yet'));
  // Controller
  const padBattery = pad.battery?.percent != null ? `${pad.battery.percent} %` : pad.battery?.level || null;
  out.push(tile(pad.connected ? (/Low|Critical/i.test(pad.battery?.level || '') ? 'warn' : 'ok') : (h.motorsOn ? 'warn' : 'off'), 'Xbox controller',
    pad.connected ? `Connected${padBattery ? ` · battery ${padBattery}` : ''}` : 'Not connected',
    `${pad.drops ? `${pad.drops} disconnect${pad.drops > 1 ? 's' : ''}, last ${ago(pad.lastDrop, now)}` : 'No disconnects'}${pad.connected && pad.since ? ` · connected for ${duration((now - pad.since) / 1000)}` : ''}`));
  // Servo 2040 link
  const r = board.replyMs;
  out.push(tile(board.connection === 'online' ? (board.errors > 5 ? 'warn' : 'ok') : 'bad', 'Servo 2040 link',
    board.connection === 'online' ? `Online${r ? ` · ${r.avg} ms` : ''}` : board.connection,
    `${r ? `replies ${r.avg} ms on average, slowest ${r.max} ms · ` : ''}${board.errors} error${board.errors === 1 ? '' : 's'}${board.offlineCount ? ` · lost ${board.offlineCount}×` : ''}${board.restarts ? ` · restarted ${board.restarts}×` : ''}`));
  // Wi-Fi
  const w = pi.wifi;
  out.push(Number.isFinite(w?.dbm)
    ? tile(w.dbm >= -70 ? 'ok' : w.dbm >= -78 ? 'warn' : 'bad', 'Wi-Fi signal', `${w.dbm} dBm · ${pi.wifiText}`, 'For this page only: the controller uses Bluetooth')
    : tile('off', 'Wi-Fi signal', '—', 'Hotspot mode, or no reading'));
  return out.join('');
}
export function renderHealth(h, els, now) {
  if (!h) return;
  els.note.textContent = `${h.simulated ? 'simulated readings (demo) · ' : ''}updated ${new Date(h.t).toLocaleTimeString([], {hour12: false})}`;
  els.tiles.innerHTML = healthTiles(h, now);
  els.events.innerHTML = (h.events || []).map(e => `<li class="${e.level === 'bad' ? 'error' : e.level}"><time>${new Date(e.t).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false})}</time><span>${esc(e.text)}${e.incident ? ` <a class="replay-link" href="#sessions" data-incident="${esc(e.incident)}">Replay</a>` : ''}</span></li>`).join('');
  const pi = h.pi, stat = (label, value, small) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd><small>${esc(small)}</small></div>`;
  els.piNote.textContent = pi.available === false && !h.simulated ? 'readings only on the robot' : '';
  els.pi.innerHTML = [
    stat('Driving service', duration(pi.serviceUptime), 'running for'),
    stat('Pi', duration(pi.uptime), 'since it started'),
    stat('Processor load', Number.isFinite(pi.load) ? pi.load.toFixed(2) : '—', '1-minute average (4 cores)'),
    stat('Free memory', Number.isFinite(pi.memFreeMB) ? `${pi.memFreeMB} MB` : '—', Number.isFinite(pi.memTotalMB) ? `of ${pi.memTotalMB} MB` : ''),
  ].join('');
}

// ---------------------------------------------------------------- Servo care page
const FLAG_TEXT = {
  'near-limit': ['warn', 'at the end of its travel now'],
  'often-near-limit': ['warn', 'spends a lot of time near the end of its travel: reduce the stride or step height, or check its calibration'],
  'large-offset': ['warn', 'large calibration offset, which uses up travel on one side. Moving the horn one tooth on its spline (about 14°) and recalibrating would centre it'],
  'released': ['info', 'switched off (released)'],
};
export function careChecks(s) {
  const items = [];
  for (const r of s.rows) for (const f of r.flags) {
    const [level, text] = FLAG_TEXT[f] || ['info', f];
    const detail = f === 'large-offset' ? ` (${r.offset > 0 ? '+' : ''}${r.offset}°)` : f === 'often-near-limit' ? ` (${r.session.nearPct}% of the time)` : '';
    items.push({level, text: `${r.leg} ${r.joint} (output ${r.output}): ${text}${detail}`});
  }
  return items;
}
function rangeBar(r, nearDeg) {
  const span = r.high - r.low, pct = v => Math.max(0, Math.min(100, (v - r.low) / span * 100));
  const zone = nearDeg / span * 100;
  const band = Number.isFinite(r.min) ? `<i class="band" style="left:${pct(r.min).toFixed(1)}%;width:${Math.max(0.8, pct(r.max) - pct(r.min)).toFixed(1)}%"></i>` : '';
  const tick = Number.isFinite(r.angle) ? `<i class="tick" style="left:${pct(r.angle).toFixed(1)}%"></i>` : '';
  return `<div class="range" title="usable range ${r.low}° to ${r.high}°"><i class="zone" style="left:0;width:${zone.toFixed(1)}%"></i><i class="zone" style="right:0;width:${zone.toFixed(1)}%"></i><i class="mid"></i>${band}${tick}</div>
    <div class="range-scale"><span>${r.low}°</span><b>${Number.isFinite(r.angle) ? `${r.angle.toFixed(0)}°` : '—'}</b><span>${r.high}°</span></div>`;
}
export function renderCare(s, els, period = 'session') {
  if (!s) return;
  const checks = careChecks(s);
  els.checks.innerHTML = checks.length
    ? checks.map(c => `<li data-level="${c.level}"><span class="tile-dot"></span><span>${esc(c.text)}</span></li>`).join('')
    : '<li data-level="ok"><span class="tile-dot"></span><span>All 18 servos look fine: none near the end of travel, no large calibration offsets.</span></li>';
  els.note.textContent = `${duration(s.session.activeSec)} with motors on this session`;
  const top = s.rows.slice().sort((a, b) => b.lifetime.travel - a.lifetime.travel).slice(0, 5), most = Math.max(1, top[0]?.lifetime.travel || 0);
  els.ranks.innerHTML = top.some(r => r.lifetime.travel > 0)
    ? top.map(r => `<li><span>${esc(r.leg)} ${esc(r.joint)} <small>out ${r.output}</small></span><div class="rank-bar"><i style="width:${(100 * r.lifetime.travel / most).toFixed(1)}%"></i></div><b>${travel(r.lifetime.travel)}</b></li>`).join('')
    : '<li class="empty">No movement recorded yet. Walk the robot to start counting.</li>';
  els.rows.innerHTML = s.rows.map(r => {
    const p = r[period], flagged = r.flags.some(f => f !== 'released');
    const offset = Number.isFinite(r.offset) ? `${r.offset > 0 ? '+' : ''}${r.offset}°` : '—';
    return `<tr class="${flagged ? 'flagged' : ''}${r.joint === 'hip' ? ' leg-start' : ''}"><td class="num">${r.output}</td><td><b>${esc(r.leg)}</b> ${esc(r.joint)}</td>
      <td class="range-col">${rangeBar(r, s.nearDeg)}</td>
      <td class="num ${p.nearPct >= 20 ? 'warn' : ''}">${p.nearPct}%<small>${p.hits}×</small></td>
      <td class="num">${travel(p.travel)}</td>
      <td class="num ${r.flags.includes('large-offset') ? 'warn' : ''}">${offset}</td></tr>`;
  }).join('');
  els.caption.innerHTML = `<strong>How this is measured:</strong> from the angles the Servo 2040 is commanding (the servos have no sensors, so a jammed servo is not detected). <b>Usable range</b> is the board’s joint limit inside the servo’s own ±${s.servoRange}°. <b>Near a limit</b> is time within ${s.nearDeg}° of either end while the motors are on, and how many times it got there. <b>Movement</b> adds up every degree turned. ${s.saved ? `Lifetime totals are saved on the Pi (since ${new Date(s.lifetime.since).toLocaleDateString()}, ${duration(s.lifetime.activeSec)} with motors on).` : 'This demo does not save lifetime totals.'}`;
}
