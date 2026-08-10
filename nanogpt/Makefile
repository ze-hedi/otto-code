.PHONY: install smoke prepare-shakespeare prepare-data train sample eval test clean

PYTHON ?= python
CONFIG ?= configs/gpt2_124M.yaml

install:
	pip install -r requirements.txt

prepare-shakespeare:
	$(PYTHON) src/prepare_shakespeare.py

prepare-data:
	$(PYTHON) src/prepare_fineweb.py

smoke: prepare-shakespeare
	$(PYTHON) src/train.py --config configs/shakespeare_char.yaml --dry-run

train:
	bash scripts/launch_ddp.sh $(CONFIG)

sample:
	$(PYTHON) src/sample.py --ckpt $(OUT_DIR)/ckpt.pt \
		--prompt "Hello, I'm a language model," --max-new-tokens 64

eval:
	$(PYTHON) src/eval_hellaswag.py --ckpt $(OUT_DIR)/ckpt.pt

test:
	$(PYTHON) -m pytest -q tests

clean:
	rm -rf logs/*.jsonl out/ data/
