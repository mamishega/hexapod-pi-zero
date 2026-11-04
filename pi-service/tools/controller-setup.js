// Interactive wizard: learns how Linux numbers your controller's sticks and buttons and
// writes controller-map.json. Run on the Pi with the driving service stopped:
//   sudo systemctl stop hexapod-drive && npm run controller-setup
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LinuxGamepad} from '../src/linux-gamepad.js';
import {STEPS, detect, allReleased, buildMap, markUsed} from '../src/setup-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const device = process.env.HEXAPOD_JOYSTICK || '/dev/input/js0';
const out = process.env.HEXAPOD_MAP || path.join(ROOT, 'controller-map.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = new LinuxGamepad({device});

console.log('\nHexapod controller setup\n========================');
console.log(`Controller device: ${device}   (Ctrl+C to cancel; nothing is saved until the end)\n`);
while (!pad.connected) {
  pad.pads();
  if (!pad.connected) { process.stdout.write(`\rWaiting for the controller... switch it on (hold the Xbox button).   `); await sleep(500); }
}
// The reader is non-blocking: keep draining it so pad.raw stays current while we wait.
setInterval(() => pad.pads(), 20);
console.log(`\rFound: ${pad.name}                                              \n`);

console.log('1. Put the controller down. Do not touch it for 2 seconds...');
await sleep(2000);
const rest = [...pad.raw.axes];
console.log('   Rest position recorded.\n');

const answers = {}, used = {axes: new Set(), buttons: new Set()};
for (const [i, step] of STEPS.entries()) {
  while (!allReleased(rest, pad.raw)) await sleep(20);
  process.stdout.write(`${i + 2}. ${step.prompt} ... `);
  let answer = null, since = 0, last = '';
  for (;;) {
    if (!pad.connected) { console.log('\nThe controller disconnected. Run the setup again.'); process.exit(1); }
    const seen = detect(step, rest, pad.raw, used);
    const key = JSON.stringify(seen);
    if (seen !== null && key === last) { if (Date.now() - since > 300) { answer = seen; break; } }
    else { last = key; since = Date.now(); }
    await sleep(20);
  }
  answers[step.key] = answer;
  markUsed(step, answer, used);
  console.log(typeof answer === 'number' ? `button ${answer}` : `axis ${answer.axis}${answer.invert ? ' (inverted)' : ''}${answer.sign ? (answer.sign > 0 ? ' +' : ' -') : ''}`);
  if (step.kind !== 'button') console.log('   Now let go.');
}

const map = buildMap(answers);
if (fs.existsSync(out)) fs.copyFileSync(out, `${out}.bak`);
fs.writeFileSync(out, JSON.stringify({controller: pad.name, created: new Date().toISOString(), ...map}, null, 2) + '\n');
console.log(`\nSaved ${out}`);
console.log('Check it with: npm run controller-test     Then start driving: sudo systemctl start hexapod-drive\n');
pad.close();
process.exit(0);
