// Single source for the Hexapod Pi Zero 2 W user manual. Both build_docx.js (Word)
// and build_web.js (web app) render from this file, so they always say the same thing.
//
// Inline text: **bold**, `code`. Block types:
//   {p}  {bullets: []}  {steps: [text | {text, code: []}]}  {checklist: {id, items: []}}
//   {code: []}  {table: {caption, head, rows, widths}}  {callout: {kind, title?, text}}
//   {figure: {src, caption}}
// Callout kinds: warning, caution, note, planned, verify.

module.exports = {
  meta: {
    title: 'Hexapod Pi Zero 2 W',
    subtitle: 'User Manual',
    docNo: 'HXP-UM-001',
    revision: 'H',
    date: '5 November 2026',
    status: 'Draft for review',
    scope: 'Raspberry Pi Zero 2 W version of the hexapod walking robot',
  },

  revisions: [
    ['H', '5 November 2026', 'Wiring schematic Rev C: RPLIDAR C1 360\u00b0 laser scanner (planned) on a USB hub at the Pi\u2019s USB port, with the Servo 2040 power lead. Pi supply raised to 3 A (Sections 5.2, 5.4 and 5.5).'],
    ['G', '4 November 2026', 'Live View: gait timing chart, pause / slow motion / replay, balance view, leg inspector, battery graph, message inspector and Join screen with QR codes (Section 8.1).'],
    ['F', '4 November 2026', 'Menu button changes the gait (ripple, wave, tripod); gait table added (Section 7.4). Live View split into pages with a side panel or top menu (Section 8.1).'],
    ['E', '4 November 2026', 'Added offline mode: the robot runs its own Wi-Fi hotspot when no saved network is in range (Section 8.2). Tested with a phone.'],
    ['D', '4 November 2026', 'Added the Live View web page for teaching (Section 8.1), with its demo mode and troubleshooting. Driving service, board UART link and controller setup tested on hardware.'],
    ['C', '4 November 2026', 'Login details: username `kangan`. Added connecting by IP address when hexapod.local cannot be found. Servo 2040 logic powered from the Pi\u2019s USB port (tested: the servo terminal does not power the board).'],
    ['B', '4 November 2026', 'Wiring schematic corrected: buck converter ground to the Pi, switch on the + wire only. Driving service and board UART support built. Added software installation, wiring test, controller setup and service troubleshooting. Not yet tested on hardware.'],
    ['A', '4 November 2026', 'First issue for review. Covers wiring, Raspberry Pi setup, controller pairing and operation. Features still in development are marked Planned.'],
  ],

  sections: [
    {
      id: 'introduction', title: 'Introduction',
      subsections: [
        {id: 'purpose', title: 'Purpose of this manual', blocks: [
          {p: 'This manual explains how to wire, set up, operate and maintain the Raspberry Pi Zero 2 W version of the hexapod walking robot. It is written for the person building and driving the robot, and assumes basic familiarity with a computer terminal.'},
          {p: 'Read **Section 2, Safety information** before powering the robot for the first time.'},
        ]},
        {id: 'overview', title: 'System overview', blocks: [
          {p: 'The hexapod is a six-legged walking robot with three servos per leg. A Pimoroni Servo 2040 board computes the walking gait and drives all 18 servos. In this version a Raspberry Pi Zero 2 W is mounted on the robot. It receives an Xbox controller over Bluetooth, checks every movement, and sends walking commands to the Servo 2040 over a short serial (UART) link. No laptop is required to drive the robot.'},
          {table: {caption: 'System components', head: ['Component', 'Function', 'Connection'], widths: [2300, 4200, 2526], rows: [
            ['Xbox controller', 'Driver input: sticks, buttons and walk settings.', 'Bluetooth to the Raspberry Pi'],
            ['Raspberry Pi Zero 2 W', 'Runs the driving service: reads the controller, checks reach and joint limits, and keeps the Servo 2040 watchdog supplied.', 'UART to the Servo 2040; Wi-Fi for setup and the web view'],
            ['Pimoroni Servo 2040', 'Runs the board program (motion_bridge.py): gait, inverse kinematics and servo output every 20 ms.', 'UART to the Pi; USB-C for a laptop'],
            ['RPLIDAR C1 (planned)', '360\u00b0 laser range scanner, 12 m range: maps the room around the robot.', 'USB adapter and hub to the Pi\u2019s USB port'],
            ['Phone or laptop (optional)', 'Live View: watch the robot, the controller and the servo angles in a web browser.', 'Wi-Fi to the Raspberry Pi'],
          ]}},
        ]},
        {id: 'status', title: 'Feature availability', blocks: [
          {p: 'This version of the robot is under development. The table below shows which parts are available now and which are planned. Instructions for planned features are marked with a **PLANNED** notice.'},
          {table: {caption: 'Feature availability', head: ['Feature', 'Status'], widths: [6000, 3026], rows: [
            ['Wiring and power design', 'Available: tested on hardware'],
            ['RPLIDAR C1 laser scanner', 'Planned: wiring shown, no software yet'],
            ['Raspberry Pi operating system setup', 'Available'],
            ['Xbox controller pairing with the Pi', 'Available'],
            ['Xbox controller driving from a laptop (Hexapod Remote)', 'Available'],
            ['UART support in the board program (motion_bridge.py)', 'Available: tested on hardware'],
            ['Driving service on the Raspberry Pi', 'Available: tested on hardware'],
            ['Controller setup wizard and wiring test', 'Available: tested on hardware'],
            ['Live View web page over Wi-Fi (watch only)', 'Available'],
            ['Offline mode: robot\u2019s own Wi-Fi hotspot', 'Available: tested'],
            ['Changing walk settings from a web browser', 'Planned'],
            ['Controller button for safe Pi shutdown', 'Planned'],
          ]}},
        ]},
        {id: 'conventions', title: 'Conventions', blocks: [
          {table: {caption: 'Conventions used in this manual', head: ['Convention', 'Meaning'], widths: [2600, 6426], rows: [
            ['**WARNING**', 'A hazard that could cause injury or serious damage to the robot.'],
            ['**CAUTION**', 'A situation that could damage equipment or cause unexpected movement.'],
            ['**VERIFY**', 'A detail that must be confirmed on your hardware before you continue.'],
            ['**NOTE**', 'Useful additional information.'],
            ['**PLANNED**', 'A feature that is not yet available.'],
            ['**Bold text**', 'Buttons, controls, menu items and labels.'],
            ['`Monospace text`', 'Commands to type, file names and settings.'],
          ]}},
        ]},
      ],
    },

    {
      id: 'safety', title: 'Safety information',
      subsections: [
        {id: 'general-safety', title: 'General safety', blocks: [
          {callout: {kind: 'warning', title: 'Moving parts', text: 'The servos are strong enough to pinch fingers. Keep hands clear of the legs whenever the motors are enabled.'}},
          {callout: {kind: 'warning', title: 'Support the robot', text: 'Support the body with the feet off the ground the first time you power the robot, after any wiring change, and after any software update.'}},
          {callout: {kind: 'caution', title: 'Power off before wiring', text: 'Turn the main switch off before connecting or disconnecting any wire. Connecting a wire to a powered board can damage it.'}},
          {callout: {kind: 'caution', title: 'Start slowly', text: 'Begin with the slowest speed and a small step height. Increase them only after the robot walks steadily.'}},
        ]},
        {id: 'stopping', title: 'Emergency stop methods', blocks: [
          {p: 'Learn all four ways to stop the robot before you drive it.'},
          {table: {caption: 'Ways to stop the robot', head: ['Method', 'Effect', 'When to use'], widths: [2300, 3800, 2926], rows: [
            ['Release both sticks', 'The robot finishes its step and stops in its starting stance.', 'Normal stopping'],
            ['**B** button', 'Stops the walk gently, as above.', 'Normal stopping'],
            ['**View** button', 'Releases all servo torque at once. The robot drops.', 'Emergency: the robot is about to fall or collide'],
            ['**Main switch**', 'Cuts all power to the Pi and the Servo 2040.', 'Emergency: anything else fails'],
          ]}},
          {callout: {kind: 'note', text: 'If the Servo 2040 receives no command for 3 seconds (Pi crash, loose wire, flat Pi supply), it switches the motors off automatically. This is a software safeguard, not a hardware cut-off. Always keep the main switch within reach.'}},
        ]},
      ],
    },

    {
      id: 'specifications', title: 'Technical specifications',
      blocks: [
        {table: {caption: 'Technical specifications', head: ['Item', 'Specification'], widths: [3300, 5726], rows: [
          ['Motion controller', 'Pimoroni Servo 2040 (RP2040 microcontroller, MicroPython), 18 servo outputs'],
          ['Host computer', 'Raspberry Pi Zero 2 W: quad-core 64-bit Arm Cortex-A53 at 1 GHz, 512 MB RAM'],
          ['Wireless', '2.4 GHz Wi-Fi (802.11 b/g/n), Bluetooth 4.2 / Bluetooth Low Energy'],
          ['Actuators', '18 servos: 6 legs × 3 joints (hip, upper leg, lower leg)'],
          ['Pi to Servo 2040 link', 'UART, 115200 baud, 3.3 V logic, three wires (TX, RX, GND)'],
          ['Command protocol', 'JSON lines, protocol hexapod-motion-v1'],
          ['Gait update rate', 'Every 20 ms, computed on the Servo 2040'],
          ['Communication watchdog', 'Motors switch off after 3 s without a command'],
          ['Gaits', 'Tripod, ripple, wave (blended while walking)'],
          ['Walking speed setting', '0.1 to 2.5 steps per second'],
          ['Step height setting', '0 to 60 mm'],
          ['Stride angle setting', '2° to 60°'],
          ['Pi power supply', '5 V, at least 3 A, separate regulator (also feeds the USB hub and LiDAR)'],
          ['LiDAR (planned)', 'RPLIDAR C1: 5 V about 230 mA, UART 460 800 baud through its USB adapter'],
          ['Servo power supply', 'At the voltage the servos are rated for'],
        ]}},
      ],
    },

    {
      id: 'parts', title: 'Parts and tools',
      blocks: [
        {table: {caption: 'Parts required', head: ['Part', 'Notes'], widths: [3400, 5626], rows: [
          ['Raspberry Pi Zero 2 W', 'Requires a 2.4 GHz Wi-Fi network for setup; it cannot use 5 GHz.'],
          ['microSD card, 16 GB or larger', 'Holds Raspberry Pi OS Lite and the driving software.'],
          ['Pimoroni Servo 2040', 'With the hexapod board files installed.'],
          ['18 servos', 'Three per leg.'],
          ['Battery pack', 'At the voltage the servos are rated for.'],
          ['Main switch and fuse', 'Between the battery and all other parts.'],
          ['5 V buck converter, 3 A or more', 'Supplies the Pi, and through the Pi\u2019s USB port the hub, LiDAR and Servo 2040 logic.'],
          ['UART wires', 'Three short wires, or a Qw/ST (Qwiic) cable for the Servo 2040 end.'],
          ['Xbox controller', 'Series X|S recommended. Older Xbox One S controllers may need the xpadneo driver.'],
          ['Micro-USB lead', 'From the buck converter to the Pi’s PWR IN port.'],
          ['Micro-USB OTG hub, 2 or more ports', 'On the Pi\u2019s USB port: feeds the Servo 2040 lead and the LiDAR.'],
          ['RPLIDAR C1 (planned)', 'Slamtec 360\u00b0 DTOF laser scanner, 12 m, IP54. Use the USB adapter board and lead from its kit.'],
          ['Laptop and USB-C cable (optional)', 'For Thonny and Motion Studio.'],
        ]}},
        {p: '**Tools:** small screwdriver, wire strippers, multimeter (to check supply voltages and continuity), and a Mac or PC with Raspberry Pi Imager.'},
      ],
    },

    {
      id: 'installation', title: 'Installation and wiring',
      subsections: [
        {id: 'before-wiring', title: 'Before you begin', blocks: [
          {callout: {kind: 'verify', title: 'Check the Servo 2040 pins', text: 'Confirm on the Servo 2040 pinout that its **SDA** pin is GP20 and its **SCL** pin is GP21. The serial link depends on this. If they differ, the board program must be changed to match before wiring.'}},
          {callout: {kind: 'verify', title: 'Check how the Servo 2040 is powered', text: 'Tested on this robot: the servo power terminal powers the servos only, not the Servo 2040\u2019s processor. Without a 5 V supply on its USB-C port the board does not start, and the Pi reports \u201cBoard link: offline\u201d. The lead from the Pi\u2019s USB port (Section 5.4) provides this, so no laptop is needed.'}},
        ]},
        {id: 'diagram', title: 'Wiring diagram', blocks: [
          {figure: {src: 'schematic', caption: 'Wiring schematic. Print Wiring Schematic.pdf (A3) and keep it with the robot.'}},
        ]},
        {id: 'serial-link', title: 'Serial link connections', blocks: [
          {table: {caption: 'Serial (UART) link: Raspberry Pi to Servo 2040', head: ['Raspberry Pi Zero 2 W', 'Servo 2040 (Qw/ST connector)', 'Notes'], widths: [2900, 3000, 3126], rows: [
            ['Pin 8 – GPIO14 (TX)', 'SCL – GP21 (RX)', 'Wires cross: TX to RX'],
            ['Pin 10 – GPIO15 (RX)', 'SDA – GP20 (TX)', 'Wires cross: RX to TX'],
            ['Pin 6 – GND', 'GND', 'Required'],
            ['Pin 1 – 3V3', 'Not connected', 'Each board has its own supply'],
          ]}},
          {bullets: [
            'Both boards use 3.3 V logic. No level shifter is needed.',
            'Keep the UART wires shorter than 20–30 cm and route them away from the servo power wires.',
          ]},
        ]},
        {id: 'power', title: 'Power connections', blocks: [
          {bullets: [
            'Battery **+** \u2192 main switch and fuse \u2192 Servo 2040 servo power terminal **V+**. The switch and fuse go on the + wire only.',
            'Battery **\u2212** \u2192 Servo 2040 **V\u2212**, and \u2192 buck converter **IN\u2212** (ground runs straight from the battery, not through the switch).',
            'Main switch output (+) \u2192 buck converter **IN+**.',
            'Buck converter **OUT+ (5 V)** and **OUT\u2212 (GND)** \u2192 Pi **PWR IN** port (the micro-USB port marked PWR IN, not USB). A micro-USB lead carries both wires.',
            'Pi **USB** port (the inner micro-USB port, not PWR IN) \u2192 Servo 2040 **USB-C**. This powers the Servo 2040\u2019s own processor. Use a micro-USB to USB-C lead, or an OTG adapter and a USB-C cable. When the LiDAR is fitted, a micro-USB OTG hub goes on this port and the Servo 2040 lead plugs into the hub.',
            'All grounds are joined: battery \u2212, buck converter, Pi and Servo 2040 GND.',
          ]},
          {callout: {kind: 'caution', title: 'Separate Pi supply', text: 'Never power the Pi directly from the servo supply. Servo current spikes cause the Pi to restart while walking.'}},
        ]},
        {id: 'lidar', title: 'RPLIDAR C1 laser scanner (planned)', blocks: [
          {callout: {kind: 'planned', title: 'Planned', text: 'The wiring is shown on schematic Rev C. The driving service does not read the LiDAR yet.'}},
          {bullets: [
            'Plug a micro-USB OTG hub into the Pi\u2019s **USB** port. Plug the Servo 2040 USB-C lead into the hub.',
            'Connect the RPLIDAR C1 to its **USB adapter board** (supplied in the kit) and plug the adapter into the hub. The adapter supplies 5 V and converts its 460 800 baud serial link to USB.',
            'Why USB and not the GPIO pins: the Pi\u2019s GPIO serial port (pins 8 and 10) is used by the Servo 2040, and its other serial port by Bluetooth for the controller.',
            'Mount the scanner on top of the robot, level, with a clear view all round. Legs or wires in its view show up as obstacles.',
            'Its signal pins use 3.3 V logic: never connect them to a 5 V signal.',
          ]},
          {callout: {kind: 'verify', title: 'Check the LiDAR pinout', text: 'Before making your own lead, check the connector pinout on the Slamtec RPLIDAR C1 datasheet. With the kit\u2019s adapter and lead, no check is needed.'}},
        ]},
        {id: 'wiring-check', title: 'Wiring checklist', blocks: [
          {checklist: {id: 'wiring', items: [
            'Main switch is off.',
            'SDA = GP20 and SCL = GP21 confirmed on the Servo 2040 pinout.',
            'Pi pin 8 (TX) connected to Servo 2040 SCL (GP21).',
            'Pi pin 10 (RX) connected to Servo 2040 SDA (GP20).',
            'Pi pin 6 (GND) connected to Servo 2040 GND.',
            '3V3 pins are not connected.',
            'Buck converter output measured at 5 V before connecting the Pi.',
            'Pi powered through PWR IN with both 5 V and GND from the buck converter, not from the servo supply.',
            'Main switch and fuse on the battery + wire; battery \u2212 goes straight to the Servo 2040 V\u2212 and the buck converter IN\u2212.',
            'Fuse fitted between the battery and the main switch.',
            'Servo 2040 USB-C connected to the Pi\u2019s USB port (not PWR IN), directly or through the USB hub, so the board runs without a laptop.',
            'If the LiDAR is fitted: it plugs into the hub through its USB adapter, and the buck converter is rated 3 A or more.',
          ]}},
        ]},
      ],
    },

    {
      id: 'pi-setup', title: 'Raspberry Pi setup',
      subsections: [
        {id: 'sd-card', title: 'Prepare the microSD card', blocks: [
          {steps: [
            'Insert the card fully into the computer’s SD slot. On a microSD adapter, make sure the lock switch is not set to **Lock**.',
            'Open **Raspberry Pi Imager**.',
            'Select **Device: Raspberry Pi Zero 2 W**.',
            'Select **Operating system: Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)**.',
            'Select **Storage:** the 16 GB card. Check carefully: this erases the selected disk.',
            'Click **Next**, then **Edit settings**. On the **General** tab set hostname `hexapod`, username `kangan` and its password, your Wi-Fi network and password, Wi-Fi country **AU**, and your time zone.',
            'On the **Services** tab, turn on **Enable SSH** with password authentication.',
            'Click **Save**, then **Yes**. Writing and verifying takes 5–10 minutes.',
            {text: 'Re-insert the card if it was ejected. On the **bootfs** volume, open `config.txt`, add this line at the end, save, and eject the card:', code: ['enable_uart=1']},
          ]},
          {callout: {kind: 'note', text: '`enable_uart=1` fixes the Pi’s clock so the serial port on GPIO14/15 runs at a steady 115200 baud while Bluetooth keeps the main serial port for the controller. Do not disable Bluetooth. The software installer (Section 6.4) also turns off the Pi\u2019s login console on this port, which would otherwise talk to the Servo 2040.'}},
        ]},
        {id: 'first-start', title: 'First start-up and remote login', blocks: [
          {steps: [
            'Insert the card into the Pi and apply power. The first start-up takes 2–3 minutes.',
            {text: 'On the computer, open a terminal and log in as **kangan**. Type the password when asked (nothing is shown while you type):', code: ['ssh kangan@hexapod.local']},
            {text: 'If `hexapod.local` cannot be found, use the Pi’s IP address instead. Find it in the router’s list of connected devices (the Pi is named **hexapod**). For example:', code: ['ssh kangan@192.168.20.28']},
            {text: 'Update the system, then restart and log in again:', code: ['sudo apt update && sudo apt full-upgrade -y', 'sudo reboot']},
            {text: 'Install Node.js and check the version:', code: ['sudo apt install -y nodejs npm', 'node --version']},
          ]},
        ]},
        {id: 'pairing', title: 'Pair the Xbox controller', blocks: [
          {steps: [
            {text: 'On the Pi, start the Bluetooth tool and begin scanning:', code: ['bluetoothctl', 'scan on']},
            'Hold the **Xbox** button to switch the controller on, then hold the small **pair** button on its top edge until the logo flashes quickly.',
            {text: 'When **Xbox Wireless Controller** appears with its address, pair, trust and connect it (replace the address with the one shown):', code: ['pair AA:BB:CC:DD:EE:FF', 'trust AA:BB:CC:DD:EE:FF', 'connect AA:BB:CC:DD:EE:FF']},
            {text: 'Stop scanning and exit. The controller now reconnects automatically when switched on.', code: ['scan off', 'exit']},
          ]},
          {callout: {kind: 'note', text: 'Older Xbox One S controllers may not pair, or may report the wrong buttons. Install the xpadneo driver and pair again, or use a Series X|S controller.'}},
        ]},
        {id: 'software', title: 'Install the hexapod software', blocks: [
          {p: 'The software is in the **pi-service** and **Board Files** folders next to this manual. The driving service starts automatically at boot once installed.'},
          {callout: {kind: 'note', text: 'Tested on the robot. Keep the body supported for the first test after any change.'}},
          {steps: [
            {text: 'From the computer, copy the service to the Pi:', code: ['scp -r pi-service kangan@hexapod.local:~/']},
            {text: 'On the Pi, run the installer, then restart. It installs dependencies, turns the UART on and its login console off, and sets the service to start at boot:', code: ['cd ~/pi-service', 'bash deploy/install.sh', 'sudo reboot']},
            'With the main switch off, connect the Servo 2040 to the computer by USB-C. In **Thonny**, copy the four files from **Board Files** to the board, keeping `calibration_offsets.json` and `joint_limits.json`. Run `check_and_restart.py`, then close Thonny.',
            'Wire the serial link (Section 5.3) and power the robot with its body supported.',
            {text: 'On the Pi, stop the service and check the wiring. This never enables the motors:', code: ['sudo systemctl stop hexapod-drive', 'npm run link-test']},
            {text: 'Teach the service your controller\u2019s buttons (once per controller model) and follow the prompts:', code: ['npm run controller-setup']},
            {text: 'Start the service:', code: ['sudo systemctl start hexapod-drive']},
            {text: 'Set up offline mode (the robot\u2019s own Wi-Fi hotspot, Section 8.2). This does not change the current Wi-Fi connection:', code: ['sudo bash deploy/wifi/install-wifi.sh']},
          ]},
          {callout: {kind: 'caution', title: 'Run the controller setup', text: 'Linux numbers the Xbox controller\u2019s buttons differently depending on its driver. Without `npm run controller-setup`, buttons may do the wrong thing. Check with `npm run controller-test` before driving.'}},
        ]},
      ],
    },

    {
      id: 'operation', title: 'Operation',
      subsections: [
        {id: 'pre-check', title: 'Pre-operation checklist', blocks: [
          {checklist: {id: 'preflight', items: [
            'Battery charged.',
            'Servo horns and screws tight; no damaged wires.',
            'Robot on its stand, or in a clear area at least 2 m across.',
            'Main switch within reach.',
            'Xbox controller charged.',
            'Speed set low and step height small for the first walk.',
          ]}},
        ]},
        {id: 'start-up', title: 'Starting up', blocks: [
          {steps: [
            'Place the robot on its stand (feet off the ground) or in the clear area.',
            'Turn on the **main switch**. The Pi and the Servo 2040 start. The motors remain off.',
            'Wait 30–60 seconds for the Pi to start.',
            'Switch the Xbox controller on. The logo stops flashing when it is connected.',
            'Press **A** to enable the motors. The legs glide to the home stance.',
            'Press **Y** to stand, then push the left stick to walk.',
          ]},
          {callout: {kind: 'note', text: 'Steps 3\u20136 require the software installed in Section 6.4. To watch what the service is doing, run `journalctl -u hexapod-drive -f` on the Pi.'}},
        ]},
        {id: 'controls', title: 'Controller reference', blocks: [
          {table: {caption: 'Xbox controller functions', head: ['Control', 'Function'], widths: [3000, 6026], rows: [
            ['Left stick', 'Walk forward, backward or sideways. Push further to walk faster. Steers while walking.'],
            ['Right stick (left/right)', 'Turn on the spot, or curve while walking.'],
            ['Release both sticks', 'Finish the step and stop in the starting stance.'],
            ['**A**', 'Enable: motors on, legs glide to the home stance.'],
            ['**Y**', 'Stand: raise the body.'],
            ['**X**', 'Sit: lower the body.'],
            ['**B**', 'Stop the walk gently.'],
            ['**View** (two squares)', 'Stop motors: release all servo torque at once. The robot drops.'],
            ['**D-pad up / down**', 'Speed + / − (0.1 steps per second per press).'],
            ['**RB / LB**', 'Step height + / − (2 mm per press).'],
            ['**D-pad right / left**', 'Stride angle + / − (2° per press).'],
            ['**Menu** (three lines, right of the Xbox button)', 'Change gait: ripple \u2192 wave \u2192 tripod \u2192 ripple. While walking the robot blends into the new gait without stopping; otherwise the next walk uses it.'],
          ]}},
        ]},
        {id: 'settings', title: 'Adjusting walk settings', blocks: [
          {table: {caption: 'Gaits (change with the Menu button)', head: ['Gait', 'Legs lifted at a time', 'Use'], widths: [1800, 3700, 3526], rows: [
            ['**Ripple** (default)', 'Two, in a wave down each side; about four feet on the ground', 'Smooth, natural walking'],
            ['**Wave**', 'One; five feet on the ground', 'Slowest and most stable: rough ground, demonstrations'],
            ['**Tripod**', 'Three (front and back on one side, middle on the other)', 'Fastest; always a stable triangle of feet'],
          ]}},
          {bullets: [
            'Hold a setting button to keep changing the value.',
            'While walking, the robot blends into the new setting once you stop pressing.',
            'A setting that would place a foot out of reach is refused, and the previous value is kept.',
            'After **B** or **View**, move the stick again to walk. Holding it does not restart the walk.',
            'If the controller switches off or its battery runs flat, the robot stops walking.',
          ]},
        ]},
        {id: 'shutdown', title: 'Stopping and shutting down', blocks: [
          {steps: [
            'Release the sticks (or press **B**) and wait for the robot to stop.',
            'Press **X** to sit, then **View** to switch the motors off.',
            {text: 'Shut the Pi down from the computer so the microSD card is not damaged:', code: ['ssh -t kangan@hexapod.local sudo shutdown -h now']},
            'Wait until the Pi’s green light stops flashing (about 10 seconds), then turn off the **main switch**.',
          ]},
          {callout: {kind: 'caution', text: 'Turning off the main switch while the Pi is running can corrupt its microSD card.'}},
          {callout: {kind: 'planned', text: 'A controller button combination to shut the Pi down safely without a computer.'}},
        ]},
      ],
    },

    {
      id: 'remote-access', title: 'Phone and laptop access',
      subsections: [
        {id: 'web-view', title: 'Live View (web page for teaching)', blocks: [
          {p: 'The Pi serves a **Live View** web page that shows, as it happens, how the robot moves and how a command travels from the controller to the servos. It is designed for showing students how the robot works. It starts automatically with the driving service; nothing needs to be installed on the viewing devices.'},
          {steps: [
            'Connect the phone, tablet or laptop to the **same Wi-Fi network** as the robot.',
            {text: 'Open a web browser (Chrome, Edge, Safari or Firefox) and go to the Pi’s address on port 5181. If `hexapod.local` is not found, use the Pi’s IP address instead (192.168.20.28 when this manual was written; check the router if it has changed). In offline mode (Section 8.2) it is always 10.42.0.1:', code: ['http://hexapod.local:5181', 'http://192.168.20.28:5181', 'http://10.42.0.1:5181']},
            'Drive the robot with the Xbox controller as usual. The page updates on every viewer at the same time.',
          ]},
          {p: 'The page is split into five pages. On a laptop or larger screen they are listed in a side panel on the left; on a tablet or phone they are in a menu along the top. Each page has its own address (for example `http://hexapod.local:5181/#servos`), so one page can be projected or shared.'},
          {table: {caption: 'Live View pages', head: ['Page', 'What it shows'], widths: [2600, 6426], rows: [
            ['**Live** (#live)', 'The robot drawn from the pose the Servo 2040 is commanding (3D, top, front and side views): lifted legs are bright, the grid slides under it as it walks, footprints show where each foot landed, and the **balance** area (dashed) shows the feet on the ground with a crosshair at the body’s centre: green and “Stable” while the centre is inside. A **replay bar** pauses (Space), drags back up to 20 seconds and plays at ½× or ¼×; ● Live returns. Below it, the **gait timing chart**: one row per leg, filled while the foot is on the ground. Beside it: what the last command did, walking direction and settings, and a 10-minute **battery** graph of voltage and current.'],
            ['**Controller** (#controller)', 'The Xbox controller with the sticks and buttons in use lit up, each labelled with its job; the explanation of every button press; and a short **Try this** list of activities.'],
            ['**How it works** (#how)', 'Controller → Bluetooth → Raspberry Pi → UART serial wires → Servo 2040 → PWM pulses → 18 servos, with a dot for each real message. The **message inspector** lists the actual commands and replies on the serial wires (status checks hidden unless ticked; **Freeze** holds the list). Short explanations of Bluetooth, UART and PWM.'],
            ['**Servo angles** (#servos)', 'The robot beside the hip, upper-leg and lower-leg angles for every leg. Tap a leg for the **leg inspector**: the leg from the side with its segment lengths, the reach line and knee angle, and the inverse-kinematics numbers (law of cosines) next to the board’s servo angles.'],
            ['**Messages** (#messages)', 'The driving service’s messages, newest first. A counter on the menu shows new messages while another page is open.'],
          ]}},
          {p: 'The **Join** button at the top shows how students open the page: the address with a QR code to scan and, on the robot’s own hotspot, the Wi-Fi name and password with a Wi-Fi QR code. The password is only shown to devices already on the hotspot. To put the join screen straight on a projector, open `http://hexapod.local:5181/#join`.'},
          {p: 'The **sun/moon** button at the top switches between light and dark themes (the page otherwise follows the device’s setting). The **full-screen** button is for projectors. To force a theme, add it to the address, for example `http://hexapod.local:5181/?theme=light#live`.'},
          {callout: {kind: 'note', title: 'Watch only', text: 'Nothing on the page can move the robot: only the Xbox controller drives it. Up to 40 devices can watch at once. The pose shown is what the board is commanding; the servos have no position sensors, so a jammed or unpowered leg still appears to move.'}},
          {callout: {kind: 'note', title: 'Practise without the robot', text: 'On a Mac or PC with Node.js, open a terminal in the **pi-service** folder and run `npm run live-demo`, then open http://localhost:5182. A simulated robot and a scripted controller run a 75-second lesson (enable, walk, slow down, crab walk, turn, high steps, sit, stand) on repeat. Press Ctrl+C to stop.'}},
          {p: '**Teaching tips:** slow the walk down (**D-pad ↓**) so students can see which legs lift together; use the **Top** view to show the gait pattern and the **Side** view to show step height; ask students to predict which servo angle will change before pressing **RB**.'},
        ]},
        {id: 'offline', title: 'Offline mode: the robot’s own Wi-Fi', blocks: [
          {p: 'Where there is no Wi-Fi network, or the robot is away from its saved network, the Pi runs its **own Wi-Fi network (a hotspot)**. Laptops, tablets and phones join it directly, so the Live View and remote login still work with no router and no internet.'},
          {table: {caption: 'Wi-Fi modes', head: ['Mode', 'What the Pi does', 'Address of the Pi'], widths: [1900, 4626, 2500], rows: [
            ['**Station** (normal)', 'Joins a saved Wi-Fi network, like any other device.', 'Given by the router, for example 192.168.20.28'],
            ['**Hotspot** (access point)', 'Runs its own network called **Hexapod-6607** (the last four characters of the Pi’s Wi-Fi address). Gives each device that joins an address.', 'Always **10.42.0.1**'],
          ]}},
          {p: 'The Pi Zero 2 W does one or the other, not both. By default it chooses automatically (**auto** mode):'},
          {bullets: [
            'At power-on it looks for a saved network. If none is found, the hotspot starts **about 75 seconds** after power-on.',
            'If the saved network is lost while running, the hotspot starts about a minute later.',
            'While the hotspot runs with **nobody connected**, the Pi looks for a saved network again every 10 minutes. It never drops devices that are connected.',
            'The robot itself keeps working throughout: the controller uses Bluetooth and the Servo 2040 uses the serial wires.',
          ]},
          {steps: [
            {text: 'On a laptop, tablet or phone, join the robot’s Wi-Fi network:', code: ['Network:  Hexapod-6607', 'Password: hexapod2026']},
            'If the device warns that the network has **no internet**, choose to stay connected.',
            {text: 'Open the Live View, or log in to the Pi:', code: ['http://10.42.0.1:5181', 'ssh kangan@10.42.0.1']},
          ]},
          {table: {caption: 'Wi-Fi commands (on the Pi)', head: ['Command', 'What it does'], widths: [3600, 5426], rows: [
            ['`hexapod-wifi status`', 'Shows the mode, the network, the Pi’s address and the Live View link.'],
            ['`sudo hexapod-wifi hotspot`', 'Always run the hotspot, for example in a classroom with no suitable network. Stays set after a restart.'],
            ['`sudo hexapod-wifi auto`', 'Back to automatic: saved network if available, otherwise hotspot (default).'],
            ['`sudo hexapod-wifi station`', 'Never run the hotspot; only join saved networks.'],
            ['`sudo hexapod-wifi reconnect`', 'Leave the hotspot now and try the saved networks.'],
            ['`sudo hexapod-wifi test-hotspot 5`', 'Run the hotspot for 5 minutes, then return to the saved network. Use a phone to test: the computer you are logged in from loses its connection to the Pi during the test.'],
          ]}},
          {callout: {kind: 'caution', title: 'Change the hotspot password', text: 'Everyone who knows the password can join the robot’s network and reach the Pi’s login prompt. Change it before using the robot with a class: on the Pi, edit `/etc/hexapod/wifi.conf` (`sudo nano /etc/hexapod/wifi.conf`), then run `sudo bash ~/pi-service/deploy/wifi/install-wifi.sh` to apply it. The password must be at least 8 characters.'}},
          {callout: {kind: 'note', text: 'The hotspot uses 2.4 GHz channel 6, the only band the Pi Zero 2 W supports. With several robots in one room, each has its own network name. To add another saved network, use `sudo nmtui` on the Pi.'}},
        ]},
        {id: 'usb', title: 'Laptop on USB-C', blocks: [
          {p: 'Thonny (to copy board files) and Motion Studio (to train movements and calibrate legs) connect to the Servo 2040’s USB-C port. That port normally powers the board from the Pi (Section 5.4): with the main switch off, move the lead from the Pi to the laptop, and move it back afterwards.'},
          {bullets: [
            'Switch the motors off (**View**) before connecting a laptop, and do not drive with the controller while a laptop is connected.',
            'Only one program can use the USB port at a time. Close Thonny before opening Motion Studio.',
            'Keep the board’s `calibration_offsets.json` and `joint_limits.json` when copying new files.',
          ]},
        ]},
      ],
    },

    {
      id: 'troubleshooting', title: 'Troubleshooting',
      blocks: [
        {table: {caption: 'Troubleshooting', head: ['Symptom', 'Likely cause', 'Remedy'], widths: [2600, 2800, 3626], rows: [
          ['The computer does not detect the microSD card', 'Card not fully inserted, or adapter locked', 'Push the card in until flush. Slide the adapter’s lock switch up.'],
          ['hexapod.local cannot be found', 'Pi still starting, or not connected to Wi-Fi', 'Wait 3 minutes. Log in by IP address instead (Section 6.2). Confirm the network is 2.4 GHz and the Wi-Fi password is correct. Re-run Raspberry Pi Imager if needed.'],
          ['SSH says “Permission denied”', 'Wrong username or password', 'The username is `kangan` (lower case). Retype the password carefully: nothing is shown while you type it.'],
          ['SSH warns the host key has changed', 'The microSD card was rewritten', 'Run `ssh-keygen -R hexapod.local` (or the IP address), then log in again.'],
          ['The Pi restarts repeatedly', 'Insufficient or shared power supply', 'Use the separate 5 V buck converter (3 A or more) into PWR IN.'],
          ['The controller does not pair', 'Older Xbox One controller', 'Install the xpadneo driver, or use a Series X|S controller.'],
          ['Buttons have no effect', 'Motors not enabled, or controller not connected', 'Press **A**. Check the controller logo is lit steadily.'],
          ['Motors switch off unexpectedly', 'Watchdog: no command for 3 seconds', 'Check the UART wires, the ground wire and the Pi’s power supply.'],
          ['“No training bridge reply” on a laptop', 'Board program not running, or port in use', 'Close Thonny and other browser tabs. Unplug USB for 5 seconds, reconnect and try again.'],
          ['Board link goes offline when the laptop is unplugged', 'Servo 2040 processor has no 5 V supply', 'Connect the Pi\u2019s USB port to the Servo 2040 USB-C (Section 5.4).'],
          ['The Live View page does not load', 'Wrong address, different Wi-Fi network, or the driving service is stopped', 'Check the device is on the robot’s Wi-Fi and use the Pi’s IP address with :5181. On the Pi, `systemctl status hexapod-drive` should show active and the log should contain “Live View”. Some school networks block devices from reaching each other: show the page from one laptop on a projector instead.'],
          ['The Live View says “Board offline”', 'Servo 2040 not powered or serial link down', 'See “Board link goes offline” above, and check the board’s USB-C lead to the Pi.'],
          ['The Hexapod Wi-Fi network does not appear', 'The Pi is on a saved network, or still starting', 'Wait 2 minutes after power-on. If the Pi can reach its saved network it does not run the hotspot: run `sudo hexapod-wifi hotspot` to force it, or `sudo hexapod-wifi test-hotspot 5` to try it.'],
          ['Joined the Hexapod network but the page does not load', 'Device left the network because it has no internet, or wrong address', 'Choose “stay connected” when the device warns about no internet, turn off mobile data on phones, and use http://10.42.0.1:5181.'],
          ['npm run link-test reports FAIL', 'Wiring, board files or serial console', 'Check TX and RX are crossed and GND is connected, the board has the Pi version of main.py, and deploy/install.sh was run and the Pi restarted.'],
          ['Buttons do the wrong thing', 'Controller layout not learned', 'Stop the service, run `npm run controller-setup`, check with `npm run controller-test`.'],
          ['The robot does not respond at all', 'Driving service not running', 'Run `systemctl status hexapod-drive` and `journalctl -u hexapod-drive -n 50` on the Pi.'],
          ['A foot is reported out of reach', 'Step height or stride angle too large for the stance', 'Reduce the step height or stride angle.'],
          ['Walking is slower than the speed setting', 'Board updates slower than expected', 'Increase `MAX_WALK_STEP_MS` in motion_bridge.py (for example to 80).'],
        ]}},
      ],
    },

    {
      id: 'maintenance', title: 'Care and maintenance',
      blocks: [
        {table: {caption: 'Maintenance schedule', head: ['Task', 'When'], widths: [6000, 3026], rows: [
          ['Charge the battery fully', 'Before each use'],
          ['Check servo horns, screws and wiring', 'Every few hours of walking'],
          ['Back up calibration_offsets.json and joint_limits.json', 'After any calibration change'],
          ['Make a backup image of the Pi’s microSD card', 'After setup, and after software updates'],
          ['Recalibrate the leg in Motion Studio (Leg calibration tab)', 'After replacing a servo'],
          ['Store the battery as its manufacturer recommends', 'Between uses'],
        ]}},
      ],
    },

    {
      id: 'glossary', title: 'Glossary', appendix: true,
      blocks: [
        {table: {caption: 'Glossary', head: ['Term', 'Meaning'], widths: [2600, 6426], rows: [
          ['Buck converter', 'A regulator that reduces battery voltage to a steady 5 V for the Pi.'],
          ['Driving service', 'The program on the Pi (hexapod-drive) that reads the controller and sends commands to the Servo 2040.'],
          ['Gait', 'The pattern in which the legs move: tripod (fast), ripple (natural) or wave (most stable).'],
          ['GPIO', 'General-purpose input/output pins on the Raspberry Pi header.'],
          ['Hip, upper leg, lower leg', 'The three joints of each leg, each driven by one servo.'],
          ['Hotspot (access point)', 'The Pi running its own Wi-Fi network for other devices to join (offline mode, Section 8.2).'],
          ['Inverse kinematics', 'Working backwards from where a foot should be to the joint angles that put it there. The Servo 2040 does this for all six legs every 20 ms.'],
          ['Live View', 'The read-only web page served by the Pi on port 5181 that shows the robot, the controller and the servo angles as they change (Section 8.1).'],
          ['PWM', 'Pulse-width modulation: a repeating pulse whose length tells a servo which angle to hold. The Servo 2040 sends one PWM signal per servo.'],
          ['Qw/ST', 'Pimoroni’s four-pin connector (compatible with Qwiic), carrying SDA, SCL, 3V3 and GND.'],
          ['SSH', 'Secure Shell: a way to log in to the Pi from another computer over the network.'],
          ['Stance', 'The position of the feet when the robot is standing.'],
          ['Station mode', 'The Pi joining an existing Wi-Fi network as an ordinary device.'],
          ['UART', 'A simple two-wire serial link (TX and RX) used between the Pi and the Servo 2040.'],
          ['Watchdog', 'A safeguard on the Servo 2040 that switches the motors off after 3 seconds without a command.'],
        ]}},
      ],
    },
  ],
};
