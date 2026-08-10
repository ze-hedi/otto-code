#!/usr/bin/env bash
# One-time AWS bootstrap: S3 bucket, IAM role + instance profile.
# Required env: REGION, BUCKET. ACCOUNT is derived from STS.
set -euo pipefail

: "${REGION:?REGION not set}"
: "${BUCKET:?BUCKET not set}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "account=${ACCOUNT}  region=${REGION}  bucket=${BUCKET}"

aws s3 mb "s3://${BUCKET}" --region "${REGION}" || true
aws s3api put-bucket-versioning --bucket "${BUCKET}" \
    --versioning-configuration Status=Enabled

aws iam create-role --role-name gpt2-train-role \
    --assume-role-policy-document file://"$(dirname "$0")/trust-ec2.json" || true
aws iam attach-role-policy --role-name gpt2-train-role \
    --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
aws iam attach-role-policy --role-name gpt2-train-role \
    --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy

aws iam create-instance-profile --instance-profile-name gpt2-train-profile || true
aws iam add-role-to-instance-profile \
    --instance-profile-name gpt2-train-profile \
    --role-name gpt2-train-role || true

echo "bootstrap complete"
