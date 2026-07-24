#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${RUBBERBAND_SOURCE_DIR:-${project_root}/vendor/rubberband}"
output_dir="${project_root}/public/wasm"

if command -v em++ >/dev/null 2>&1; then
  emxx_binary="$(command -v em++)"
elif [[ -x /usr/lib/emscripten/em++ ]]; then
  emxx_binary="/usr/lib/emscripten/em++"
else
  echo "Emscripten em++ is required. Activate an emsdk environment first." >&2
  exit 1
fi

emscripten_cache="${EM_CACHE:-${project_root}/node_modules/.cache/emscripten}"
mkdir -p "${emscripten_cache}"
export EM_CACHE="${emscripten_cache}"

if [[ ! -f "${source_dir}/single/RubberBandSingle.cpp" ]]; then
  echo "Rubber Band v4.0.0 source is missing at ${source_dir}." >&2
  echo "Clone https://github.com/breakfastquay/rubberband at tag v4.0.0 or set RUBBERBAND_SOURCE_DIR." >&2
  exit 1
fi

mkdir -p "${output_dir}"

"${emxx_binary}" \
  -std=c++17 -O3 -flto \
  -DNO_THREADING -DUSE_BUILTIN_FFT -DUSE_BQRESAMPLER \
  -I"${source_dir}" \
  "${project_root}/wasm/rubberband_adapter.cpp" \
  "${source_dir}/single/RubberBandSingle.cpp" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MAXIMUM_MEMORY=2147483648 \
  -s FILESYSTEM=0 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_runbeat_rb_create","_runbeat_rb_destroy","_runbeat_rb_study","_runbeat_rb_process","_runbeat_rb_available","_runbeat_rb_retrieve"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]' \
  -o "${output_dir}/rubberband.js"

echo "Built ${output_dir}/rubberband.js and rubberband.wasm"
