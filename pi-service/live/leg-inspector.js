// Leg inspector: one leg seen from the side, with the inverse-kinematics triangle and its numbers.
// Foot targets are in the leg's own frame (mm): x across the leg, y out along it, z down from the hip.
export const COXA = 47, FEMUR = 88.46, TIBIA = 148.8; // segment lengths, as in motion-geometry.js
const deg = r => (r * 180) / Math.PI;
const f0 = v => (Number.isFinite(v) ? v.toFixed(0) : '—');

// The geometry the board solves for this foot target (same equations as legJoints()).
export function solveLeg([x, y, z]) {
  const r = Math.hypot(x, y), dx = r - COXA, reach = Math.hypot(dx, z);
  const cosKnee = (FEMUR ** 2 + TIBIA ** 2 - reach ** 2) / (2 * FEMUR * TIBIA);
  const knee = Math.acos(Math.max(-1, Math.min(1, cosKnee)));
  const beta = Math.acos(Math.max(-1, Math.min(1, (FEMUR ** 2 + reach ** 2 - TIBIA ** 2) / (2 * FEMUR * reach))));
  const upper = beta - Math.atan2(z, dx);                         // femur angle above horizontal
  return {r, reach, hip: deg(Math.atan2(x, y)), knee: deg(knee), upper: deg(upper), reachable: reach <= FEMUR + TIBIA && reach >= Math.abs(TIBIA - FEMUR),
    knee2d: [COXA + FEMUR * Math.cos(upper), -FEMUR * Math.sin(upper)], foot2d: [r, z]};
}

export function drawLegInspector(svg, numbers, {name, xyz, servo, lifted}) {
  if (!xyz) { svg.innerHTML = '<text x="180" y="110" text-anchor="middle" class="chart-empty">Waiting for the robot…</text>'; numbers.replaceChildren(); return; }
  const s = solveLeg(xyz);
  // Side view: hip at the left, x = distance out from the hip axis, y = height (down is down).
  const S = 0.85, ox = 34, oy = 96, P = ([r, z]) => [ox + r * S, oy + z * S]; // fits a raised knee and a low foot
  const hip = P([0, 0]), coxa = P([COXA, 0]), knee = P(s.knee2d), foot = P(s.foot2d);
  const groundY = foot[1] + 6;
  let out = `<line class="leg-ground" x1="8" x2="352" y1="${groundY}" y2="${groundY}"/>`;
  for (let gx = 12; gx < 352; gx += 14) out += `<line class="leg-hatch" x1="${gx}" y1="${groundY}" x2="${gx - 8}" y2="${groundY + 8}"/>`;
  out += `<rect class="leg-body" x="0" y="${oy - 12}" width="${ox + 4}" height="24" rx="6"/>`;
  // Reach line and the triangle the law of cosines solves.
  out += `<line class="leg-reach" x1="${coxa[0]}" y1="${coxa[1]}" x2="${foot[0]}" y2="${foot[1]}"/>`;
  out += `<text class="leg-dim" x="${(coxa[0] + foot[0]) / 2 - 8}" y="${(coxa[1] + foot[1]) / 2 + 16}" text-anchor="end">reach ${f0(s.reach)} mm</text>`; // below-left of the line, clear of the tibia
  out += `<line class="leg-seg coxa" x1="${hip[0]}" y1="${hip[1]}" x2="${coxa[0]}" y2="${coxa[1]}"/>`;
  out += `<line class="leg-seg femur" x1="${coxa[0]}" y1="${coxa[1]}" x2="${knee[0]}" y2="${knee[1]}"/>`;
  out += `<line class="leg-seg tibia" x1="${knee[0]}" y1="${knee[1]}" x2="${foot[0]}" y2="${foot[1]}"/>`;
  // Knee angle arc between the femur and the tibia.
  const a1 = Math.atan2(coxa[1] - knee[1], coxa[0] - knee[0]), a2 = Math.atan2(foot[1] - knee[1], foot[0] - knee[0]), R = 20;
  let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const arcEnd = [knee[0] + R * Math.cos(a1 + d), knee[1] + R * Math.sin(a1 + d)];
  out += `<path class="leg-arc" d="M${knee[0] + R * Math.cos(a1)},${knee[1] + R * Math.sin(a1)} A${R} ${R} 0 0 ${d > 0 ? 1 : 0} ${arcEnd[0]},${arcEnd[1]}"/>`;
  out += `<text class="leg-angle" x="${knee[0] + 26 * Math.cos(a1 + d / 2)}" y="${knee[1] + 26 * Math.sin(a1 + d / 2) + 4}" text-anchor="middle">${f0(s.knee)}°</text>`;
  for (const [p, r] of [[hip, 6], [coxa, 6], [knee, 6]]) out += `<circle class="leg-joint" cx="${p[0]}" cy="${p[1]}" r="${r}"/>`;
  out += `<circle class="leg-foot${lifted ? ' up' : ''}" cx="${foot[0]}" cy="${foot[1]}" r="7"/>`;
  out += `<text class="leg-dim" x="${(hip[0] + coxa[0]) / 2}" y="${hip[1] - 12}" text-anchor="middle">${COXA}</text>`;
  out += `<text class="leg-dim" x="${(coxa[0] + knee[0]) / 2 - 6}" y="${(coxa[1] + knee[1]) / 2 - 8}" text-anchor="end">${Math.round(FEMUR)} mm</text>`;
  out += `<text class="leg-dim" x="${(knee[0] + foot[0]) / 2 + 10}" y="${(knee[1] + foot[1]) / 2}">${Math.round(TIBIA)} mm</text>`;
  out += `<text class="leg-title" x="350" y="18" text-anchor="end">${name}${lifted ? ' · lifted' : ''}</text>`;
  svg.innerHTML = out;

  const rows = [
    ['Foot target', `${f0(xyz[0])}, ${f0(xyz[1])}, ${f0(xyz[2])} mm`, 'across, out, down from the hip'],
    ['Out from the hip', `${f0(s.r)} mm`, 'r = √(x² + y²)'],
    ['Reach', `${f0(s.reach)} mm`, `√((r − ${COXA})² + z²)`],
    ['Knee angle', `${f0(s.knee)}°`, `cos k = (${Math.round(FEMUR)}² + ${Math.round(TIBIA)}² − reach²) ÷ (2 × ${Math.round(FEMUR)} × ${Math.round(TIBIA)})`],
    ['Hip turn', `${f0(s.hip)}°`, 'tan h = x ÷ y'],
    ['Servo angles (board)', servo ? `${f0(servo[0])}°, ${f0(servo[1])}°, ${f0(servo[2])}°` : '—', 'hip, upper, lower, after calibration'],
  ];
  numbers.replaceChildren(...rows.map(([k, v, how]) => {
    const div = document.createElement('div');
    div.innerHTML = '<dt></dt><dd></dd><small></small>';
    div.children[0].textContent = k; div.children[1].textContent = v; div.children[2].textContent = how;
    return div;
  }));
  if (!s.reachable) numbers.insertAdjacentHTML('beforeend', '<p class="leg-warn">This target is out of the leg\'s reach.</p>');
}
