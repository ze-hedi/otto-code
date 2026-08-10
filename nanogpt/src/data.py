"""Rank-aware sequential shard loader for FineWeb-Edu tokens.

Each rank reads non-overlapping windows within a shared shard, advancing
to the next shard when exhausted. Sequential reads give us the best
locality on memory-mapped numpy files; randomness comes from the
arbitrary FineWeb document ordering plus per-rank offset.
"""

from __future__ import annotations

import glob
from pathlib import Path

import numpy as np
import torch


class ShardLoader:
    def __init__(
        self,
        shard_dir: str | Path,
        split: str,
        batch_size: int,
        seq_len: int,
        rank: int,
        world_size: int,
        device: str,
    ):
        self.batch_size = batch_size
        self.seq_len = seq_len
        self.rank = rank
        self.world_size = world_size
        self.device = device
        pattern = str(Path(shard_dir) / f"shard_{split}_*.npy")
        self.shards = sorted(glob.glob(pattern))
        if not self.shards:
            raise FileNotFoundError(f"no shards matched {pattern}")
        self.reset()

    def reset(self) -> None:
        self._shard_i = 0
        self._tokens = np.load(self.shards[0], mmap_mode="r")
        # Each rank starts at a different offset within the shard.
        self._pos = self.rank * self.batch_size * self.seq_len

    def _advance_shard(self) -> None:
        self._shard_i = (self._shard_i + 1) % len(self.shards)
        self._tokens = np.load(self.shards[self._shard_i], mmap_mode="r")
        self._pos = self.rank * self.batch_size * self.seq_len

    def next_batch(self) -> tuple[torch.Tensor, torch.Tensor]:
        B, T = self.batch_size, self.seq_len
        chunk = B * T
        # Need chunk+1 contiguous tokens (last one is the target shift).
        if self._pos + chunk + 1 > len(self._tokens):
            self._advance_shard()
        end = self._pos + chunk
        buf = np.asarray(self._tokens[self._pos:end + 1], dtype=np.int64)
        x = torch.from_numpy(buf[:-1].reshape(B, T))
        y = torch.from_numpy(buf[1:].reshape(B, T))
        # Stride forward across all ranks so windows do not overlap.
        self._pos += chunk * self.world_size
        return x.to(self.device, non_blocking=True), y.to(self.device, non_blocking=True)
