# Vendored audio sources

The reproducible Rubber Band WASM build expects the official Rubber Band
Library source at `vendor/rubberband`, pinned to tag `v4.0.0`.

```bash
git clone --depth 1 --branch v4.0.0 \
  https://github.com/breakfastquay/rubberband vendor/rubberband
npm run build:rubberband
```

Alternatively set `RUBBERBAND_SOURCE_DIR` to an existing checkout. Rubber Band
is GPL-2.0-or-later; retain its `COPYING` file and source when distributing the
WASM binary.
