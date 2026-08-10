#!/bin/bash
# EC2 user-data for the training instance (p4d.24xlarge or p5.48xlarge).
# Substitute REPO and BUCKET before launch.
#
# The final `shutdown -h now` is non-negotiable. An idle p4d running
# unattended over a weekend is a four-figure bill.
set -e
cd /home/ubuntu
sudo -u ubuntu git clone "${REPO}" nanogpt
cd nanogpt/nanogpt
sudo -u ubuntu pip install -r requirements.txt

aws s3 sync "s3://${BUCKET}/tokens/" /home/ubuntu/data/fineweb_edu/

sudo -u ubuntu torchrun --standalone --nproc_per_node=8 \
    src/train.py --config configs/gpt2_124M.yaml \
    --data-dir /home/ubuntu/data \
    --out-dir /home/ubuntu/out \
    --resume \
    2>&1 | tee /home/ubuntu/train.log

aws s3 sync /home/ubuntu/out "s3://${BUCKET}/checkpoints/$(date +%Y%m%d-%H%M)/"
aws s3 cp /home/ubuntu/train.log "s3://${BUCKET}/logs/"

shutdown -h now
