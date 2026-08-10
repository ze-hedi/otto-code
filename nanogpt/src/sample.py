"""Sample from a GPT checkpoint or from the pretrained GPT-2.

Examples:
    # Sample from pretrained GPT-2 (sanity check Step 1):
    python src/sample.py --pretrained gpt2 \
        --prompt "Hello, I'm a language model," --max-new-tokens 64 --num-samples 3

    # Sample from a local checkpoint:
    python src/sample.py --ckpt out/ckpt.pt --prompt "ROMEO:" --max-new-tokens 200
"""

from __future__ import annotations

import argparse
import os
import sys

import torch

from model import GPT, GPTConfig
from utils import load_checkpoint


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt", type=str, default=None, help="path to a checkpoint .pt")
    p.add_argument("--pretrained", type=str, default=None,
                   choices=["gpt2", "gpt2-medium", "gpt2-large", "gpt2-xl"])
    p.add_argument("--prompt", type=str, default="Hello, I'm a language model,")
    p.add_argument("--max-new-tokens", type=int, default=64)
    p.add_argument("--num-samples", type=int, default=3)
    p.add_argument("--temperature", type=float, default=1.0)
    p.add_argument("--top-k", type=int, default=50)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    args = p.parse_args()

    if (args.ckpt is None) == (args.pretrained is None):
        sys.exit("must pass exactly one of --ckpt or --pretrained")

    torch.manual_seed(args.seed)

    if args.pretrained is not None:
        model = GPT.from_pretrained(args.pretrained)
        # Pretrained ckpt uses gpt2's BPE.
        import tiktoken
        enc = tiktoken.get_encoding("gpt2")
        encode = lambda s: enc.encode(s)
        decode = lambda ids: enc.decode(ids)
    else:
        ckpt = load_checkpoint(args.ckpt, map_location="cpu")
        cfg = GPTConfig(**ckpt["config"]["model"])
        model = GPT(cfg)
        sd = ckpt["model"]
        # Strip a possible "_orig_mod." prefix from torch.compile()'d state dicts.
        sd = {k.removeprefix("_orig_mod."): v for k, v in sd.items()}
        model.load_state_dict(sd)
        meta = ckpt.get("meta", {})
        if meta.get("tokenizer") == "char":
            stoi, itos = meta["stoi"], meta["itos"]
            encode = lambda s: [stoi[c] for c in s if c in stoi]
            decode = lambda ids: "".join(itos[i] for i in ids)
        else:
            import tiktoken
            enc = tiktoken.get_encoding("gpt2")
            encode = lambda s: enc.encode(s)
            decode = lambda ids: enc.decode(ids)

    model.to(args.device).eval()

    prompt_ids = torch.tensor([encode(args.prompt)], dtype=torch.long, device=args.device)
    for i in range(args.num_samples):
        out = model.generate(
            prompt_ids.clone(),
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
            top_k=args.top_k,
        )
        print(f"--- sample {i + 1} ---")
        print(decode(out[0].tolist()))
        print()


if __name__ == "__main__":
    main()
