# Hexapod Pi Service

This program runs on the **Raspberry Pi Zero 2 W** inside the robot. It lets you drive the
hexapod with an **Xbox controller**, with no laptop needed.

```
Xbox controller  ──Bluetooth──▶  Raspberry Pi (this program)  ──3 wires──▶  Servo 2040  ──▶  18 servos
```

It starts by itself when the Pi powers on. It uses the same driving and safety code as the
Hexapod Remote app, so the controls work the same way.

> **Status:** tested on the robot (November 2026): driving, gait changes (Menu button), the
> Live View web page on port 5181 and offline hotspot mode. Keep the robot supported (feet off
> the ground) the first time you use it after any change.

---

## What you need first

Do these first. The user manual (section 6) explains each one.

- [ ] The microSD card set up with **Raspberry Pi OS Lite (64-bit)**, hostname `hexapod`, SSH on
- [ ] You can log in to the Pi from the Mac: `ssh kangan@hexapod.local`
- [ ] Node.js installed on the Pi: `sudo apt install -y nodejs npm`
- [ ] The Xbox controller paired with the Pi (`bluetoothctl`, user manual section 6.3)
- [ ] The 3 wires connected between the Pi and the Servo 2040 (see the wiring schematic)

In the steps below, each command says **where** to type it:
🖥️ **Mac** (Terminal on your Mac) · 🍓 **Pi** (after logging in with `ssh`) · 🐍 **Thonny**

---

## One-time setup

### Step 1. Copy the repository to the Pi and install

🖥️ **Mac**, from the repository's folder (the one with `send-to-pi.sh`):

```sh
bash send-to-pi.sh --install          # add the Pi's address if hexapod.local is not found
```

