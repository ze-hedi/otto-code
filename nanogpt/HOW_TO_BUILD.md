# How to build this repo

This is a build log + recipe for reproducing GPT-2 (124M) from scratch,
following Karpathy's `build-nanogpt`. The spec is the long doc that lives
outside the repo; this file is the developer-facing summary of how the
code was assembled and how to run it.

The repo was built commit-by-commit so the diff between any two commits
isolates one design decision. Each commit ends with a session URL
footer; the headings below match the step numbering in the spec.

## Repository layout

```
nanogpt/
├── README.md                  -- high-level pointer, throughput log
├── HOW_TO_BUILD.md            -- this file
├── Makefile                   -- install / prepare-data / train / sample / eval / test
├── pyproject.toml             -- python>=3.10, torch>=2.4
├── requirements.txt
├── src/
│   ├── model.py               -- GPT, Block, CausalSelfAttention, MLP
│   ├── data.py                -- ShardLoader: rank-aware FineWeb shard reader
│   ├── prepare_fineweb.py     -- tokenize FineWeb-Edu 10BT into uint16 shards
│   ├── prepare_shakespeare.py -- tiny char-level dataset for smoke tests
│   ├── train.py               -- DDP-aware training entrypoint
│   ├── eval_hellaswag.py      -- HellaSwag eval (CLI + train-loop hook)
│   ├── sample.py              -- generation CLI
│   └── utils.py               -- dist init, JSONL logger, ckpt I/O
├── configs/
│   ├── shakespeare_char.yaml  -- ~5-min smoke run on one GPU
│   ├── gpt2_124M_debug.yaml   -- 100-step end-to-end sanity check
│   └── gpt2_124M.yaml         -- the real 10B-token run
├── scripts/
│   ├── launch_local.sh        -- single-GPU launcher
│   ├── launch_ddp.sh          -- torchrun wrapper for 8-GPU node
│   └── aws/                   -- one-shot Part B bring-up
│       ├── trust-ec2.json
│       ├── bootstrap.sh
│       ├── prep-userdata.sh
│       └── train-userdata.sh
└── tests/
    ├── test_model_shapes.py
    ├── test_attention_equivalence.py
    ├── test_from_pretrained_logits.py   -- only place we import transformers
    ├── test_optim_param_groups.py
    └── test_dataloader_disjoint.py
```

## Build order

| Step | What | Acceptance gate |
|------|------|------------------|
| 0    | Scaffold: dirs, configs, pyproject, utils                                | n/a                                       |
| 1    | `GPT` model + `from_pretrained('gpt2')`                                  | logits within 1e-4 of HF                  |
| 2    | `src/sample.py` with top-k generation                                    | coherent continuation of "Hello, ..."     |
| 3    | Shakespeare smoke pipeline                                               | loss 4.6 → <2.0 in ~5 min                 |
| 4.1  | TF32 matmuls                                                             | speedup, no loss-curve change             |
| 4.2  | bf16 autocast in forward                                                 | speedup, no loss-curve change             |
| 4.3  | `torch.compile`                                                          | speedup after first step                  |
| 4.4  | Confirm SDPA dispatches to flash                                         | speedup, attention still passes equality  |
| 4.5  | Vocab pad to 50304 (multiple of 128)                                     | lm_head matmul aligned                    |
| 4.6  | Fused AdamW                                                              | fewer optimizer launches                  |
| 4.7  | Gradient accumulation to 0.5M tokens / optim step                        | effective batch = `batch_tokens`          |
| 4.8  | DDP single-node, multi-GPU                                               | linear scaling, sync only on last micro   |
| 5    | Decoupled weight-decay param groups + checkpoint/resume                  | `test_optim_param_groups`                 |
| 6    | FineWeb-Edu 10BT prep + DDP shard loader                                 | `test_dataloader_disjoint`                |
| 7    | HellaSwag eval (CLI + in-train hook)                                     | gpt2 baseline ~0.295                      |
| 8    | Polish: `--wandb`, Makefile, launch scripts, AWS user-data               | `make smoke`, scripts executable          |

The whole thing is roughly 600 lines of Python.

## Quickstart

