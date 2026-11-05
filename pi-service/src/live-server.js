// Live View: a read-only web page that shows the robot and the Xbox controller as they move.
// Served by the driving service at http://<pi>:5181. Browsers receive updates as
// Server-Sent Events; nothing on the page can send commands to the robot.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'};
const ROBOT_MS = 100;   // at most 10 robot updates a second per viewer
const PAD_MS = 50;      // at most 20 controller updates a second
const MAX_VIEWERS = 40; // a classroom; each viewer costs a little CPU on the Pi Zero
const LOG_KEEP = 30;
const MAX_BACKLOG = 256 * 1024; // bytes queued for one viewer before it is dropped (sleeping laptop, lost Wi-Fi)
const POWER_EVERY_MS = 1000, POWER_KEEP = 600; // battery history: one sample a second, 10 minutes
const MSG_KEEP = 60, MSG_MS = 250;              // message inspector: last 60, sent in batches 4 times a second
const MSG_TEXT = 260;                           // longest message text shown
const HOTSPOT_IP = '10.42.0.1';
const HEALTH_SEND_MS = 2000, HEALTH_SAMPLE_MS = 5000, STATS_SAVE_MS = 60000; // Health and Servo care pages

const round1 = rows => rows?.map(row => row.map(v => Math.round(v * 10) / 10)) ?? null;

// Only what the page needs from the RobotController snapshot (small, JSON-safe).
export function robotView(snapshot) {
  const live = snapshot.live;
  return {
    connection: snapshot.connection,
    message: snapshot.message,
    settings: snapshot.settings,
    live: live ? {
      active: !!live.active, moving: !!live.moving, arming: !!live.arming, mid_step: !!live.mid_step,
      positions: round1(live.positions), angles: round1(live.angles), power: live.power || null,
      names: live.names || null, released: live.released || [],
      walking: live.walking ? {gait: live.walking.gait, target: live.walking.target, direction: live.walking.direction,
        stride: live.walking.stride, lift: live.walking.lift, hip_swing: live.walking.hip_swing, period: live.walking.period,
        stopping: !!live.walking.stopping, blending: !!live.walking.blending,
        cycle: Number.isFinite(live.walking.cycle) ? Math.round(live.walking.cycle * 1e4) / 1e4 : null} : null,
    } : null,
  };
}

// A message to or from the board as short JSON text for the message inspector: numbers rounded,
// calibration tables left out, long text cut.
const NOISE = new Set(['calibration', 'offsets', 'joint_limits', 'hard_joint_limits', 'limits', 'names', 'home', 'channels', 'features', 'released', 'reference']);
export function messageText(value) {
  const tidy = v => Array.isArray(v) ? v.map(tidy)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !NOISE.has(k)).map(([k, x]) => [k, tidy(x)]))
    : typeof v === 'number' ? Math.round(v * 10) / 10 : v;
  const text = JSON.stringify(tidy(value ?? null)) ?? 'null';
  return text.length > MSG_TEXT ? `${text.slice(0, MSG_TEXT - 1)}…` : text;
}

