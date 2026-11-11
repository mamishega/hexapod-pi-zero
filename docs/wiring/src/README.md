# Wiring schematic source

```sh
python3 make_schematic.py ..                   # writes ../wiring-schematic.svg and ../schematic.html
node make_circuit_studio.mjs ../circuit-studio # Circuit Studio project, share link and shortcuts
```

Make the PNG and the A3 PDF from `../schematic.html` (open it in a browser and print, landscape A3).
`schematic.html` is only a helper for that and is not kept in the repository.
After changing the schematic, rebuild the manual (`docs/manual/src`), which includes it.
