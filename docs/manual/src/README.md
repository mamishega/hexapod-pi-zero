# User manual source

The Word manual and the web manual are both built from **content.js**, so they always match.
Edit content.js (and the revision table and date in it), then rebuild:

```sh
npm install        # once: installs the docx library
npm run build      # writes ../web-manual/index.html and ../user-manual.docx
```

The build uses the wiring schematic in `../../wiring/` (PNG for Word, SVG for the web manual),
so rebuild the schematic first if it has changed.

Close `user-manual.docx` in Word before rebuilding. When Word opens the new file it asks
to update fields: choose **Yes** to fill in the table of contents page numbers.
