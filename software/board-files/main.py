"""Raspberry Pi version startup: commands over USB and over the Pi's UART link.
Boots with all servo outputs disabled."""
import motion_bridge

if __name__ == '__main__':
    motion_bridge.run(uart=True)
