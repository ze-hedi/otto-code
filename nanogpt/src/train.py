"""Training entrypoint.

Builds up through Karpathy's optimization stack:
  4.1 TF32      4.5 vocab pad to 128
  4.2 bf16      4.6 fused AdamW
  4.3 compile   4.7 grad accumulation -> 0.5M tokens/step
  4.4 flash     4.8 DDP single-node multi-GPU

Run single-GPU:
    python src/train.py --config configs/shakespeare_char.yaml

Run 8-GPU DDP:
    torchrun --standalone --nproc_per_node=8 src/train.py \\
        --config configs/gpt2_124M.yaml
"""

from __future__ import annotations

import argparse
import math
import os
import pickle
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.distributed as dist
import yaml
from torch.nn.parallel import DistributedDataParallel as DDP

from data import ShardLoader
from eval_hellaswag import evaluate as eval_hellaswag
from model import GPT, GPTConfig
from utils import (
    DistInfo,
    JsonlLogger,
    cleanup_distributed,
    init_distributed,
    load_checkpoint,
    save_checkpoint,
)


def configure_optimizer(model: torch.nn.Module, *, lr: float, betas: tuple[float, float],
                        weight_decay: float, fused: bool) -> torch.optim.AdamW:
    """AdamW with two param groups: decay on 2D+ tensors, no decay on the rest.

    Matches GPT-3 / GPT-2 reproduction practice: only matmuls/embeddings get
    weight decay; LayerNorm gain/bias and any nn.Linear bias have decay 0.
    """
    decay, no_decay = [], []
    for _, p in model.named_parameters():
        if not p.requires_grad:
            continue
        if p.dim() >= 2:
            decay.append(p)
        else:
            no_decay.append(p)
    groups = [
        {"params": decay, "weight_decay": weight_decay},
        {"params": no_decay, "weight_decay": 0.0},
    ]
    return torch.optim.AdamW(groups, lr=lr, betas=betas, fused=fused)


def lr_at(step: int, cfg: dict) -> float:
    warmup = cfg["warmup_steps"]
    max_steps = cfg["max_steps"]
    lr, min_lr = cfg["lr"], cfg["min_lr"]
    if step < warmup:
        return lr * (step + 1) / max(1, warmup)
    if step >= max_steps:
        return min_lr
    decay = (step - warmup) / max(1, max_steps - warmup)
    coeff = 0.5 * (1.0 + math.cos(math.pi * decay))
    return min_lr + coeff * (lr - min_lr)


