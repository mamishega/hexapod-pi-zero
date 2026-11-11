"""Run in Thonny after uploading the four board files to the board root (Pi version)."""
import os
import machine
for name in ('main.py', 'FUNCTIONS.py', 'calibration_store.py', 'motion_bridge.py'):
    os.stat(name)
import motion_bridge
controller = motion_bridge.Controller()
print('Bridge ready (USB + Raspberry Pi UART):', controller.state(True)['protocol'])
print('Close Thonny; the board restarts and waits for the Pi.')
machine.reset()
