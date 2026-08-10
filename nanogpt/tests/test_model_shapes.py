import torch

from model import GPT, GPTConfig


def test_forward_shapes():
    cfg = GPTConfig(block_size=64, vocab_size=128, n_layer=2, n_head=4, n_embd=32, bias=False)
    m = GPT(cfg)
    idx = torch.randint(0, cfg.vocab_size, (3, 17))
    logits, loss = m(idx)
    assert logits.shape == (3, 17, cfg.vocab_size)
    assert loss is None

    targets = torch.randint(0, cfg.vocab_size, (3, 17))
    logits, loss = m(idx, targets)
    assert logits.shape == (3, 17, cfg.vocab_size)
    assert loss.ndim == 0


def test_param_count_124M():
    # GPT-2 small config with HF-matched vocab to check the textbook param count.
    cfg = GPTConfig(block_size=1024, vocab_size=50257, n_layer=12, n_head=12, n_embd=768, bias=True)
    m = GPT(cfg)
    n = m.num_params()
    # ~124M with tied embeddings.
    assert 120_000_000 < n < 130_000_000, f"param count {n} out of expected ~124M band"


def test_weight_tying():
    cfg = GPTConfig(block_size=32, vocab_size=64, n_layer=2, n_head=2, n_embd=16, bias=False)
    m = GPT(cfg)
    assert m.lm_head.weight.data_ptr() == m.transformer.wte.weight.data_ptr()
