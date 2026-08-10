#!/bin/bash
# EC2 user-data for the data-prep instance (m6i.4xlarge, CPU).
# Substitute REPO and BUCKET before launch.
set -e
apt-get update && apt-get install -y python3-pip git
pip3 install --quiet datasets tiktoken numpy tqdm boto3 requests
git clone "${REPO}" /opt/nanogpt
cd /opt/nanogpt/nanogpt
python3 src/prepare_fineweb.py --out /tmp/tokens --shards 100
aws s3 sync /tmp/tokens "s3://${BUCKET}/tokens/"
shutdown -h now
