"""SDPA (flash) attention must agree with a hand-rolled softmax(QK/sqrt(d))V."""

import math

import torch
import torch.nn.functional as F

from model import CausalSelfAttention, GPTConfig


def _naive_causal_attn(attn: CausalSelfAttention, x: torch.Tensor) -> torch.Tensor:
    B, T, C = x.size()
    q, k, v = attn.c_attn(x).split(attn.n_embd, dim=2)
    q = q.view(B, T, attn.n_head, C // attn.n_head).transpose(1, 2)
    k = k.view(B, T, attn.n_head, C // attn.n_head).transpose(1, 2)
    v = v.view(B, T, attn.n_head, C // attn.n_head).transpose(1, 2)

    att = (q @ k.transpose(-2, -1)) * (1.0 / math.sqrt(k.size(-1)))
    mask = torch.tril(torch.ones(T, T, device=x.device, dtype=torch.bool))
    att = att.masked_fill(~mask, float("-inf"))
    att = F.softmax(att, dim=-1)
    y = att @ v
    y = y.transpose(1, 2).contiguous().view(B, T, C)
    return attn.c_proj(y)


def test_sdpa_matches_naive_fp32():
    torch.manual_seed(0)
    cfg = GPTConfig(block_size=32, vocab_size=64, n_layer=1, n_head=4, n_embd=32, bias=False)
    attn = CausalSelfAttention(cfg).eval()
    x = torch.randn(2, 17, cfg.n_embd)
    sdpa = attn(x)
    naive = _naive_causal_attn(attn, x)
    assert torch.allclose(sdpa, naive, atol=1e-3, rtol=1e-3), \
        f"max abs diff = {(sdpa - naive).abs().max().item()}"
