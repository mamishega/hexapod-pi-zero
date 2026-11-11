// Gait timing chart: one row per leg, a filled bar while the foot is on the ground and a thin
// line while it swings through the air. The classic way to compare walking patterns.
import {LEG_NAMES} from './motion-geometry.js';

export const WINDOW_MS = 6000;
const STEP_MS = 20;
let colours = null, coloursAt = 0;

function readColours(canvas) {
  const css = getComputedStyle(canvas);
  const v = name => css.getPropertyValue(name).trim();
  return {down: v('--accent'), air: v('--lime'), text: v('--muted'), line: v('--border'), off: v('--surface-3'), now: v('--text-2')};
}

// Draws the window that ends at time `t`. Returns the feet-down pattern at `t` (or null).
export function drawGaitChart(canvas, timeline, t, nowLabel = 'now') {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  if (!colours || performance.now() - coloursAt > 1000) { colours = readColours(canvas); coloursAt = performance.now(); } // follows the theme
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const labelW = 34, top = 4, axisH = 18, rowGap = 6, groupGap = 8;
  const rowH = (h - top - axisH - groupGap - rowGap * 5) / 6;
  const x0 = labelW, x1 = w - 4, span = x1 - x0;
  const rowY = i => top + i * (rowH + rowGap) + (i >= 3 ? groupGap : 0);
  const t0 = t - WINDOW_MS;

  // Sample the timing once per STEP_MS across the window.
  const samples = [];
  for (let s = t0; s <= t; s += STEP_MS) samples.push(timeline.feetAt(s));

  ctx.font = `600 11px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (let leg = 0; leg < 6; leg++) {
    const y = rowY(leg), mid = y + rowH / 2;
    ctx.fillStyle = colours.text; ctx.textAlign = 'left';
    ctx.fillText(LEG_NAMES[leg], 0, mid);
    // Faint track for the whole row.
    ctx.fillStyle = colours.off; ctx.globalAlpha = 0.6;
    ctx.fillRect(x0, y, span, rowH); ctx.globalAlpha = 1;
    let runStart = null, runKind = null;
    const flush = (endIndex) => {
      if (runStart === null) return;
      const xa = x0 + (runStart / (samples.length - 1)) * span, xb = x0 + (endIndex / (samples.length - 1)) * span;
      if (runKind === 'down') { ctx.fillStyle = colours.down; ctx.fillRect(xa, y + 1, Math.max(1, xb - xa), rowH - 2); }
      else if (runKind === 'air') { ctx.fillStyle = colours.air; ctx.fillRect(xa, mid - 1.5, Math.max(1, xb - xa), 3); }
    };
    samples.forEach((feet, k) => {
      const kind = feet === null ? 'off' : feet[leg] ? 'down' : 'air';
      if (kind !== runKind) { flush(k); runStart = k; runKind = kind; }
    });
    flush(samples.length - 1);
  }
  // Time axis: one tick a second, "now" at the right edge.
  ctx.fillStyle = colours.text; ctx.font = `500 10px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center';
  ctx.strokeStyle = colours.line; ctx.lineWidth = 1;
  for (let s = 0; s <= WINDOW_MS / 1000; s++) {
    const x = x1 - (s * 1000 / WINDOW_MS) * span;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, h - axisH + 2); ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(s === 0 ? nowLabel : `−${s} s`, Math.min(Math.max(x, x0 + 10), x1 - 12), h - axisH / 2 + 2);
  }
  ctx.strokeStyle = colours.now; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x1 - 1, top); ctx.lineTo(x1 - 1, h - axisH + 2); ctx.stroke();
  return samples.at(-1);
}