// KEY=value settings file (the Wi-Fi settings written by deploy/wifi/install-wifi.sh).
export function readSettings(file, fsModule = fs) {
  try {
    return Object.fromEntries(fsModule.readFileSync(file, 'utf8').split('\n').map(l => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean)
      .map(([, k, v]) => [k, v.replace(/^(["'])(.*)\1$/, '$2')]));
  } catch { return {}; }
}
const ipv4 = () => Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).filter(a => a.family === 'IPv4' && !a.internal).map(a => ({name, ip: a.address})));
// The hotspot password is only shown to devices already on the hotspot (they know it), never to
// devices on another network.
export const onHotspot = address => /^(::ffff:)?10\.42\.0\.\d+$/.test(address || '') || /^(::1|::ffff:127\.|127\.)/.test(address || '');

// Controller state as the drive loop sees it: standard-layout pad -> sticks and held buttons.
export function padView(pad, buttons) {
  if (!pad) return {connected: false};
  const axis = i => Math.round((pad.axes?.[i] ?? 0) * 100) / 100;
  const held = Object.entries(buttons).filter(([, i]) => pad.buttons?.[i]?.pressed).map(([name]) => name);
  return {connected: true, name: pad.id, axes: [axis(0), axis(1), axis(2), axis(3)], held};
}

// health: optional createHealth() monitor (src/health.js) for the Health and Servo care pages.
export function createLiveServer({root, port = 5181, host = '0.0.0.0', log = () => {}, now = Date.now,
  wifiConf = '/etc/hexapod/wifi.conf', addresses = ipv4, hostname = os.hostname, health = null} = {}) {
  const viewers = new Set();
  const state = {robot: null, pad: {connected: false}, log: [], power: [], messages: []};
  let lastPower = -Infinity, msgBatch = [], msgTimer = null;
  let padKey = '';

  // Writes to every viewer. A viewer that stops reading is dropped, so its queue cannot fill the Pi's memory.
  function write(chunk) {
    for (const res of viewers) {
      try {
        if (res.destroyed || res.writableLength > MAX_BACKLOG) throw new Error('viewer stopped reading');
        res.write(chunk);
      } catch { viewers.delete(res); res.destroy(); }
    }
  }
  function send(type, data) { write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
  // The Live View must never stop or crash the driving service: every entry point is guarded.
  // Errors go straight to the console: the service's log() feeds back into this page, which could loop.
  const guard = fn => (...args) => { try { return fn(...args); } catch (error) { console.error(`Live View: ${error.stack || error}`); } };
  // At most one message per `ms`, with a trailing send so the latest state always arrives.
  function throttle(type, ms) {
    let timer = null, last = -Infinity, latest;
    return value => {
      latest = value;
      if (timer) return;
      timer = setTimeout(guard(() => { timer = null; last = now(); send(type, latest); }), Math.max(0, last + ms - now()));
    };
  }
  const sendRobot = throttle('robot', ROBOT_MS), sendPad = throttle('pad', PAD_MS);

  const api = {
    get viewers() { return viewers.size; },
    robot: guard(snapshot => {
      if (health) guard(() => health.robot(snapshot))();
      state.robot = robotView(snapshot);
      const p = state.robot.live?.power;
      if (Number.isFinite(p?.voltage) && now() - lastPower >= POWER_EVERY_MS) {
        lastPower = now();
        state.power = [...state.power, {t: lastPower, v: p.voltage, a: Number.isFinite(p.current) ? p.current : null, w: state.robot.live.walking ? 1 : 0, sim: p.simulated ? 1 : 0}].slice(-POWER_KEEP);
      }
      if (viewers.size) sendRobot(state.robot);
    }),
    // One message to (dir 'out') or from (dir 'in') the board, for the message inspector.
    message: guard((dir, op, body) => {
      const entry = {dir, op, text: messageText(body), time: now()};
      state.messages = [...state.messages, entry].slice(-MSG_KEEP);
      if (!viewers.size) return;
      msgBatch.push(entry);
      if (!msgTimer) msgTimer = setTimeout(guard(() => { msgTimer = null; const batch = msgBatch; msgBatch = []; send('msgs', batch); }), MSG_MS);
    }),
    // Records every command the robot sends to the board and the board's reply, without changing them.
    watchLink: guard(robot => {
      const wrap = () => {
        const link = robot.link;
        if (!link || link.liveViewWatched) return;
        const send = link.send.bind(link);
        link.send = (op, args, ...rest) => {
          api.message('out', op, {op, ...(args || {})});
          const sent = now(), reply = send(op, args, ...rest);
          Promise.resolve(reply).then(answer => { health?.reply(now() - sent, true); api.message('in', op, answer); },
            error => { const text = error?.message || String(error); health?.reply(now() - sent, false, /time ?out|no reply/i.test(text)); api.message('in', op, {error: text}); });
          return reply;
        };
        link.liveViewWatched = true;
      };
      robot.subscribe(guard(wrap)); wrap();
    }),
    pad: guard((pad, buttons) => {
      const view = padView(pad, buttons), key = JSON.stringify(view);
      health?.pad(view.connected);
      if (key === padKey) return;
      padKey = key; state.pad = view;
      if (viewers.size) sendPad(view);
    }),
    action: guard((name, detail = {}) => { if (viewers.size) send('action', {...detail, action: name, time: now()}); }),
    log: guard((text, error = false) => {
      const entry = {text, error, time: now()};
      state.log = [...state.log, entry].slice(-LOG_KEEP);
      if (viewers.size) send('log', entry);
    }),
    close() { clearInterval(healthTimers.send); clearInterval(healthTimers.sample); clearInterval(healthTimers.save); guard(() => health?.close())(); for (const res of viewers) res.end(); viewers.clear(); return new Promise(resolve => server.close(() => resolve())); },
  };

  // A bad request must never take down the driving service: everything is caught here.
  const server = http.createServer((req, res) => {
    try { handle(req, res); }
    catch { if (!res.headersSent) res.writeHead(400, {'Content-Type': 'text/plain'}); res.end('Bad request'); }
  });
  function handle(req, res) {
    const url = new URL(req.url.replace(/^\/+/, '/'), 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {Allow: 'GET'}); res.end(); return; }
    if (url.pathname === '/events') {
      if (viewers.size >= MAX_VIEWERS) { res.writeHead(503, {'Content-Type': 'text/plain'}); res.end('Too many viewers'); return; }
      res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
      res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({robot: state.robot, pad: state.pad, log: state.log, power: state.power, messages: state.messages, health: healthView(), serverTime: now()})}\n\n`);
      viewers.add(res);
      req.on('close', () => viewers.delete(res));
      res.on('error', () => viewers.delete(res)); // a lost connection must not crash the service
      return;
    }
    if (url.pathname === '/info') {
      // How to reach this page (for the Join card): addresses, and the hotspot when it is running.
      const wifi = readSettings(wifiConf), list = addresses();
      const hotspot = list.some(a => a.ip === HOTSPOT_IP);
      const info = {hostname: hostname(), port: server.address()?.port ?? port, addresses: list.map(a => a.ip),
        hotspot: {active: hotspot, ssid: wifi.HOTSPOT_SSID || null, password: hotspot && onHotspot(req.socket.remoteAddress) ? wifi.HOTSPOT_PASSWORD || null : null}};
      res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(info));
      return;
    }
    // Static files from the page folder only.
    const file = path.normalize(path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(path.normalize(root + path.sep))) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, body) => {
      if (error) { res.writeHead(404, {'Content-Type': 'text/plain'}); res.end('Not found'); return; }
      res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  }
  // Health: Pi readings every 5 s, sent to viewers every 2 s; lifetime servo totals saved every minute.
  function healthView() { try { return health ? health.snapshot() : null; } catch (error) { console.error(`Live View health: ${error.stack || error}`); return null; } }
  const healthTimers = {};
  if (health) {
    let sampling = false;
    const sample = async () => { if (sampling) return; sampling = true; try { await health.sample(); } catch (error) { console.error(`Live View health sample: ${error.message}`); } finally { sampling = false; } };
    sample();
    healthTimers.sample = setInterval(sample, HEALTH_SAMPLE_MS);
    healthTimers.send = setInterval(guard(() => { if (viewers.size) { const h = healthView(); if (h) send('health', h); } }), HEALTH_SEND_MS);
    healthTimers.save = setInterval(guard(() => health.stats?.save()), STATS_SAVE_MS);
    for (const t of Object.values(healthTimers)) t.unref?.();
  }
  // Keep-alive comment so proxies and sleeping laptops notice a dead connection.
  const ping = setInterval(guard(() => write(': ping\n\n')), 15000);
  ping.unref?.();
  server.on('close', () => { clearInterval(ping); clearInterval(healthTimers.send); clearInterval(healthTimers.sample); clearInterval(healthTimers.save); });
  server.on('error', error => log(`Live View could not start on port ${port}: ${error.message}`));
  server.listen(port, host, () => log(`Live View: http://${host === '0.0.0.0' ? '<pi-address>' : host}:${port}`));
  api.server = server;
  return api;
}
