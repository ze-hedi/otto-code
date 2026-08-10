# nanogpt — reproducing GPT-2 (124M)

From-scratch PyTorch reproduction of GPT-2 124M, following the build order in
Karpathy's `build-nanogpt` tutorial. Targets the FineWeb-Edu sample-10BT
dataset; reference targets are val loss ~3.0 and HellaSwag ~29%.

## Layout

```
nanogpt/
├── src/
│   ├── model.py                # GPT model
│   ├── data.py                 # DDP-aware token-shard loader
│   ├── prepare_fineweb.py      # download + tokenize FineWeb-Edu 10BT
│   ├── prepare_shakespeare.py  # tiny dataset for smoke tests
│   ├── train.py                # main DDP training entrypoint
│   ├── eval_hellaswag.py       # HellaSwag eval
│   ├── sample.py               # generation
│   └── utils.py                # dist init, logging, checkpoint I/O
├── configs/
│   ├── shakespeare_char.yaml
│   ├── gpt2_124M_debug.yaml
│   └── gpt2_124M.yaml
├── scripts/
│   ├── launch_local.sh
│   ├── launch_ddp.sh
│   └── aws/
└── tests/
```

## Quickstart

```bash
pip install -r requirements.txt
# 1. Smoke test on Shakespeare (single GPU, ~5 min)
python src/prepare_shakespeare.py
python src/train.py --config configs/shakespeare_char.yaml
# 2. Sample
python src/sample.py --prompt "Hello, I'm a language model," --ckpt out/ckpt.pt
# 3. Full FineWeb run (8 GPUs DDP)
python src/prepare_fineweb.py
bash scripts/launch_ddp.sh configs/gpt2_124M.yaml
```

## Environment

- `DATA_DIR` — where token shards live (default `./data`).
- `OUT_DIR`  — where checkpoints/logs go (default `./out`).
- `S3_BUCKET` — optional; if set, checkpoints sync there.

## Throughput log (filled in as Step 4 progresses)

| Optimization | tokens/sec | notes |
|---|---|---|
| baseline (fp32) | _tbd_ | |
| + TF32 | _tbd_ | |
| + bf16 autocast | _tbd_ | |
| + torch.compile | _tbd_ | |
| + flash (verified) | _tbd_ | |
| + vocab 50304 | _tbd_ | |
| + fused AdamW | _tbd_ | |
| + grad accum 0.5M | _tbd_ | |
| + DDP 8 GPU | _tbd_ | |