This copies the whole repository to `~/hexapod-pi-zero` on the Pi over `scp` (you type the Pi's password once),
then runs `install.sh` there.

### Step 2. (By hand instead) Install it on the Pi

If you copied the repository yourself, 🍓 **Pi**:

```sh
cd ~/hexapod-pi-zero/software/pi-service
bash install.sh
```

`install.sh` sets up Node.js (it offers to install it), runs `deploy/install.sh`, sets up the offline hotspot
(`--no-wifi` skips it), and reboots (it asks first) or restarts the service once the motors are off.
`deploy/install.sh`:
- installs what the program needs
- switches on the Pi's serial port (the 3 wires to the Servo 2040)
- switches off the Pi's login prompt on that port, which would otherwise send text to the Servo 2040
- sets the program to start every time the Pi powers on

### Step 3. Update the Servo 2040

🖥️ **Mac** (or any Linux computer), with the Servo 2040 plugged in by USB-C, the robot's power off and Thonny closed:

```sh
bash software/flash-board.sh     # from the repository folder; --dry-run shows the steps first
```

It backs up the board's files to `software/board-backups/`, copies the four files, checks them and restarts the
board. It needs `mpremote` and offers to install it. Or do it by hand:

🐍 **Thonny**, with the Servo 2040 plugged into the Mac by USB-C and the robot's power off:

1. Copy the 4 files from the **`software/board-files`** folder onto the board:
   `main.py`, `motion_bridge.py`, `FUNCTIONS.py`, `calibration_store.py`.
   **Do not delete** `calibration_offsets.json` or `joint_limits.json` on the board.
2. Open `check_and_restart.py` and click **Run**.
3. Close Thonny.

### Step 4. Test the wires

Support the robot's body, then switch its power on.

🍓 **Pi**:

```sh
cd ~/hexapod-pi-zero/software/pi-service
sudo systemctl stop hexapod-drive
npm run link-test
```

You should see **`OK  The Servo 2040 answered.`** This test never switches the motors on.
If it says **FAIL**, see [Problems](#problems) below.

### Step 5. Teach it your controller's buttons

Linux numbers the Xbox controller's buttons differently depending on the controller model.
This step tells the program which button is which. You only do it once per controller.

🍓 **Pi**:

```sh
npm run controller-setup
```

Follow the prompts on screen ("Press A", "Push the left stick right"...). Then check it:

```sh
npm run controller-test
```

Move the sticks and press buttons: the screen should show the right names. Press **Ctrl+C** to quit.

### Step 6. Start driving

🍓 **Pi**:

```sh
sudo systemctl start hexapod-drive
```

From now on it starts by itself whenever the Pi powers on.

---

## Everyday use

1. Turn on the robot's main power switch. Wait about 1 minute for the Pi to start.
2. Turn on the Xbox controller (hold the Xbox button).
3. Press **A** to switch the motors on, then **Y** to stand.
4. Drive with the sticks.

| Button | What it does |
|---|---|
| **Left stick** | Walk (forward, back, sideways) |
| **Right stick** | Turn |
| **Let go of both sticks** | Stop walking |
| **A** | Motors on |
| **Y** / **X** | Stand / Sit |
| **B** | Stop walking gently |
| **View** (two squares) | **Emergency stop**: all motors off at once (the robot drops) |
| **D-pad up / down** | Faster / slower |
| **RB / LB** | Higher / lower steps |
| **D-pad right / left** | Longer / shorter strides |

**To switch off:** let go of the sticks, press **X** (sit), press **View**, then
🖥️ **Mac**: `ssh -t kangan@hexapod.local sudo shutdown -h now`.
Wait 10 seconds, then turn off the main power switch.

---

## Safety

- **View** switches all motors off. The **main power switch** cuts everything. Keep it within reach.
- If the controller turns off, its battery runs flat, or it goes out of range, the robot stops walking.
- If the Pi crashes or the program stops, the Servo 2040 switches the motors off after 3 seconds.
- Start with slow speed and small steps.

---

## Problems

| What you see | What to do |
|---|---|
| `link-test` says **FAIL** | Check the wires: Pi pin 8 → Servo SCL, Pi pin 10 → Servo SDA, and GND connected. Check you did Step 3, and that you rebooted after Step 2. |
| Buttons do the wrong thing | Run Step 5 again (`npm run controller-setup`). |
| Nothing happens when you press A | Check the controller is connected (its light stays on, not flashing). Check the program is running: `systemctl status hexapod-drive` |
| The motors switch off by themselves | The Pi stopped talking to the Servo 2040. Check the wires and the Pi's power. |
| The Pi keeps restarting | Its power supply is too weak. Use the separate 5 V, 2 A supply, plugged into **PWR IN**. |

To see what the program is doing, 🍓 **Pi**: `journalctl -u hexapod-drive -f` (Ctrl+C to stop).

---

## Command reference

🍓 All of these run on the **Pi**, inside `~/hexapod-pi-zero/software/pi-service`:

**Updating later.** 🖥️ **Mac**: `bash send-to-pi.sh` (or `npm run deploy`). It copies the repository, installs new
dependencies only if `package.json` changed, and restarts once the motors are off. On the Pi by hand: `bash install.sh --update`.


| Command | What it does |
|---|---|
| `sudo systemctl start hexapod-drive` | Start the program |
| `sudo systemctl stop hexapod-drive` | Stop the program (do this before the tests below) |
| `sudo systemctl status hexapod-drive` | Is it running? |
| `journalctl -u hexapod-drive -f` | Watch what it is doing |
| `npm run link-test` | Test the wires to the Servo 2040 |
| `npm run controller-setup` | Teach it your controller's buttons |
| `npm run controller-test` | See what the controller is sending |

---

## For developers

<details>
<summary>Settings, folder layout and tests</summary>

**Settings.** Change with `sudo systemctl edit hexapod-drive`, adding lines under `[Service]`
such as `Environment=HEXAPOD_SERIAL=/dev/ttyACM0`.

| Variable | Default | Use |
|---|---|---|
| `HEXAPOD_SERIAL` | `/dev/serial0` | The serial port. `/dev/ttyACM0` uses the Servo 2040's USB instead of the 3 wires. |
| `HEXAPOD_JOYSTICK` | `/dev/input/js0` | The controller |
| `HEXAPOD_MAP` | `controller-map.json` | Made by `npm run controller-setup` |

**Folders.**

| Path | Contents |
|---|---|
| `src/` | The program: `main.js` (start here), the serial link, the controller reader, the drive loop |
| `tools/` | `link-test`, `controller-setup`, `controller-test` |
| `deploy/` | `install.sh` and the system service file |
| `vendor/` | Shared code copied from the Motion Trainer project. **Do not edit here.** |
| `tests/` | Automated tests |

**Shared code.** `vendor/` and `../board-files/` are copies from the Motion Trainer project.
Change them there, then 🖥️ **Mac**: `npm run sync`. `vendor/SOURCE.txt` shows which version was copied.

**Tests.** 🖥️ **Mac**: `npm test` (19 tests, using a simulated robot).

</details>
