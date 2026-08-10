"""WD-decoupled AdamW: exactly two groups; bias / LayerNorm have wd=0."""

import torch

from model import GPT, GPTConfig
from train import configure_optimizer


def test_two_groups_with_correct_split():
    cfg = GPTConfig(block_size=32, vocab_size=128, n_layer=2, n_head=4, n_embd=32, bias=True)
    m = GPT(cfg)
    opt = configure_optimizer(m, lr=1e-3, betas=(0.9, 0.95), weight_decay=0.1, fused=False)

    assert len(opt.param_groups) == 2
    decay_wd = {g["weight_decay"] for g in opt.param_groups if g["weight_decay"] > 0}
    no_decay_wd = {g["weight_decay"] for g in opt.param_groups if g["weight_decay"] == 0}
    assert decay_wd == {0.1}
    assert no_decay_wd == {0.0}

    # Every parameter is in exactly one group.
    all_params = list(m.parameters())
    seen = sum(len(g["params"]) for g in opt.param_groups)
    assert seen == len(all_params)

    # Every 1-d parameter (bias, LayerNorm weight) lives in the no-decay group;
    # every 2+d parameter (Linear / Embedding) lives in the decay group.
    decay_set = {id(p) for g in opt.param_groups if g["weight_decay"] > 0 for p in g["params"]}
    for name, p in m.named_parameters():
        if p.dim() >= 2:
            assert id(p) in decay_set, f"{name} (dim {p.dim()}) should have decay"
        else:
            assert id(p) not in decay_set, f"{name} (dim {p.dim()}) should NOT have decay"
