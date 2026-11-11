// A small QR code encoder (ISO/IEC 18004, Model 2): byte mode, error-correction level M,
// versions 1-10 (up to 213 bytes: plenty for a web address or a Wi-Fi login).
// Written for this page so it works offline on the robot's hotspot, with no outside library.
// qrMatrix(text) -> array of rows of booleans (true = dark), without the quiet zone.

// Level M error-correction blocks per version: [[block count, data codewords per block], ...] and
// error-correction codewords per block.
const BLOCKS = [null,
  {ec: 10, groups: [[1, 16]]}, {ec: 16, groups: [[1, 28]]}, {ec: 26, groups: [[1, 44]]}, {ec: 18, groups: [[2, 32]]},
  {ec: 24, groups: [[2, 43]]}, {ec: 16, groups: [[4, 27]]}, {ec: 18, groups: [[4, 31]]}, {ec: 22, groups: [[2, 38], [2, 39]]},
  {ec: 22, groups: [[3, 36], [2, 37]]}, {ec: 26, groups: [[4, 43], [1, 44]]}];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const EC_LEVEL_M = 0b00;

// ---- Galois field GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    poly.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
    poly = next;
  }
  return poly;
}
// Reed-Solomon remainder: the error-correction codewords for one block.
export function rsRemainder(data, degree) {
  const gen = generator(degree), rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

const utf8 = text => [...new TextEncoder().encode(text)];
const capacity = v => BLOCKS[v].groups.reduce((n, [count, size]) => n + count * size, 0);

// Data bits -> padded data codewords for version v.
function dataCodewords(bytes, v) {
  const bits = [];
  const put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);                       // byte mode
  put(bytes.length, v < 10 ? 8 : 16);   // character count
  bytes.forEach(b => put(b, 8));
  const total = capacity(v) * 8;
  put(0, Math.min(4, total - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0; words.length < capacity(v); pad++) words.push(pad % 2 ? 0x11 : 0xec);
  return words;
}

// Split into blocks, add error correction, interleave.
function codewords(data, v) {
  const {ec, groups} = BLOCKS[v], blocks = [];
  let at = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) { const d = data.slice(at, at + size); at += size; blocks.push({d, e: rsRemainder(d, ec)}); }
  const out = [], longest = Math.max(...blocks.map(b => b.d.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// Format information (15 bits: error level + mask, BCH-protected, XOR 0x5412) and version
// information (18 bits, versions 7 and up).
function formatBits(mask) {
  const data = (EC_LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function versionBits(v) {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (v << 12) | rem;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function baseMatrix(v) {
  const n = 17 + 4 * v;
  const m = Array.from({length: n}, () => new Array(n).fill(false));
  const fixed = Array.from({length: n}, () => new Array(n).fill(false));
  const set = (r, c, dark) => { m[r][c] = dark; fixed[r][c] = true; };
  // Finder patterns and their separators.
  for (const [fr, fc] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = fr + r, cc = fc + c;
      if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(rr, cc, ring !== 2 && ring !== 4);
    }
  }
  // Timing patterns.
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  // Alignment patterns (not over the finders).
  const pos = ALIGN[v];
  for (const r of pos) for (const c of pos) {
    if ((r === 6 && c === 6) || (r === 6 && c === pos.at(-1)) || (r === pos.at(-1) && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // Reserve the format areas (filled per mask) and the dark module.
  for (let i = 0; i <= 8; i++) { if (!fixed[8][i]) fixed[8][i] = true; if (!fixed[i][8]) fixed[i][8] = true; }
  for (let i = 0; i < 8; i++) { fixed[8][n - 1 - i] = true; fixed[n - 1 - i][8] = true; }
  set(n - 8, 8, true);
  // Version information (version 7 and up).
  if (v >= 7) {
    const bits = versionBits(v);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1, a = Math.floor(i / 3), b = n - 11 + (i % 3);
      set(a, b, dark); set(b, a, dark);
    }
  }
  return {m, fixed, n};
}

function placeData(m, fixed, n, words) {
  const bits = words.flatMap(w => Array.from({length: 8}, (_, i) => ((w >>> (7 - i)) & 1) === 1));
  let k = 0, upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let step = 0; step < n; step++) {
      const r = upward ? n - 1 - step : step;
      for (const c of [right, right - 1]) if (!fixed[r][c]) { m[r][c] = k < bits.length ? bits[k] : false; k++; }
    }
    upward = !upward;
  }
}

function drawFormat(m, n, mask) {
  const bits = formatBits(mask), bit = i => ((bits >>> i) & 1) === 1; // bit 0 = least significant
  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
  // Second copy, split between the top-right and bottom-left finders.
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i);
  m[n - 8][8] = true; // the dark module
}

function penalty(m, n) {
  let score = 0;
  const lines = [...m, ...m[0].map((_, c) => m.map(row => row[c]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += 3 + run - 5; run = 1; }
    }
    const s = line.map(d => (d ? 1 : 0)).join('');
    for (const p of ['10111010000', '00001011101']) for (let i = s.indexOf(p); i >= 0; i = s.indexOf(p, i + 1)) score += 40;
  }
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const d = m[r][c];
    if (m[r][c + 1] === d && m[r + 1][c] === d && m[r + 1][c + 1] === d) score += 3;
  }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return score;
}

export function qrMatrix(text) {
  const bytes = utf8(text);
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find(ver => 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= capacity(ver) * 8);
  if (!v) throw new Error('Text too long for a QR code here (213 bytes at most)');
  const words = codewords(dataCodewords(bytes, v), v);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const {m, fixed, n} = baseMatrix(v);
    placeData(m, fixed, n, words);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!fixed[r][c] && MASKS[mask](r, c)) m[r][c] = !m[r][c];
    drawFormat(m, n, mask);
    const score = penalty(m, n);
    if (!best || score < best.score) best = {m, score};
  }
  return best.m;
}

// SVG markup for the code, with the standard 4-module quiet zone. Colours come from CSS.
export function qrSvg(text, label) {
  const m = qrMatrix(text), n = m.length, size = n + 8;
  let d = '';
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c + 4} ${r + 4}h1v1h-1z`; }));
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Wi-Fi login in the format phone cameras understand.
export const wifiText = (ssid, password) => {
  const q = s => String(s).replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:WPA;S:${q(ssid)};P:${q(password)};;`;
};
