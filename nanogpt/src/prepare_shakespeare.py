"""Download Tiny Shakespeare and char-tokenize into train.bin / val.bin.

Output: $DATA_DIR/shakespeare_char/{train,val}.bin (uint16) and meta.pkl.
"""

from __future__ import annotations

import argparse
import os
import pickle
from pathlib import Path

import numpy as np
import requests

URL = "https://raw.githubusercontent.com/karpathy/char-rnn/master/data/tinyshakespeare/input.txt"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=str,
                   default=os.environ.get("DATA_DIR", "./data") + "/shakespeare_char")
    p.add_argument("--val-frac", type=float, default=0.1)
    args = p.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    raw = out / "input.txt"
    if not raw.exists():
        print(f"downloading {URL}")
        raw.write_text(requests.get(URL, timeout=60).text)
    text = raw.read_text()

    chars = sorted(set(text))
    vocab_size = len(chars)
    print(f"vocab size: {vocab_size}; corpus chars: {len(text):,}")
    stoi = {c: i for i, c in enumerate(chars)}
    itos = {i: c for i, c in enumerate(chars)}

    data = np.array([stoi[c] for c in text], dtype=np.uint16)
    n_val = int(len(data) * args.val_frac)
    val = data[-n_val:]
    train = data[:-n_val]
    train.tofile(out / "train.bin")
    val.tofile(out / "val.bin")
    with (out / "meta.pkl").open("wb") as f:
        pickle.dump({"vocab_size": vocab_size, "stoi": stoi, "itos": itos}, f)
    print(f"wrote {out}/train.bin ({len(train):,}) and val.bin ({len(val):,})")


if __name__ == "__main__":
    main()
