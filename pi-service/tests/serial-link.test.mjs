import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {SimulatedLink} from '../vendor/webapp/dist/simulator.js';
import {NodeSerialLink, linkClass} from '../src/node-serial-link.js';

// A fake serial port with a simulated Servo 2040 on the other end. Replies are sent in
// small chunks, as a UART delivers them, to exercise line reassembly.
function fakeBoard({chunk = 7, silent = false} = {}) {
  const readable = new PassThrough();
  const sim = new SimulatedLink(() => {}, () => {});
  let buffer = '';
  const port = {
    readable, requests: [], closed: false,
    async write(bytes) {
      buffer += Buffer.from(bytes).toString();
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1);
        port.requests.push(request);
        if (silent) continue;
        let reply;
        try { reply = {id: request.id, ok: true, state: sim.handle({...request})}; } catch (error) { reply = {id: request.id, ok: false, error: error.message}; }
        const text = JSON.stringify(reply) + '\n';
        for (let i = 0; i < text.length; i += chunk) readable.write(Buffer.from(text.slice(i, i + chunk)));
      }
    },
    async close() { port.closed = true; readable.end(); },
    say(line) { readable.write(Buffer.from(line + '\n')); },
  };
  return port;
}
const linkTo = (port, events = [], lost = []) => new NodeSerialLink(e => events.push(e), e => lost.push(e), {path: '/dev/fake', openPort: async () => port});

test('says hello and sends commands over the serial port', async () => {
  const port = fakeBoard();
  const link = linkTo(port);
  const hello = await link.open();
  assert.equal(hello.protocol, 'hexapod-motion-v1');
  assert.ok(hello.features.includes('resume'));
  const armed = await link.send('arm');
  assert.equal(armed.active, true);
  assert.deepEqual(port.requests.map(r => [r.id, r.op]), [[1, 'hello'], [2, 'arm']]);
  await link.close();
  assert.equal(port.closed, true);
});

test('ignores stray serial noise and passes board events on', async () => {
  const port = fakeBoard();
  const events = [];
  const link = linkTo(port, events);
  port.say('\u0000garbage from boot');
  await link.open();
  port.say(JSON.stringify({event: 'walked', state: {protocol: 'hexapod-motion-v1', walking: null}}));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(events.map(e => e.event), ['walked']);
  await link.close();
});

test('a board error reply rejects that request only', async () => {
  const link = linkTo(fakeBoard());
  await link.open();
  await assert.rejects(link.send('pose', {positions: [], duration_ms: 500}), /Enable at home/);
  assert.equal((await link.send('status')).protocol, 'hexapod-motion-v1');
  await link.close();
});

test('an unplugged link reports itself lost', async () => {
  const port = fakeBoard(), lost = [];
  const link = linkTo(port, [], lost);
  await link.open();
  port.readable.end(); // cable pulled: the stream ends
  await new Promise(r => setTimeout(r, 20));
  assert.equal(lost.length, 1);
  await assert.rejects(link.send('status'));
  await link.close();
});

test('no reply times out instead of hanging', {timeout: 8000}, async () => {
  const link = linkTo(fakeBoard({silent: true}));
  await assert.rejects(link.open(), /No (training )?bridge reply/);
  await link.close();
});

test('linkClass binds the serial options for RobotController', async () => {
  const port = fakeBoard();
  const Link = linkClass({path: '/dev/fake', openPort: async path => { assert.equal(path, '/dev/fake'); return port; }});
  const link = new Link(() => {}, () => {});
  assert.equal((await link.open()).protocol, 'hexapod-motion-v1');
  await link.close();
});