```bash
# 1. Local env
cd nanogpt
make install        # pip install -r requirements.txt

# 2. Smoke test on a single GPU (Shakespeare char-level, ~5 min)
make prepare-shakespeare
python src/train.py --config configs/shakespeare_char.yaml
python src/sample.py --ckpt out/ckpt.pt --prompt "ROMEO:"

# 3. Full GPT-2 124M reproduction on 8x A100 / H100
make prepare-data   # ~30 min CPU work, writes ~100 shards
bash scripts/launch_ddp.sh configs/gpt2_124M.yaml

# 4. Eval
python src/eval_hellaswag.py --ckpt out/ckpt.pt
python src/sample.py --ckpt out/ckpt.pt \
    --prompt "Hello, I'm a language model," --num-samples 5
```

## Environment

| Var          | Default     | Purpose                                |
|--------------|-------------|----------------------------------------|
| `DATA_DIR`   | `./data`    | where token shards live                |
| `OUT_DIR`    | `./out`     | checkpoints + final artifacts          |
| `S3_BUCKET`  | _unset_     | optional sync target                   |

CLI flags on `src/train.py`:

- `--config <yaml>` (required)
- `--data-dir`, `--out-dir` (override env)
- `--dry-run` (run 2 steps, exit)
- `--resume` (load `$OUT_DIR/ckpt.pt` if present)
- `--wandb`, `--wandb-project`, `--wandb-run`
- `--seed`

## Tests

```bash
make test     # python -m pytest -q tests
```

| Test                              | Proves                                                                |
|-----------------------------------|-----------------------------------------------------------------------|
| `test_model_shapes`               | Forward returns `(B,T,V)`; loss is scalar; ~124M params; weights tied |
| `test_attention_equivalence`      | SDPA causal output ≈ hand-rolled softmax in fp32 (atol 1e-3)          |
| `test_from_pretrained_logits`     | Our forward matches HF GPT-2 within 1e-4 on a fixed prompt            |
| `test_optim_param_groups`         | Two AdamW groups: LN/bias have wd=0, 2D+ tensors have wd=0.1          |
| `test_dataloader_disjoint`        | Across 8 mock ranks, batches do not overlap; shard rollover works     |

The only place HuggingFace `transformers` is imported in this repo is
`test_from_pretrained_logits.py` (and inside `GPT.from_pretrained`,
which is itself a test/inference helper -- it is never called from
`train.py`).

## Hyperparameter cheat sheet (the real run)

From `configs/gpt2_124M.yaml`:

| Knob                | Value      | Why                                            |
|---------------------|------------|------------------------------------------------|
| n_layer / n_head    | 12 / 12    | GPT-2 124M                                     |
| n_embd              | 768        | "                                              |
| block_size          | 1024       | "                                              |
| vocab_size          | 50304      | padded from 50257 for tensor-core alignment    |
| lr / min_lr         | 6e-4 / 6e-5 | GPT-3 small recipe                            |
| betas               | (0.9, 0.95) | "                                             |
| weight_decay        | 0.1         | applied only to 2D+ tensors                   |
| grad_clip           | 1.0         | "                                             |
| warmup_steps        | 715         | ~0.375B tokens warmup                         |
| max_steps           | 19073       | ≈ 10B tokens / 524288 tokens/step             |
| micro_batch_size    | 64          | per-GPU                                        |
| seq_len             | 1024        | "                                              |
| batch_tokens        | 524288      | global tokens per optim step                   |

## Targets

After 10B tokens on 8x A100 40 GB (~4 hr) or 8x H100 80 GB (~1.5 hr):

- val loss ≤ 3.10
- HellaSwag top-1 ≥ 0.29

## Running on AWS (Part B summary)

1. `REGION=us-east-1 BUCKET=gpt2-repro-<acct> bash scripts/aws/bootstrap.sh`
2. Request a Service Quota increase for "Running On-Demand P instances"
   (≥ 96 vCPUs).
3. Launch an `m6i.4xlarge` with `prep-userdata.sh` (about 30 min, <$1).
4. Launch a `p4d.24xlarge` (or `p5.48xlarge`) with `train-userdata.sh`.
   Both user-data scripts end with `shutdown -h now`.
5. Validate, archive checkpoint, tear down.

Per-run cost band: ~$50 on p4d Spot, ~$95 on-demand, ~$55 on p5
Capacity Block. Plus ~$8 of supporting (data prep, S3, EBS, CW).

## Conventions that fall out of the spec

- One commit per numbered step. Diff isolates the change.
- All training entrypoints support `--dry-run` (runs 2 steps and exits).
- All paths configurable by env var.
- HuggingFace `transformers` is **not** in the training path.
- `tokens/sec` is logged on every step into `logs/train.jsonl`; the
  README has the throughput table that gets filled in as the Step 4
  commits land on real hardware.
