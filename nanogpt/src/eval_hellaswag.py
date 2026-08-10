"""HellaSwag eval. For each (context, [endings...]) example, compute the
mean per-token cross-entropy of each candidate continuation and choose
the lowest. Reports top-1 accuracy.

Used both as a standalone CLI and as a hook called periodically from
train.py.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Iterable

import requests
import torch
import torch.nn.functional as F

from model import GPT, GPTConfig
from utils import load_checkpoint

HELLA_URLS = {
    "val":   "https://raw.githubusercontent.com/rowanz/hellaswag/master/data/hellaswag_val.jsonl",
    "train": "https://raw.githubusercontent.com/rowanz/hellaswag/master/data/hellaswag_train.jsonl",
}


def download_split(split: str, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"hellaswag_{split}.jsonl"
    if path.exists():
        return path
    print(f"downloading {HELLA_URLS[split]}")
    path.write_text(requests.get(HELLA_URLS[split], timeout=120).text)
    return path


def render_example(example: dict, enc) -> tuple[torch.Tensor, torch.Tensor, int]:
    """Build (B=4, T) token + mask tensors and the gold label.

    Mask is 1 on the candidate-ending tokens only; loss outside the mask
    is ignored. Per-row T is padded to the longest candidate sequence.
    """
    ctx = example["ctx"]
    label = int(example["label"])
    endings = example["endings"]
    ctx_ids = enc.encode(ctx)
    rows, masks = [], []
    for end in endings:
        end_ids = enc.encode(" " + end)
        ids = ctx_ids + end_ids
        m = [0] * len(ctx_ids) + [1] * len(end_ids)
        rows.append(ids)
        masks.append(m)
    T = max(len(r) for r in rows)
    tok = torch.zeros(4, T, dtype=torch.long)
    mask = torch.zeros(4, T, dtype=torch.long)
    for i, (r, m) in enumerate(zip(rows, masks)):
        tok[i, :len(r)] = torch.tensor(r, dtype=torch.long)
        mask[i, :len(m)] = torch.tensor(m, dtype=torch.long)
    return tok, mask, label


@torch.no_grad()
def score_example(model: torch.nn.Module, tok: torch.Tensor, mask: torch.Tensor,
                  device: str) -> int:
    tok = tok.to(device)
    mask = mask.to(device)
    logits, _ = model(tok)
    shift_logits = logits[:, :-1, :].contiguous()
    shift_targets = tok[:, 1:].contiguous()
    shift_mask = mask[:, 1:].contiguous().float()

    ce = F.cross_entropy(
        shift_logits.view(-1, shift_logits.size(-1)),
        shift_targets.view(-1),
        reduction="none",
    ).view(shift_targets.size())

    # Mean per-token loss on the ending segment only.
    mean_loss = (ce * shift_mask).sum(dim=1) / shift_mask.sum(dim=1).clamp(min=1)
    return int(mean_loss.argmin().item())


def iter_examples(path: Path) -> Iterable[dict]:
    with path.open() as f:
        for line in f:
            yield json.loads(line)


@torch.no_grad()
def evaluate(model: torch.nn.Module, device: str, *,
             split: str = "val",
             data_dir: Path | None = None,
             limit: int | None = None) -> float:
    import tiktoken
    enc = tiktoken.get_encoding("gpt2")
    data_dir = data_dir or Path(os.environ.get("DATA_DIR", "./data")) / "hellaswag"
    path = download_split(split, data_dir)

    n, n_correct = 0, 0
    for ex in iter_examples(path):
        tok, mask, label = render_example(ex, enc)
        pred = score_example(model, tok, mask, device)
        n_correct += int(pred == label)
        n += 1
        if limit is not None and n >= limit:
            break
    return n_correct / max(n, 1)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt", type=str)
    p.add_argument("--pretrained", type=str, default=None)
    p.add_argument("--split", type=str, default="val")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    args = p.parse_args()

    if args.pretrained:
        model = GPT.from_pretrained(args.pretrained)
    else:
        ck = load_checkpoint(args.ckpt, map_location="cpu")
        cfg = GPTConfig(
            block_size=ck["config"]["batch"]["seq_len"],
            vocab_size=ck["config"]["model"]["vocab_size"],
            n_layer=ck["config"]["model"]["n_layer"],
            n_head=ck["config"]["model"]["n_head"],
            n_embd=ck["config"]["model"]["n_embd"],
            dropout=0.0,
            bias=ck["config"]["model"]["bias"],
        )
        model = GPT(cfg)
        sd = {k.removeprefix("_orig_mod."): v for k, v in ck["model"].items()}
        model.load_state_dict(sd)
    model.to(args.device).eval()
    acc = evaluate(model, args.device, split=args.split, limit=args.limit)
    print(f"hellaswag/{args.split} top-1 = {acc:.4f}")


if __name__ == "__main__":
    main()
