# Hexapod Pi Zero 2 W

**A six-legged walking robot for teaching robotics, driven by an Xbox controller and explained live in any web browser.**

![Status](https://img.shields.io/badge/status-tested%20on%20hardware-2e7d32)
![Platform](https://img.shields.io/badge/Raspberry%20Pi-Zero%202%20W-c51a4a)
![Board](https://img.shields.io/badge/Servo%202040-MicroPython-5e35b1)
![Node](https://img.shields.io/badge/Node.js-%E2%89%A518-339933)
![Tests](https://img.shields.io/badge/tests-53%20passing-2e7d32)
![Manual](https://img.shields.io/badge/manual-rev%20L-0d7a69)

A Raspberry Pi Zero 2 W mounted on the robot reads an Xbox controller over Bluetooth, checks every
movement against reach and joint limits, and sends walking commands to a Pimoroni Servo 2040, which
computes the gait and inverse kinematics for 18 servos. No laptop is needed to drive it.

A read-only **Live View** web app shows students, as it happens, how the robot moves and how each
command travels from the controller to the motors.

```
Xbox controller ──Bluetooth──▶ Raspberry Pi Zero 2 W ──UART──▶ Servo 2040 ──PWM──▶ 18 servos
                                   │
                                   ├── Live View web app (port 5181) ──▶ laptops, phones, projector
                                   └── USB hub ──▶ RPLIDAR C1 360° laser scanner (planned)
```

---

## Contents

- [Features](#features)
- [Hardware](#hardware)
- [Quick start](#quick-start)
- [Opening the Live View](#opening-the-live-view)
- [Controls](#controls)
- [Network and offline mode](#network-and-offline-mode)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [Development](#development)
- [Safety](#safety)
- [Roadmap](#roadmap)

---

## Features

| | |
|---|---|
| **Standalone driving** | Starts by itself at power-on. Xbox controller over Bluetooth (xpadneo driver), with no laptop. |
| **Three gaits** | Ripple (default), wave and tripod. The **Menu** button switches between them, blending mid-walk without stopping. |
| **Safety built in** | Every command is checked for reach and joint limits. A 3-second watchdog on the Servo 2040 turns the motors off if the Pi stops talking. |
| **Live View teaching app** | Realistic 3D robot (drawn as built: red hip servos, black knee servos, curved red feet, sensor box at the front), balance view, gait timing chart, pause, slow motion and replay, leg inspector (inverse kinematics), servo angles, battery graph, and a message inspector for the real serial traffic. |
| **Health and servo care** | A Health page (battery, Pi power and temperature, controller drop-outs, board link, Wi-Fi) with a warning banner on every page, and a Servo care page that tracks each servo's travel, time near its limits and calibration offset, with lifetime totals saved on the Pi. |
| **Easy for a class to join** | The **Join** screen shows the address as a QR code and, on the hotspot, a Wi-Fi QR code. Up to 40 viewers can watch at once. |
| **Works anywhere** | Joins the work Wi-Fi (**Robocop**) when it is in range. Otherwise it runs its own hotspot, so the app still works with no router. |
| **Demo mode** | A simulated robot and a scripted 75-second lesson, for practising the Live View on any computer. |

## Hardware

| Part | Role |
|---|---|
| Raspberry Pi Zero 2 W | Runs the driving service and the Live View. Raspberry Pi OS Lite (64-bit), hostname `hexapod`, user `kangan`. |
| Pimoroni Servo 2040 | Runs `motion_bridge.py`: gait, inverse kinematics and servo output every 20 ms. |
| 18 servos | Three per leg (hip, upper leg, lower leg) on outputs 1–18. |
| Xbox Wireless Controller | Driver input, over Bluetooth. Keep its firmware up to date. |
| Battery, main switch and fuse | Servo power, with the switch and fuse on the + wire only. |
| 5 V buck converter, 3 A or more | Powers the Pi through **PWR IN**. Through the Pi's USB port it also powers the hub, the LiDAR and the Servo 2040 logic. |
| Micro-USB OTG hub | On the Pi's inner **USB** port. Feeds the Servo 2040 USB-C (logic power) and the LiDAR. |
| RPLIDAR C1 *(planned)* | Slamtec 360° DTOF laser scanner, 12 m, IP54. Connects through its USB adapter. |

**Serial link (UART, 115 200 baud, 3.3 V logic):**

| Raspberry Pi | Servo 2040 (Qw/ST connector) |
|---|---|
| Pin 8, GPIO14 (TX) | SCL, GP21 (RX) |
| Pin 10, GPIO15 (RX) | SDA, GP20 (TX) |
| Pin 6, GND | GND |
| Pin 1, 3V3 | **Not connected** |

The full wiring is in [`Wiring Schematic.pdf`](Wiring%20Schematic.pdf) (Rev C, print on A3). An
interactive version is in [`Circuit Studio/`](Circuit%20Studio/).

## Quick start

> Full instructions, with checks at each step, are in the [user manual](#documentation).

1. **Wire and power** the robot (manual, Section 5).
2. **Set up the Pi** with Raspberry Pi Imager (manual, Section 6): hostname `hexapod`, user `kangan`, Wi-Fi **Robocop**, country **AU**.
3. **Install the software.** On the Mac:
   ```sh
   scp -r pi-service kangan@hexapod.local:~/
   ```
   Then, logged in to the Pi:
   ```sh
   cd ~/pi-service
   bash deploy/install.sh                  # driving service, serial port, start at power-on
   sudo bash deploy/wifi/install-wifi.sh   # offline (hotspot) mode
   sudo reboot
   ```
4. **Update the Servo 2040.** In Thonny, copy the files in [`Board Files/`](Board%20Files/) to the board. Keep `calibration_offsets.json` and `joint_limits.json` on the board.
5. **Test the link and set up the controller.** On the Pi:
   ```sh
   sudo systemctl stop hexapod-drive
   npm run link-test          # expects "OK  The Servo 2040 answered."
   npm run controller-setup   # once per controller
   sudo systemctl start hexapod-drive
   ```
6. **Drive.** Support the robot, press **A** to enable, **Y** to stand, then walk with the left stick.

## Opening the Live View

The web app starts by itself with the robot. There is nothing to launch or install.

1. Switch the robot on and wait about **1 minute**.
2. Join the same Wi-Fi network as the robot (**Robocop** at work).
3. Open a browser and go to:

| Where | Address |
|---|---|
| At work (Robocop) | **http://hexapod.local:5181**, or **http://10.52.126.57:5181** on phones |
| Robot's hotspot (offline) | **http://10.42.0.1:5181** |
| Demo on your own computer | **http://localhost:5182**, after `npm run live-demo` in `pi-service` |

Type `http://`, not `https://`. The number address comes from the router and can change after a
restart: run `hostname -I` on the Pi to check it. To get a class connected, press **Join** and
project the QR code.

| Page | Shows |
|---|---|
| **Live** | 3D, top, front and side views, the balance area, the gait timing chart, and replay |
| **Controller** | Sticks and buttons in use, what each does, and "Try this" activities |
| **How it works** | Controller → Bluetooth → Pi → UART → Servo 2040 → servos, plus the message inspector |
| **Servo angles** | Every joint angle, and the leg inspector with the inverse-kinematics working |
| **Health** | Battery, Pi power and temperature, controller, board link and Wi-Fi at a glance; events; a warning banner on every page |
| **Servo care** | Each servo's angle within its usable range, time near the end of travel, movement and calibration offset; hardest-working servos |
| **Messages** | The driving service's log, newest first |

## Controls

| Control | Action |
|---|---|
| Left stick | Walk forward, backward or sideways (push further for faster) |
| Right stick | Turn on the spot, or curve while walking |
| **A** | Enable: motors on, legs glide to the home stance |
| **Y** / **X** | Stand / sit |
| **B** | Stop the walk gently |
| **View** | **Motors off at once. The robot drops.** |
| **Menu** | Change gait: ripple → wave → tripod |
| D-pad ↑ / ↓ | Speed + / − |
| D-pad → / ← | Stride + / − |
| RB / LB | Step height + / − |

To shut down: press **X** to sit, **View** to switch the motors off, then turn off the main switch.

## Network and offline mode

| Mode | When | Pi address |
|---|---|---|
| **Station** | A saved network is in range. At work this is **Robocop** (preferred). | From the router, for example 10.52.126.57 |
| **Hotspot** | No saved network is found (about 75 s after power-on) | Always **10.42.0.1**, network **Hexapod-6607** |

Run `sudo hexapod-wifi auto | hotspot | station | reconnect | test-hotspot 5` on the Pi to choose
the mode. The installer sets a default hotspot password, so **change it before using the robot
with a class** (manual, Section 8.2).

## Repository layout

```
.
├── pi-service/          Program on the Pi (Node.js)
│   ├── src/             Driving service, controller input, Live View server, serial link
│   ├── live/            Live View web app (plain ES modules, no build step)
│   ├── deploy/          systemd service, installer, Wi-Fi / hotspot manager
│   ├── tools/           link-test, controller-setup/test, live-demo, QR checks
│   ├── tests/           Unit tests (node --test)
│   └── vendor/          Shared robot controller code (do not edit)
├── Board Files/         MicroPython program for the Servo 2040
├── source/              Manual and schematic sources (content.js, make_schematic.py, ...)
├── Web Manual/          User manual as a web page
├── Circuit Studio/      Interactive schematic: project file and share link
├── User Manual.docx     User manual (Word)
├── Wiring Schematic.*   Wiring schematic (PDF, PNG, SVG)
└── Plan.docx            Project plan
```

## Documentation

| Document | Contents |
|---|---|
| [`User Manual.docx`](User%20Manual.docx) / [`Web Manual/index.html`](Web%20Manual/index.html) | Safety, wiring, Pi setup, controller pairing, driving, Live View, offline mode, troubleshooting and maintenance (revision L) |
| [`pi-service/README.md`](pi-service/README.md) | Step-by-step install and everyday use of the Pi program |
| [`Wiring Schematic.pdf`](Wiring%20Schematic.pdf) | Wiring diagram, Rev C, A3 |
| [`Circuit Studio/`](Circuit%20Studio/) | The schematic in [Circuit Studio](https://circuit-studio.pages.dev/): double-click `Open in Circuit Studio.webloc`, or load the `.json` with **Open** |

## Development

```sh
cd pi-service
npm install
npm test             # 53 unit tests
npm run live-demo    # Live View with a simulated robot: http://localhost:5182
```

Rebuild the documents after editing their sources:

```sh
cd source
npm install                                         # once
npm run build                                       # User Manual.docx + Web Manual
python3 make_schematic.py ..                        # Wiring Schematic.svg (then export PNG / PDF)
node make_circuit_studio.mjs "../Circuit Studio"    # Circuit Studio project and link
```

To deploy changes to the robot, copy `pi-service` to the Pi again and run
`sudo systemctl restart hexapod-drive`. Make the robot sit and switch the motors off first,
because a restart drops it.

## Safety

- Support the body, with the feet off the ground, the first time you power it and after any wiring or software change.
- Turn the main switch off before connecting or disconnecting any wire.
- Never power the Pi from the servo supply: use the separate 5 V buck converter.
- **View** releases all servos at once. Use it in an emergency, knowing the robot will drop.

## Roadmap

- [x] Standalone driving from an Xbox controller over a UART link
- [x] Live View teaching app with replay, gait chart, leg inspector and QR join screen
- [x] Offline hotspot mode
- [x] Gait change from the controller
- [x] Health page and servo stress monitor
- [ ] RPLIDAR C1 360° scanning (wiring designed, software to come)
- [ ] Changing walk settings from the web app

---

<sub>Hexapod Pi Zero 2 W · private repository · passwords are kept out of this repository on purpose</sub>
