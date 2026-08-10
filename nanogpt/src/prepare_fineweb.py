"""Tokenize the FineWeb-Edu sample-10BT split into uint16 shards.

Output: $DATA_DIR/fineweb_edu/shard_train_{NNNN}.npy and one
shard_val_{0000}.npy, each ~100M tokens. The training loader streams
them in rank-aware fashion (see src/data.py).
"""

from __future__ import annotations

import argparse
import multiprocessing as mp
import os
from pathlib import Path

import numpy as np
from tqdm import tqdm

SHARD_TOKENS = 100_000_000   # ~100M tokens per shard
EOT = 50256                  # GPT-2 BPE end-of-text marker


def _tokenize(doc: dict, enc) -> np.ndarray:
    ids = [EOT]
    ids.extend(enc.encode_ordinary(doc["text"]))
    arr = np.array(ids, dtype=np.uint32)
    assert arr.max() < 2 ** 16, "token id overflows uint16; check tokenizer"
    return arr.astype(np.uint16)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=str,
                   default=os.environ.get("DATA_DIR", "./data") + "/fineweb_edu")
    p.add_argument("--shards", type=int, default=100,
                   help="total shards to produce (1 reserved for val)")
    p.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    args = p.parse_args()

    import tiktoken
    from datasets import load_dataset

    enc = tiktoken.get_encoding("gpt2")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    ds = load_dataset("HuggingFaceFW/fineweb-edu", name="sample-10BT", split="train",
                      streaming=False)

    def gen():
        for doc in ds:
            yield doc

    shard_idx = 0
    buf = np.empty(SHARD_TOKENS, dtype=np.uint16)
    filled = 0
    pbar = tqdm(total=SHARD_TOKENS, unit="tok", desc=f"shard {shard_idx:04d}")

    with mp.Pool(args.workers) as pool:
        it = pool.imap(lambda d: _tokenize(d, enc), gen(), chunksize=16)
        for toks in it:
            n = len(toks)
            if filled + n < SHARD_TOKENS:
                buf[filled:filled + n] = toks
                filled += n
                pbar.update(n)
                continue
            # spill the prefix that fits into the current shard
            take = SHARD_TOKENS - filled
            buf[filled:] = toks[:take]
            split = "val" if shard_idx == 0 else "train"
            path = out / f"shard_{split}_{shard_idx:04d}.npy"
            np.save(path, buf)
            pbar.close()
            shard_idx += 1
            if shard_idx >= args.shards:
                return
            filled = n - take
            buf[:filled] = toks[take:]
            pbar = tqdm(total=SHARD_TOKENS, unit="tok", desc=f"shard {shard_idx:04d}")
            pbar.update(filled)

    # Flush trailing partial shard
    if filled > 0 and shard_idx < args.shards:
        split = "val" if shard_idx == 0 else "train"
        np.save(out / f"shard_{split}_{shard_idx:04d}.npy", buf[:filled])
        pbar.close()


if __name__ == "__main__":
    main()
