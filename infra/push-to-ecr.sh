#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

image_tag="${1:-}"
if [[ -z "$image_tag" ]] || [[ ! "$image_tag" =~ ^[A-Za-z0-9_.-]{1,128}$ ]]; then
  echo "Usage: $0 IMAGE_TAG" >&2
  exit 1
fi

aws_profile=$(terraform -chdir=infra output -raw aws_profile)
aws_region=$(terraform -chdir=infra output -raw aws_region)
instance_id=$(terraform -chdir=infra output -raw instance_id)
repository_url=$(terraform -chdir=infra output -raw ecr_repository_url)
registry=${repository_url%%/*}
image_uri="$repository_url:$image_tag"

instance_architecture=$(aws ec2 describe-instances \
  --profile "$aws_profile" --region "$aws_region" \
  --instance-ids "$instance_id" \
  --query 'Reservations[0].Instances[0].Architecture' \
  --output text)
case "$instance_architecture" in
  x86_64) image_platform=linux/amd64 ;;
  arm64) image_platform=linux/arm64 ;;
  *) echo "Unsupported EC2 architecture: $instance_architecture" >&2; exit 1 ;;
esac

aws ecr get-login-password --profile "$aws_profile" --region "$aws_region" \
  | docker login --username AWS --password-stdin "$registry"

docker buildx build \
  --platform "$image_platform" \
  --tag "$image_uri" \
  --push \
  .

echo "Built $image_platform for EC2 architecture $instance_architecture." >&2
echo "$image_uri"
