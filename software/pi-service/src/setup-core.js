// Detection logic for the controller setup wizard (tools/controller-setup.js), kept
// free of terminal I/O so it can be tested with recorded controller states.

export const AXIS_THRESHOLD = 24000; // of 32767: the stick must be pushed most of the way
export const CENTRED = 8000;

// The steps, in order. kind 'axis': push a stick; 'button': press a button;
// 'dpad': press a d-pad direction (some drivers report it as buttons, others as an axis).
export const STEPS = [
  {key: 'lx', kind: 'axis', prompt: 'Push the LEFT stick fully to the RIGHT and hold it', positive: true},
  {key: 'ly', kind: 'axis', prompt: 'Push the LEFT stick fully DOWN (towards you) and hold it', positive: true},
  {key: 'rx', kind: 'axis', prompt: 'Push the RIGHT stick fully to the RIGHT and hold it', positive: true},
  {key: 'ry', kind: 'axis', prompt: 'Push the RIGHT stick fully DOWN (towards you) and hold it', positive: true},
  {key: 'a', kind: 'button', prompt: 'Press A'},
  {key: 'b', kind: 'button', prompt: 'Press B'},
  {key: 'x', kind: 'button', prompt: 'Press X'},
  {key: 'y', kind: 'button', prompt: 'Press Y'},
  {key: 'lb', kind: 'button', prompt: 'Press LB (left shoulder button)'},
  {key: 'rb', kind: 'button', prompt: 'Press RB (right shoulder button)'},
  {key: 'view', kind: 'button', prompt: 'Press VIEW (the small two-squares button, left of the Xbox button)'},
  {key: 'menu', kind: 'button', prompt: 'Press MENU (the small three-lines button, right of the Xbox button)'},
  {key: 'up', kind: 'dpad', prompt: 'Press D-pad UP'},
  {key: 'down', kind: 'dpad', prompt: 'Press D-pad DOWN'},
  {key: 'left', kind: 'dpad', prompt: 'Press D-pad LEFT'},
  {key: 'right', kind: 'dpad', prompt: 'Press D-pad RIGHT'},
];

// An axis (not already used) pushed well away from where it rests. Triggers rest at
// -32767 on many drivers; measuring from the rest value keeps them from looking pushed.
export function movedAxis(rest, axes, usedAxes) {
  let best = null;
  axes.forEach((value, axis) => {
    if (value === undefined || usedAxes.has(axis)) return;
    const delta = value - (rest[axis] ?? 0);
    if (Math.abs(delta) >= AXIS_THRESHOLD && (!best || Math.abs(delta) > Math.abs(best.delta))) best = {axis, delta};
  });
  return best;
}

export function pressedButton(buttons, usedButtons) {
  const i = buttons.findIndex((value, n) => value && !usedButtons.has(n));
  return i < 0 ? null : i;
}

export const allReleased = (rest, raw) =>
  raw.buttons.every(v => !v) && raw.axes.every((v, i) => v === undefined || Math.abs(v - (rest[i] ?? 0)) < CENTRED);

// One step's answer from the current raw state, or null if nothing (new) is pressed yet.
export function detect(step, rest, raw, used) {
  if (step.kind === 'axis') {
    const hit = movedAxis(rest, raw.axes, used.axes);
    return hit && {axis: hit.axis, ...(Math.sign(hit.delta) > 0 === step.positive ? {} : {invert: true})};
  }
  const button = pressedButton(raw.buttons, used.buttons);
  if (button !== null) return button;
  if (step.kind === 'dpad') {
    const hit = movedAxis(rest, raw.axes, used.axes);
    if (hit) return {axis: hit.axis, sign: Math.sign(hit.delta)};
  }
  return null;
}

// Answers keyed by step -> the map format linux-gamepad.js reads.
export function buildMap(answers) {
  const pick = keys => Object.fromEntries(keys.filter(k => answers[k] !== undefined).map(k => [k, answers[k]]));
  return {axes: pick(['lx', 'ly', 'rx', 'ry']), buttons: pick(['a', 'b', 'x', 'y', 'lb', 'rb', 'view', 'menu']), dpad: pick(['up', 'down', 'left', 'right'])};
}

// Marks an answer's axis or button as taken. A d-pad hat axis serves two directions.
export function markUsed(step, answer, used) {
  if (typeof answer === 'number') used.buttons.add(answer);
  else if (step.kind === 'axis') used.axes.add(answer.axis);
}
