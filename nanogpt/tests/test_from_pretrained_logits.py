"""Loading HF GPT-2 weights must reproduce HF's logits within fp32 noise.

This test is the only place we touch HuggingFace `transformers` in the
training path. It is the strongest possible proof that our model's
forward computation matches OpenAI's.
"""

import pytest
import torch

from model import GPT

transformers = pytest.importorskip("transformers")


@pytest.mark.slow
def test_from_pretrained_logit_parity():
    torch.manual_seed(0)
    prompt = torch.tensor([[15496, 11, 314, 1101, 257, 3303, 2746, 11]])  # "Hello, I'm a language model,"

    ours = GPT.from_pretrained("gpt2").eval()
    with torch.no_grad():
        ours_logits, _ = ours(prompt)

    hf = transformers.GPT2LMHeadModel.from_pretrained("gpt2").eval()
    with torch.no_grad():
        hf_logits = hf(prompt).logits

    # Slice ours to HF's vocab size (we don't pad here because from_pretrained
    # uses vocab_size=50257 to match exactly).
    diff = (ours_logits - hf_logits).abs().max().item()
    assert diff < 1e-4, f"max abs logit diff = {diff}"
