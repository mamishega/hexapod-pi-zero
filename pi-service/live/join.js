import {qrSvg, wifiText} from './qr.js';

// Join card: how other devices reach this page. The Wi-Fi password appears only when this device
// is itself on the robot's hotspot (the server decides; see /info in live-server.js).
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

export async function fillJoin(box) {
  box.innerHTML = '<p class="muted">Looking up the robot\'s addresses…</p>';
  let info;
  try { info = await (await fetch('info', {cache: 'no-store'})).json(); }
  catch { box.innerHTML = '<p class="muted">Could not reach the robot.</p>'; return; }
  const port = info.port, hash = !location.hash || location.hash === '#join' ? '#live' : location.hash; // never send students to the Join card
  // Prefer the address this page was opened with; then the hotspot address; then the others.
  const hosts = [...new Set([location.hostname, info.hotspot.active ? '10.42.0.1' : null, ...info.addresses, `${String(info.hostname).replace(/\.local$/i, '')}.local`].filter(Boolean))]
    .filter(h => !/^(localhost|127\.|::1)/.test(h));
  const url = h => `http://${h}:${port}/${hash}`;
  let html = '';
  if (info.hotspot.active) {
    const wifiQr = info.hotspot.password ? `<figure class="join-qr">${qrSvg(wifiText(info.hotspot.ssid || 'Hexapod', info.hotspot.password), 'QR code: join the robot Wi-Fi')}<figcaption>Scan to join</figcaption></figure>` : '';
    html += `<section class="join-step"><span class="join-num">1</span><div class="join-text"><h4>Join the robot's Wi-Fi</h4>
      <dl class="join-big"><div><dt>Network</dt><dd>${esc(info.hotspot.ssid || 'Hexapod')}</dd></div>
      <div><dt>Password</dt><dd>${info.hotspot.password ? esc(info.hotspot.password) : '<span class="muted">ask your teacher</span>'}</dd></div></dl>
      <p class="muted">If your device warns there is no internet, choose to stay connected.</p></div>${wifiQr}</section>`;
  } else {
    html += `<section class="join-step"><span class="join-num">1</span><div class="join-text"><h4>Use the same Wi-Fi as the robot</h4>
      <p class="muted">Your device must be on the same network as the robot.</p></div></section>`;
  }
  const main = url(hosts[0] || location.host);
  html += `<section class="join-step"><span class="join-num">2</span><div class="join-text"><h4>Open this address</h4>
    <p class="join-url">${esc(main)}</p>
    ${hosts.length > 1 ? `<p class="muted">or ${hosts.slice(1).map(h => `<span class="mono">${esc(url(h))}</span>`).join(' · ')}</p>` : ''}</div>
    <figure class="join-qr">${qrSvg(main, 'QR code: open the Live View')}<figcaption>Scan to open</figcaption></figure></section>`;
  box.innerHTML = html;
}
