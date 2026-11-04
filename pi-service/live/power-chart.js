// Battery voltage and current over the last 10 minutes, with the time spent walking shaded.
// samples: [{t (ms, any clock), v (volts), a (amps or null), w (1 while walking)}]
export const POWER_WINDOW_MS = 10 * 60 * 1000;
const W = 600, H = 210, L = 44, R = 44, T = 12, B = 26;

const fmt = (v, digits) => (Number.isFinite(v) ? v.toFixed(digits) : '—');
function niceRange(values, minSpan) {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (!Number.isFinite(lo)) return [0, 1];
  const pad = Math.max(minSpan - (hi - lo), 0) / 2 + (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

export function drawPower(svg, samples, nowT) {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const t0 = nowT - POWER_WINDOW_MS, list = samples.filter(s => s.t >= t0);
  if (list.length < 2) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="chart-empty">${samples.length ? 'Collecting readings…' : 'No battery readings from the board yet.'}</text>`;
    return null;
  }
  const x = t => L + ((t - t0) / POWER_WINDOW_MS) * (W - L - R);
  const [vLo, vHi] = niceRange(list.map(s => s.v), 0.4);
  const amps = list.map(s => s.a).filter(Number.isFinite);
  const [aLo, aHi] = amps.length ? niceRange([0, ...amps], 1) : [0, 1];
  const yV = v => T + (1 - (v - vLo) / (vHi - vLo)) * (H - T - B);
  const yA = a => T + (1 - (a - aLo) / (aHi - aLo)) * (H - T - B);
  let out = '';
  // Shade the stretches spent walking.
  let start = null;
  list.forEach((s, i) => {
    if (s.w && start === null) start = s.t;
    if ((!s.w || i === list.length - 1) && start !== null) { out += `<rect class="chart-walk" x="${x(start).toFixed(1)}" y="${T}" width="${Math.max(1, x(s.t) - x(start)).toFixed(1)}" height="${H - T - B}"/>`; start = null; }
  });
  // Grid and axes: volts on the left, amps on the right, minutes along the bottom.
  for (let k = 0; k <= 4; k++) {
    const y = T + (k / 4) * (H - T - B);
    out += `<line class="chart-grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>`;
    out += `<text class="chart-axis v" x="${L - 6}" y="${y + 4}" text-anchor="end">${(vHi - (k / 4) * (vHi - vLo)).toFixed(1)}</text>`;
    if (amps.length) out += `<text class="chart-axis a" x="${W - R + 6}" y="${y + 4}">${(aHi - (k / 4) * (aHi - aLo)).toFixed(1)}</text>`;
  }
  for (let m = 0; m <= 10; m += 2) out += `<text class="chart-axis" x="${x(nowT - m * 60000)}" y="${H - 8}" text-anchor="middle">${m ? `−${m} min` : 'now'}</text>`;
  out += `<text class="chart-axis v" x="4" y="${T + 4}">V</text>`;
  if (amps.length) out += `<text class="chart-axis a" x="${W - 4}" y="${T + 4}" text-anchor="end">A</text>`;
  const line = (pick, y) => list.filter(s => Number.isFinite(pick(s))).map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(pick(s)).toFixed(1)}`).join('');
  if (amps.length) out += `<path class="chart-line a" d="${line(s => s.a, yA)}"/>`;
  out += `<path class="chart-line v" d="${line(s => s.v, yV)}"/>`;
  svg.innerHTML = out;
  const last = list.at(-1);
  return {volts: last.v, amps: last.a, minV: Math.min(...list.map(s => s.v)), maxA: amps.length ? Math.max(...amps) : null, simulated: !!last.sim, text: {v: fmt(last.v, 2), a: fmt(last.a, 2)}};
}
