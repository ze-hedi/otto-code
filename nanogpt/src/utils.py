"""Distributed init, checkpoint I/O, JSONL logging."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
import torch.distributed as dist


@dataclass
class DistInfo:
    rank: int
    local_rank: int
    world_size: int
    is_ddp: bool
    is_main: bool
    device: str


def init_distributed() -> DistInfo:
    if int(os.environ.get("WORLD_SIZE", "1")) > 1:
        dist.init_process_group(backend="nccl")
        rank = int(os.environ["RANK"])
        local_rank = int(os.environ["LOCAL_RANK"])
        world_size = int(os.environ["WORLD_SIZE"])
        torch.cuda.set_device(local_rank)
        device = f"cuda:{local_rank}"
        return DistInfo(rank, local_rank, world_size, True, rank == 0, device)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return DistInfo(0, 0, 1, False, True, device)


def cleanup_distributed(info: DistInfo) -> None:
    if info.is_ddp and dist.is_initialized():
        dist.destroy_process_group()


class JsonlLogger:
    def __init__(self, path: str | Path, enabled: bool = True) -> None:
        self.path = Path(path)
        self.enabled = enabled
        if enabled:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._f = self.path.open("a", buffering=1)
        else:
            self._f = None

    def log(self, **fields: Any) -> None:
        if not self.enabled or self._f is None:
            return
        fields.setdefault("ts", time.time())
        self._f.write(json.dumps(fields) + "\n")

    def close(self) -> None:
        if self._f is not None:
            self._f.close()
            self._f = None


def save_checkpoint(
    path: str | Path,
    model: torch.nn.Module,
    optimizer: torch.optim.Optimizer,
    step: int,
    config: dict[str, Any],
    extra: dict[str, Any] | None = None,
) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = model.module if hasattr(model, "module") else model
    payload = {
        "model": raw.state_dict(),
        "optim": optimizer.state_dict(),
        "step": step,
        "config": config,
    }
    if extra:
        payload.update(extra)
    tmp = path.with_suffix(path.suffix + ".tmp")
    torch.save(payload, tmp)
    tmp.replace(path)


def load_checkpoint(path: str | Path, map_location: str = "cpu") -> dict[str, Any]:
    return torch.load(path, map_location=map_location, weights_only=False)