class BinDataset:
    """Memory-mapped uint16 .bin reader. Each DDP rank seeds independently."""

    def __init__(self, path: str | Path, seq_len: int, batch_size: int,
                 device: str, seed: int):
        self.data = np.memmap(path, dtype=np.uint16, mode="r")
        self.seq_len = seq_len
        self.batch_size = batch_size
        self.device = device
        self.rng = np.random.default_rng(seed)

    def get_batch(self) -> tuple[torch.Tensor, torch.Tensor]:
        ix = self.rng.integers(0, len(self.data) - self.seq_len - 1, size=self.batch_size)
        x = np.stack([self.data[i:i + self.seq_len].astype(np.int64) for i in ix])
        y = np.stack([self.data[i + 1:i + 1 + self.seq_len].astype(np.int64) for i in ix])
        x = torch.from_numpy(x).to(self.device, non_blocking=True)
        y = torch.from_numpy(y).to(self.device, non_blocking=True)
        return x, y


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--config", type=str, required=True)
    p.add_argument("--data-dir", type=str, default=os.environ.get("DATA_DIR", "./data"))
    p.add_argument("--out-dir", type=str, default=os.environ.get("OUT_DIR", "./out"))
    p.add_argument("--dry-run", action="store_true",
                   help="run 2 steps and exit (smoke test)")
    p.add_argument("--resume", action="store_true",
                   help="resume from $OUT_DIR/ckpt.pt if present")
    p.add_argument("--wandb", action="store_true",
                   help="also log to Weights & Biases (requires wandb installed)")
    p.add_argument("--wandb-project", type=str, default="nanogpt")
    p.add_argument("--wandb-run", type=str, default=None)
    p.add_argument("--seed", type=int, default=1337)
    args = p.parse_args()

    with open(args.config) as f:
        cfg = yaml.safe_load(f)

    # 4.8: DDP init. Single-process when not under torchrun.
    info = init_distributed()
    torch.manual_seed(args.seed + info.rank)
    np.random.seed(args.seed + info.rank)
    device = info.device

    # 4.1 TF32
    if cfg.get("runtime", {}).get("tf32", True):
        torch.set_float32_matmul_precision("high")

    # 4.4 SDPA backends
    if device.startswith("cuda"):
        try:
            torch.backends.cuda.enable_flash_sdp(True)
            torch.backends.cuda.enable_mem_efficient_sdp(True)
            torch.backends.cuda.enable_math_sdp(True)
        except AttributeError:
            pass

    # ---- Data ----
    data_kind = cfg.get("data", {}).get("kind", "fineweb_edu")
    if data_kind == "shakespeare_char":
        ddir = Path(args.data_dir) / "shakespeare_char"
        with (ddir / "meta.pkl").open("rb") as f:
            meta = pickle.load(f)
        cfg["model"]["vocab_size"] = max(cfg["model"]["vocab_size"], meta["vocab_size"])
        seed_t = args.seed * 2 + info.rank
        seed_v = args.seed * 2 + 1 + info.rank
        train_ds = BinDataset(ddir / "train.bin", cfg["batch"]["seq_len"],
                              cfg["batch"]["micro_batch_size"], device, seed_t)
        val_ds = BinDataset(ddir / "val.bin", cfg["batch"]["seq_len"],
                            cfg["batch"]["micro_batch_size"], device, seed_v)
        ckpt_meta = {"tokenizer": "char", "stoi": meta["stoi"], "itos": meta["itos"]}
        get_train_batch = train_ds.get_batch
        get_val_batch = val_ds.get_batch
    elif data_kind == "fineweb_edu":
        ddir = Path(args.data_dir) / "fineweb_edu"
        train_loader = ShardLoader(ddir, "train",
                                   cfg["batch"]["micro_batch_size"],
                                   cfg["batch"]["seq_len"],
                                   info.rank, info.world_size, device)
        val_loader = ShardLoader(ddir, "val",
                                 cfg["batch"]["micro_batch_size"],
                                 cfg["batch"]["seq_len"],
                                 info.rank, info.world_size, device)
        ckpt_meta = {"tokenizer": "gpt2"}
        get_train_batch = train_loader.next_batch
        get_val_batch = val_loader.next_batch
    else:
        sys.exit(f"unknown data.kind: {data_kind}")

    # ---- Model ----
    gptcfg = GPTConfig(
        block_size=cfg["batch"]["seq_len"],
        vocab_size=cfg["model"]["vocab_size"],
        n_layer=cfg["model"]["n_layer"],
        n_head=cfg["model"]["n_head"],
        n_embd=cfg["model"]["n_embd"],
        dropout=cfg["model"]["dropout"],
        bias=cfg["model"]["bias"],
    )
    # 4.5 vocab pad
    pad = 128
    if gptcfg.vocab_size % pad != 0:
        new_vs = ((gptcfg.vocab_size + pad - 1) // pad) * pad
        if info.is_main:
            print(f"padding vocab_size {gptcfg.vocab_size} -> {new_vs}")
        gptcfg = GPTConfig(**{**gptcfg.__dict__, "vocab_size": new_vs})

    raw_model = GPT(gptcfg).to(device)
    if info.is_main:
        print(f"model: {raw_model.num_params():,} params (vocab_size={gptcfg.vocab_size})")

    # 4.3 compile
    if cfg.get("runtime", {}).get("compile", False) and device.startswith("cuda"):
        if info.is_main:
            print("compiling model ...")
        raw_model = torch.compile(raw_model)

    # 4.8 DDP wrap
    if info.is_ddp:
        model = DDP(raw_model, device_ids=[info.local_rank])
    else:
        model = raw_model

    # 4.6 fused AdamW + 5: decoupled weight-decay param groups.
    fused_ok = device.startswith("cuda")
    optim = configure_optimizer(
        raw_model,
        lr=cfg["optim"]["lr"],
        betas=tuple(cfg["optim"]["betas"]),
        weight_decay=cfg["optim"]["weight_decay"],
        fused=fused_ok,
    )

    # 5: resume from latest checkpoint if --resume points at one.
    start_step = 0
    resume_path = Path(args.out_dir) / "ckpt.pt"
    if args.resume and resume_path.exists():
        if info.is_main:
            print(f"resuming from {resume_path}")
        ckpt = load_checkpoint(resume_path, map_location=device)
        sd = {k.removeprefix("_orig_mod."): v for k, v in ckpt["model"].items()}
        raw_model.load_state_dict(sd)
        optim.load_state_dict(ckpt["optim"])
        start_step = int(ckpt["step"]) + 1

    out_dir = Path(args.out_dir)
    if info.is_main:
        out_dir.mkdir(parents=True, exist_ok=True)
    logger = JsonlLogger(Path("logs") / "train.jsonl", enabled=info.is_main)
    wb = None
    if args.wandb and info.is_main:
        import wandb  # type: ignore
        wb = wandb.init(project=args.wandb_project, name=args.wandb_run, config=cfg)

    max_steps = 2 if args.dry_run else cfg["optim"]["max_steps"]
    eval_interval = cfg["eval"]["eval_interval"]
    eval_iters = cfg["eval"]["eval_iters"]
    ckpt_interval = cfg["checkpoint"]["interval"]

    # 4.7 grad accumulation
    micro_tokens = cfg["batch"]["micro_batch_size"] * cfg["batch"]["seq_len"] * info.world_size
    target_tokens = cfg["batch"]["batch_tokens"]
    assert target_tokens % micro_tokens == 0, \
        f"batch_tokens {target_tokens} must divide cleanly into micro_tokens {micro_tokens}"
    grad_accum = target_tokens // micro_tokens
    if info.is_main:
        print(f"world_size={info.world_size}  grad_accum={grad_accum}  "
              f"tokens/step={target_tokens:,}")

    # 4.2 bf16 autocast
    dtype_name = cfg.get("runtime", {}).get("dtype", "float32")
    autocast_dtype = {"float32": None, "bfloat16": torch.bfloat16, "float16": torch.float16}[dtype_name]
    use_autocast = autocast_dtype is not None and device.startswith("cuda")

    t_prev = time.time()
    for step in range(start_step, max_steps):
        lr = lr_at(step, cfg["optim"])
        for g in optim.param_groups:
            g["lr"] = lr

        optim.zero_grad(set_to_none=True)
        loss_accum = 0.0
        for micro in range(grad_accum):
            x, y = get_train_batch()
            # 4.8 DDP: only sync on the last micro-step of the accumulation
            # window. Saves grad_accum-1 all-reduces per optim step.
            if info.is_ddp:
                model.require_backward_grad_sync = (micro == grad_accum - 1)
            if use_autocast:
                with torch.autocast(device_type="cuda", dtype=autocast_dtype):
                    _, loss = model(x, y)
            else:
                _, loss = model(x, y)
            loss = loss / grad_accum
            loss_accum += loss.detach()
            loss.backward()
        if info.is_ddp:
            dist.all_reduce(loss_accum, op=dist.ReduceOp.AVG)
        torch.nn.utils.clip_grad_norm_(raw_model.parameters(), cfg["optim"]["grad_clip"])
        optim.step()

        if (step % 10 == 0 or step == max_steps - 1) and info.is_main:
            now = time.time()
            tps = target_tokens * (step % 10 + 1) / max(now - t_prev, 1e-9)
            t_prev = now
            print(f"step {step:6d} | loss {float(loss_accum):.4f} | lr {lr:.2e} | toks/s {tps:,.0f}")
            logger.log(step=step, loss=float(loss_accum), lr=lr, toks_per_sec=tps)
            if wb is not None:
                wb.log({"step": step, "loss": float(loss_accum), "lr": lr,
                        "toks_per_sec": tps})

        if eval_interval and step > 0 and step % eval_interval == 0:
            model.eval()
            with torch.no_grad():
                losses = []
                for _ in range(eval_iters):
                    xv, yv = get_val_batch()
                    _, vloss = model(xv, yv)
                    losses.append(vloss.detach())
                v = torch.stack(losses).mean()
                if info.is_ddp:
                    dist.all_reduce(v, op=dist.ReduceOp.AVG)
            model.train()
            if info.is_main:
                print(f"  val loss: {float(v):.4f}")
                logger.log(step=step, val_loss=float(v))

        hella_interval = cfg["eval"].get("hellaswag_interval", 0)
        if hella_interval and step > 0 and step % hella_interval == 0 and info.is_main:
            model.eval()
            acc = eval_hellaswag(raw_model, device, split="val", limit=1000)
            model.train()
            print(f"  hellaswag (1k subset): {acc:.4f}")
            logger.log(step=step, hellaswag_val=acc)

        if ckpt_interval and step > 0 and step % ckpt_interval == 0 and info.is_main:
            save_checkpoint(out_dir / "ckpt.pt", raw_model, optim, step, cfg,
                            extra={"meta": ckpt_meta})

    if info.is_main:
        save_checkpoint(out_dir / "ckpt.pt", raw_model, optim, max_steps, cfg,
                        extra={"meta": ckpt_meta})
    logger.close()
    cleanup_distributed(info)


if __name__ == "__main__":
    main()
