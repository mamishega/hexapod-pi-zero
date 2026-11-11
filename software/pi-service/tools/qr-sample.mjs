// Writes sample QR codes (from live/qr.js) for tools/check-qr.swift to decode. Mac only.
import fs from 'node:fs';
import path from 'node:path';
import {qrMatrix, wifiText} from '../live/qr.js';
const dir = process.argv[2] || '/tmp/qr';
fs.mkdirSync(dir, {recursive: true});
const texts = ['Hi', 'http://10.42.0.1:5181/#live', wifiText('Hexapod-6607', 'hexapod2026'), 'http://hexapod.local:5181/#servos',
  wifiText('Kangan Robotics Lab', 'a;b\\c:d,e'), 'x'.repeat(60), 'Ünïcødé ✓ robot 🦿', 'y'.repeat(150), 'z'.repeat(213)];
texts.forEach((t, i) => {
  fs.writeFileSync(path.join(dir, `q${i}.txt`), qrMatrix(t).map(r => r.map(d => (d ? 1 : 0)).join('')).join('\n'));
  fs.writeFileSync(path.join(dir, `t${i}.txt`), t);
});
console.log(`Wrote ${texts.length} samples to ${dir}`);
