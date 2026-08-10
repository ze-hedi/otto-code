"""GPT-2 model.

Pre-norm transformer matching OpenAI's GPT-2 weight layout exactly so
`GPT.from_pretrained('gpt2')` can load the HF checkpoint and reproduce
its logits within fp32 numerical noise.

Layout (matches the HF state_dict keys):
    transformer.wte.weight            (V, C)
    transformer.wpe.weight            (T, C)
    transformer.h.{i}.ln_1.{weight,bias}
    transformer.h.{i}.attn.c_attn.{weight,bias}    (C -> 3C)
    transformer.h.{i}.attn.c_proj.{weight,bias}    (C -> C)
    transformer.h.{i}.ln_2.{weight,bias}
    transformer.h.{i}.mlp.c_fc.{weight,bias}       (C -> 4C)
    transformer.h.{i}.mlp.c_proj.{weight,bias}     (4C -> C)
    transformer.ln_f.{weight,bias}
    lm_head.weight                    (V, C)  -- tied to wte
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class GPTConfig:
    block_size: int = 1024
    vocab_size: int = 50304       # padded from 50257 for tensor cores
    n_layer: int = 12
    n_head: int = 12
    n_embd: int = 768
    dropout: float = 0.0
    bias: bool = True             # GPT-2 itself has biases everywhere


class CausalSelfAttention(nn.Module):
    def __init__(self, cfg: GPTConfig):
        super().__init__()
        assert cfg.n_embd % cfg.n_head == 0
        self.c_attn = nn.Linear(cfg.n_embd, 3 * cfg.n_embd, bias=cfg.bias)
        self.c_proj = nn.Linear(cfg.n_embd, cfg.n_embd, bias=cfg.bias)
        self.c_proj.NANOGPT_SCALE_INIT = 1
        self.n_head = cfg.n_head
        self.n_embd = cfg.n_embd
        self.dropout = cfg.dropout

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, C = x.size()
        q, k, v = self.c_attn(x).split(self.n_embd, dim=2)
        # (B, nh, T, hs)
        q = q.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        k = k.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        v = v.view(B, T, self.n_head, C // self.n_head).transpose(1, 2)
        y = F.scaled_dot_product_attention(
            q, k, v,
            is_causal=True,
            dropout_p=self.dropout if self.training else 0.0,
        )
        y = y.transpose(1, 2).contiguous().view(B, T, C)
        return self.c_proj(y)


class MLP(nn.Module):
    def __init__(self, cfg: GPTConfig):
        super().__init__()
        self.c_fc = nn.Linear(cfg.n_embd, 4 * cfg.n_embd, bias=cfg.bias)
        self.gelu = nn.GELU(approximate="tanh")
        self.c_proj = nn.Linear(4 * cfg.n_embd, cfg.n_embd, bias=cfg.bias)
        self.c_proj.NANOGPT_SCALE_INIT = 1

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.c_proj(self.gelu(self.c_fc(x)))


class Block(nn.Module):
    def __init__(self, cfg: GPTConfig):
        super().__init__()
        self.ln_1 = nn.LayerNorm(cfg.n_embd, bias=cfg.bias)
        self.attn = CausalSelfAttention(cfg)
        self.ln_2 = nn.LayerNorm(cfg.n_embd, bias=cfg.bias)
        self.mlp = MLP(cfg)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(self.ln_1(x))
        x = x + self.mlp(self.ln_2(x))
        return x


class GPT(nn.Module):
    def __init__(self, cfg: GPTConfig):
        super().__init__()
        self.config = cfg

        self.transformer = nn.ModuleDict(dict(
            wte=nn.Embedding(cfg.vocab_size, cfg.n_embd),
            wpe=nn.Embedding(cfg.block_size, cfg.n_embd),
            h=nn.ModuleList([Block(cfg) for _ in range(cfg.n_layer)]),
            ln_f=nn.LayerNorm(cfg.n_embd, bias=cfg.bias),
        ))
        self.lm_head = nn.Linear(cfg.n_embd, cfg.vocab_size, bias=False)
        # weight tying
        self.lm_head.weight = self.transformer.wte.weight

        self.apply(self._init_weights)

    def _init_weights(self, module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            std = 0.02
            if getattr(module, "NANOGPT_SCALE_INIT", 0):
                std *= (2 * self.config.n_layer) ** -0.5
            nn.init.normal_(module.weight, mean=0.0, std=std)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def num_params(self, non_embedding: bool = False) -> int:
        n = sum(p.numel() for p in self.parameters())
        if non_embedding:
            n -= self.transformer.wpe.weight.numel()
        return n

    def forward(
        self,
        idx: torch.Tensor,
        targets: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor | None]:
        B, T = idx.size()
        assert T <= self.config.block_size, f"sequence length {T} > block_size {self.config.block_size}"
        pos = torch.arange(0, T, dtype=torch.long, device=idx.device)
        tok = self.transformer.wte(idx)
        x = tok + self.transformer.wpe(pos)
        for block in self.transformer.h:
            x = block(x)
        x = self.transformer.ln_f(x)
        logits = self.lm_head(x)
        loss = None
        if targets is not None:
            loss = F.cross_entropy(
                logits.view(-1, logits.size(-1)),
                targets.view(-1),
                ignore_index=-1,
            )
        return logits, loss

    @torch.no_grad()
    def generate(
        self,
        idx: torch.Tensor,
        max_new_tokens: int,
        temperature: float = 1.0,
        top_k: int | None = 50,
    ) -> torch.Tensor:
        self.eval()
        for _ in range(max_new_tokens):
            idx_cond = idx if idx.size(1) <= self.config.block_size else idx[:, -self.config.block_size:]
            logits, _ = self(idx_cond)
            logits = logits[:, -1, :] / max(temperature, 1e-8)
            if top_k is not None:
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits = torch.where(
                    logits < v[:, [-1]],
                    torch.full_like(logits, float("-inf")),
                    logits,
                )
            probs = F.softmax(logits, dim=-1)
            next_id = torch.multinomial(probs, num_samples=1)
            idx = torch.cat((idx, next_id), dim=1)
        return idx

    @classmethod
    def from_pretrained(cls, model_type: str = "gpt2") -> "GPT":
        """Load OpenAI's GPT-2 weights via HuggingFace's `transformers`.

        Only used for the inference parity test and for sampling demos.
        Not used in the training path.
        """
        from transformers import GPT2LMHeadModel  # local import; optional dep

        sizes = {
            "gpt2":         dict(n_layer=12, n_head=12, n_embd=768),
            "gpt2-medium":  dict(n_layer=24, n_head=16, n_embd=1024),
            "gpt2-large":   dict(n_layer=36, n_head=20, n_embd=1280),
            "gpt2-xl":      dict(n_layer=48, n_head=25, n_embd=1600),
        }
        assert model_type in sizes
        cfg = GPTConfig(
            block_size=1024,
            vocab_size=50257,       # exact, not padded — to match HF weights
            bias=True,
            dropout=0.0,
            **sizes[model_type],
        )
        model = cls(cfg)
        sd = model.state_dict()

        hf = GPT2LMHeadModel.from_pretrained(model_type)
        hf_sd = hf.state_dict()
        # OpenAI uses Conv1D (transposed) for these layers; transpose on load.
        transposed = (
            "attn.c_attn.weight",
            "attn.c_proj.weight",
            "mlp.c_fc.weight",
            "mlp.c_proj.weight",
        )
        skip = ("attn.bias", "attn.masked_bias")
        for k, v in hf_sd.items():
            if any(k.endswith(s) for s in skip):
                continue
            target_key = k
            if target_key not in sd:
                # Strip the `.weight` tying duplication on `lm_head` if HF
                # exposes both; we use the tied tensor from wte.
                continue
            if any(k.endswith(t) for t in transposed):
                with torch.no_grad():
                    sd[target_key].copy_(v.t())
            else:
                with torch.no_grad():
                    sd[target_key].copy_(v)
        return model
