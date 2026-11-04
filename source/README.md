# User manual source

The Word manual and the web manual are both built from **content.js**, so they always match.
Edit content.js (and the revision table and date in it), then rebuild:

```sh
npm install        # once: installs the docx library
npm run build      # writes ../Web Manual/index.html and ../User Manual.docx
```

Close `User Manual.docx` in Word before rebuilding. When Word opens the new file it asks
to update fields: choose **Yes** to fill in the table of contents page numbers.
