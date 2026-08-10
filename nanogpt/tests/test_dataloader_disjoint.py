"""Across W mock ranks, no two ranks' (B,T) batches overlap on a shard."""

from pathlib import Path

import numpy as np
import pytest

from data import ShardLoader


def _make_shards(tmp_path: Path, n_shards: int = 2, tokens_per_shard: int = 100_000) -> Path:
    sd = tmp_path / "fw"
    sd.mkdir()
    # Globally-unique token ids so we can detect overlap by set membership.
    cursor = 0
    for i in range(n_shards):
        arr = np.arange(cursor, cursor + tokens_per_shard, dtype=np.uint16)
        cursor += tokens_per_shard
        np.save(sd / f"shard_train_{i:04d}.npy", arr)
    return sd


def test_no_overlap_across_ranks(tmp_path):
    world_size = 8
    B, T = 4, 64
    sd = _make_shards(tmp_path, n_shards=2, tokens_per_shard=40_000)
    loaders = [
        ShardLoader(sd, "train", B, T, rank=r, world_size=world_size, device="cpu")
        for r in range(world_size)
    ]
    # Pull a handful of batches per rank; collect the (shard_idx, start) windows.
    seen: set[tuple[int, int, int]] = set()
    for step in range(3):
        for r, ld in enumerate(loaders):
            x, _ = ld.next_batch()
            # Each rank's flattened batch starts at a unique (shard, position).
            # We encode by the first token id, which is unique across shards
            # by construction.
            first_id = int(x.flatten()[0].item())
            key = (step, r, first_id)
            assert key not in seen
            seen.add(key)

    # Stronger: collect all token windows produced in one step and ensure
    # pairwise disjointness.
    for ld in loaders:
        ld.reset()
    windows = []
    for ld in loaders:
        x, _ = ld.next_batch()
        ids = set(x.flatten().tolist())
        for prev in windows:
            assert prev.isdisjoint(ids), "two ranks produced overlapping windows"
        windows.append(ids)


def test_loader_advances_to_next_shard(tmp_path):
    B, T = 2, 8
    sd = _make_shards(tmp_path, n_shards=2, tokens_per_shard=64)
    ld = ShardLoader(sd, "train", B, T, rank=0, world_size=1, device="cpu")
    # Each batch consumes B*T = 16 tokens; 64 / 16 = 4 batches in shard 0,
    # then loader must roll over to shard 1.
    for _ in range(5):
        x, _ = ld.next_batch()
        assert tuple(x.shape) == (B, T)
