# WenQuanYi Bitmap Song 14px provenance

The source `WenQuanYi-Bitmap-Song-14px.ttf` is an unmodified copy from:

- Repository: https://github.com/AmusementClub/WenQuanYi-Bitmap-Song-TTF
- Commit: `7724da71817090ba92e76d9d40e3dd43afef25de`
- TTF SHA-256: `1da8cb17abb4fd34d4cfc83be7e16baeb49f3822f9236499d29cd9ca7a4f68f6`

The corresponding source bitmap is included at
`source/wenquanyi_13px.pcf`:

- PCF SHA-256: `4fdd52dd970801b0989ce1c30a894455af25be8230fda06b49930233b4ce71df`

`CONVERSION.md` records the upstream PCF-to-TTF conversion process.
`SOURCE-README.txt`, `AUTHORS.txt`, and `LICENSE-GPL-2.0.txt` preserve
the upstream copyright, author, and licensing information.

RunBeat derives two web fonts from this TTF:

- `src/assets/fonts/runbeat-bitmap-ui-core.woff2` contains ASCII and every
  non-ASCII character authored in the production UI source.
  SHA-256: `2cda15d5a94c179855ce0add1fdb12b97721669d1747c90164ec188722ecb162`.
- `src/assets/fonts/wenquanyi-bitmap-song-14px-full.woff2` retains the full
  glyph repertoire as a lazy fallback for user-provided project and track names.
  SHA-256: `a7f291906c6746ba6585130357a89ae946e22d9e2595302c12d0329bb130997d`.

Install FontTools with WOFF support and run `npm run build:fonts` to regenerate
both files. The command prints their byte sizes and SHA-256 hashes.
