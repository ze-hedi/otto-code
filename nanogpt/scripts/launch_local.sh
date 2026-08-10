#!/usr/bin/env bash
# Single-GPU smoke launch. Usage: bash scripts/launch_local.sh [config]
set -euo pipefail
CONFIG="${1:-configs/shakespeare_char.yaml}"
cd "$(dirname "$0")/.."
python src/train.py --config "$CONFIG" "${@:2}"
