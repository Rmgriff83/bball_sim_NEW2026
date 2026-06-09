#!/bin/bash
# Wrapper that activates the local venv and sets DYLD_FALLBACK_LIBRARY_PATH so
# cairocffi can find the Homebrew-installed libcairo.2.dylib on Apple Silicon
# (where /opt/homebrew/lib isn't in Python's default ctypes search path).
#
# Usage from anywhere:
#   ./frontend/src/assets/run_headshot_generator.sh -n 100
#   ./frontend/src/assets/run_headshot_generator.sh -n 50 --headband-chance 0.5
#   ./frontend/src/assets/run_headshot_generator.sh --help
#
# The generator's default --out value is `headshots` (cwd-relative), so this
# wrapper cd's into its own directory before invoking python. That makes the
# wrapper safe to call from `npm run` (cwd=frontend/) or any other location —
# output always lands at frontend/src/assets/headshots/ unless --out is
# explicitly overridden.

set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"
export DYLD_FALLBACK_LIBRARY_PATH="/opt/homebrew/lib:${DYLD_FALLBACK_LIBRARY_PATH}"
exec "${SCRIPT_DIR}/.headshot-venv/bin/python" "${SCRIPT_DIR}/generate_headshots.py" "$@"
