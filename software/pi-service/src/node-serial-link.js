// The browser's tested SerialLink (one request at a time, ids, timeouts, protocol check),
// running on Node over a Linux serial device such as the Pi's UART (/dev/serial0).
import {SerialLink} from '../vendor/webapp/dist/transport.js';

// Opens a real serial port with the 'serialport' package (installed on the Pi).
export async function openSerialPort(path, baudRate) {
  const {SerialPort} = await import('serialport');
  const port = new SerialPort({path, baudRate, autoOpen: false});
  await new Promise((resolve, reject) => port.open(error => (error ? reject(error) : resolve())));
  port.flush?.(() => {}); // drop bytes left over from before we connected
  return {
    readable: port,
    write: bytes => new Promise((resolve, reject) => port.write(Buffer.from(bytes), error => (error ? reject(error) : resolve()))),
    close: () => new Promise(resolve => (port.isOpen ? port.close(() => resolve()) : resolve())),
  };
}

// Adapters giving a Node stream the Web Streams shape SerialLink.read() expects.
function readerFor(stream) {
  const chunks = stream[Symbol.asyncIterator]();
  return {
    async read() { const next = await chunks.next(); return next.done ? {done: true} : {value: new Uint8Array(next.value), done: false}; },
    // Destroying the stream ends a read in progress (awaiting the iterator's return() would hang).
    async cancel() { stream.destroy(); },
    releaseLock() {},
  };
}

export class NodeSerialLink extends SerialLink {
  // options: {path, baudRate, openPort}. openPort is replaceable for tests.
  constructor(event, lost, {path = '/dev/serial0', baudRate = 115200, openPort = openSerialPort} = {}) {
    super(event, lost);
    Object.assign(this, {path, baudRate, openPort});
    this.simulated = false;
  }
  async open() {
    this.port = await this.openPort(this.path, this.baudRate);
    this.reader = readerFor(this.port.readable);
    this.writer = {write: bytes => this.port.write(bytes), releaseLock() {}};
    this.reading = this.read();
    return this.send('hello');
  }
}

// RobotController creates links as `new Link(event, lost)`; this binds the options.
export const linkClass = options => class extends NodeSerialLink { constructor(event, lost) { super(event, lost, options); } };
