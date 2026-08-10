#!/usr/bin/env bash
# Single-node multi-GPU DDP via torchrun.
# Usage: bash scripts/launch_ddp.sh [config] [nproc_per_node]
set -euo pipefail
CONFIG="${1:-configs/gpt2_124M.yaml}"
NPROC="${2:-8}"
cd "$(dirname "$0")/.."
torchrun --standalone --nproc_per_node="${NPROC}" src/train.py \
    --config "${CONFIG}" "${@:3}"
