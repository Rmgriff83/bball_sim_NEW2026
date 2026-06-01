#!/bin/bash
# Wrapper that activates the local venv and sets DYLD_FALLBACK_LIBRARY_PATH so
# cairocffi can find the Homebrew-installed libcairo.2.dylib on Apple Silicon
# (where /opt/homebrew/lib isn't in Python's default ctypes search path).
#
# Usage from this directory:
#   ./run_headshot_generator.sh -n 100
#   ./run_headshot_generator.sh -n 50 --headband-chance 0.5
#   ./run_headshot_generator.sh --help

set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
export DYLD_FALLBACK_LIBRARY_PATH="/opt/homebrew/lib:${DYLD_FALLBACK_LIBRARY_PATH}"
exec "${SCRIPT_DIR}/.headshot-venv/bin/python" "${SCRIPT_DIR}/generate_headshots.py" "$@"
