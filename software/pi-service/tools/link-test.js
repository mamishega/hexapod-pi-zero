// Checks the Pi <-> Servo 2040 wiring: says hello over the UART and times a few status
// requests. It never enables the motors. Stop the driving service first:
//   sudo systemctl stop hexapod-drive && npm run link-test
import {NodeSerialLink} from '../src/node-serial-link.js';

const path = process.env.HEXAPOD_SERIAL || process.argv[2] || '/dev/serial0';
console.log(`Link test: ${path} at 115200 baud\n`);
const link = new NodeSerialLink(() => {}, error => console.log(`Link lost: ${error.message}`), {path});
try {
  const hello = await link.open();
  console.log('OK  The Servo 2040 answered.');
  console.log(`    Protocol: ${hello.protocol}`);
  console.log(`    Features: ${(hello.features || []).join(', ') || 'none (old board files)'}`);
  console.log(`    Motors:   ${hello.active ? 'ON' : 'off'}`);
  if (hello.power) console.log(`    Battery:  ${hello.power.voltage.toFixed(2)} V`);
  const times = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); await link.send('status'); times.push(performance.now() - t); }
  console.log(`    Status round trip: ${Math.min(...times).toFixed(0)}-${Math.max(...times).toFixed(0)} ms\n`);
  console.log('The wiring and board program are working.');
} catch (error) {
  console.log(`FAIL ${error.message}\n`);
  console.log('Check: TX/RX crossed (Pi pin 8 -> SCL, pin 10 -> SDA), GND connected, the board has the');
  console.log('Pi version of main.py, the serial console is off (deploy/install.sh), and the service is stopped.');
  process.exitCode = 1;
} finally {
  await link.close();
}
