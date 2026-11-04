// Live View: a read-only web page that shows the robot and the Xbox controller as they move.
// Served by the driving service at http://<pi>:5181. Browsers receive updates as
// Server-Sent Events; nothing on the page can send commands to the robot.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'};
const ROBOT_MS = 100;   // at most 10 robot updates a second per viewer
const PAD_MS = 50;      // at most 20 controller updates a second
const MAX_VIEWERS = 40; // a classroom; each viewer costs a little CPU on the Pi Zero
const LOG_KEEP = 30;
const MAX_BACKLOG = 256 * 1024; // bytes queued for one viewer before it is dropped (sleeping laptop, lost Wi-Fi)

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
        stopping: !!live.walking.stopping, blending: !!live.walking.blending} : null,
    } : null,
  };
}

// Controller state as the drive loop sees it: standard-layout pad -> sticks and held buttons.
export function padView(pad, buttons) {
  if (!pad) return {connected: false};
  const axis = i => Math.round((pad.axes?.[i] ?? 0) * 100) / 100;
  const held = Object.entries(buttons).filter(([, i]) => pad.buttons?.[i]?.pressed).map(([name]) => name);
  return {connected: true, name: pad.id, axes: [axis(0), axis(1), axis(2), axis(3)], held};
}

export function createLiveServer({root, port = 5181, host = '0.0.0.0', log = () => {}, now = Date.now} = {}) {
  const viewers = new Set();
  const state = {robot: null, pad: {connected: false}, log: []};
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
    robot: guard(snapshot => { state.robot = robotView(snapshot); if (viewers.size) sendRobot(state.robot); }),
    pad: guard((pad, buttons) => {
      const view = padView(pad, buttons), key = JSON.stringify(view);
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
    close() { for (const res of viewers) res.end(); viewers.clear(); return new Promise(resolve => server.close(() => resolve())); },
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
      res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({robot: state.robot, pad: state.pad, log: state.log})}\n\n`);
      viewers.add(res);
      req.on('close', () => viewers.delete(res));
      res.on('error', () => viewers.delete(res)); // a lost connection must not crash the service
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
  // Keep-alive comment so proxies and sleeping laptops notice a dead connection.
  const ping = setInterval(guard(() => write(': ping\n\n')), 15000);
  ping.unref?.();
  server.on('close', () => clearInterval(ping));
  server.on('error', error => log(`Live View could not start on port ${port}: ${error.message}`));
  server.listen(port, host, () => log(`Live View: http://${host === '0.0.0.0' ? '<pi-address>' : host}:${port}`));
  api.server = server;
  return api;
}
