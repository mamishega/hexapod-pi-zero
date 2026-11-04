# Hexapod Pi Zero 2 W

A six-legged walking robot driven by an **Xbox controller** through a **Raspberry Pi Zero 2 W**,
with a **Pimoroni Servo 2040** running the gait and inverse kinematics for 18 servos. Built for
teaching: a read-only **Live View** web page shows students how the robot moves and how each
command travels from the controller to the motors.

```
Xbox controller ──Bluetooth──▶ Raspberry Pi Zero 2 W ──UART──▶ Servo 2040 ──PWM──▶ 18 servos
                                   │
                                   └── Live View web page (port 5181) ──▶ laptops, phones, projector
```

## What's in this repository

| Folder / file | What it is |
|---|---|
| [`pi-service/`](pi-service/) | The program on the Pi: drives the robot from the controller, serves the Live View, and sets up offline (hotspot) Wi-Fi. Node.js; `npm test` runs the tests. See its [README](pi-service/README.md). |
| [`Board Files/`](Board%20Files/) | MicroPython program for the Servo 2040 (Pi version, listening on USB and UART). Copy to the board with Thonny. |
| [`source/`](source/) | Source of the user manual. `npm install` once, then `npm run build` writes the Word and web manuals. |
| `User Manual.docx`, [`Web Manual/`](Web%20Manual/) | The user manual (built from `source/content.js`). |
| `Wiring Schematic.*` | Wiring diagram (PDF, PNG, SVG). |
| `Plan.docx` | Project plan. |

## Quick start

1. Wire and power the robot (manual, Section 5) and set up the Pi (Section 6).
2. Copy `pi-service` to the Pi, then on the Pi: `bash deploy/install.sh`, then
   `sudo bash deploy/wifi/install-wifi.sh` for offline mode, and restart.
3. Copy `Board Files` to the Servo 2040 with Thonny.
4. On the Pi: `npm run link-test`, then `npm run controller-setup`.
5. Support the robot, press **A** on the controller, and walk with the left stick.
6. Open `http://hexapod.local:5181` (or `http://10.42.0.1:5181` on the robot's own hotspot).

Practice without the robot: in `pi-service`, run `npm run live-demo` and open `http://localhost:5182`.

> The Wi-Fi installer creates a default hotspot password. Change it before using the robot
> with a class (manual, Section 8.2).
