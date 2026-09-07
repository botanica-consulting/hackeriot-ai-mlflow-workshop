# Automated AWS and Cloudflare deployment

Terraform creates the AWS host and the Cloudflare edge configuration. The app image is stored in ECR and deployments are executed on EC2 through Systems Manager, so the server exposes no inbound ports and does not require SSH.

## Resources created

AWS:

- Ubuntu 24.04 EC2 instance, default `r7i.2xlarge`
- Security group with no ingress and unrestricted outbound traffic
- IAM instance role for SSM, ECR pulls, and one Secrets Manager secret
- ECR repository with immutable release tags, a movable `latest` tag, scan-on-push, and a 30-day lifecycle policy for superseded images
- Encrypted root volume
- Separate encrypted persistent gp3 volume for Docker and all MLflow data
- Secrets Manager secret container for the shared `.env`

Cloudflare:

- Remotely managed Cloudflare Tunnel
- Tunnel configuration forwarding participant hostnames to `http://traefik:80`
- One exact proxied CNAME record per participant app hostname
- A final 404 tunnel rule for unmatched requests

Creating exact DNS records avoids sending unrelated `*.botanica.tools` traffic to the workshop server.

## Prerequisites

Install locally:

- Terraform 1.5 or newer
- AWS CLI with the selected profile
- Docker with Buildx and Compose
- Node.js 22 and npm
- `jq`, `tar`, and `base64`

The AWS identity needs permission to manage EC2, EBS, ECR, IAM, Secrets Manager, and Systems Manager resources.

For AWS IAM Identity Center/SSO profiles, select the profile before running Terraform:

```bash
export AWS_PROFILE='AdministratorAccess-159781126207'
aws sso login --profile "$AWS_PROFILE" # only when the cached session has expired
```

Terraform uses the standard AWS credential chain. The profile in `terraform.tfvars` is retained for the deployment scripts' explicit AWS CLI calls.

## 1. Create a Cloudflare API token

In Cloudflare Dashboard, open **My Profile → API Tokens → Create Token → Custom token**.

Grant (the tunnel permission may appear as **Cloudflare One Connector: cloudflared → Write** in newer dashboard versions):

- Account → Cloudflare Tunnel → Edit
- Zone → DNS → Edit

Scope the account permission to the account that owns `botanica.tools`, and scope the zone permission to only `botanica.tools`. Do not use the Global API Key.

Copy the token once and export it in the shell that will run Terraform:

```bash
export CLOUDFLARE_API_TOKEN='replace-with-token'
```

The token is read by the Cloudflare Terraform provider and is not written to `terraform.tfvars`.

The generated cloudflared connector token is a sensitive Terraform output and therefore exists in Terraform state. Keep the state encrypted and access-controlled; for team use, configure an encrypted remote Terraform backend rather than sharing the local state file.

## 2. Find the Cloudflare IDs

Open the `botanica.tools` zone in Cloudflare Dashboard. The **Account ID** and **Zone ID** appear in the zone overview/API section.

Create the local Terraform variables file:

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

Set at least:

```hcl
aws_profile           = "your-profile"
aws_region            = "eu-central-1"
cloudflare_account_id = "account-id"
cloudflare_zone_id    = "zone-id"
```

The default VPC and its first sorted public subnet are used unless `vpc_id` and `subnet_id` are supplied. The subnet must provide outbound Internet connectivity because SSM, ECR, AI APIs, and cloudflared are outbound connections.

## 3. Create the infrastructure

```bash
terraform -chdir=infra init
terraform -chdir=infra plan -out=greenhouse.tfplan
terraform -chdir=infra apply greenhouse.tfplan
```

This also creates 50 exact Cloudflare DNS records for 50 participants and configures the tunnel routes. MLflow does not have separate DNS: each isolated UI is available below its participant app at `/mlflow`. No Cloudflare dashboard steps are required after apply.

The persistent data volume has `prevent_destroy = true`. A normal `terraform destroy` intentionally refuses to delete it; remove that lifecycle guard only when the MLflow data should truly be destroyed.

## 4. Store the shared environment securely

Configure the selected AI provider in the ignored root `.env`. Leave `CLOUDFLARE_TUNNEL_TOKEN` empty locally; the script reads the generated tunnel token from Terraform and inserts it only into a temporary file.

```bash
./infra/configure-secret.sh
```

The script synchronizes `PARTICIPANT_COUNT` and `DEPLOY_DOMAIN` with Terraform, validates the selected AI provider key, and writes the complete dotenv content as a new encrypted Secrets Manager version. The temporary plaintext file is mode `0600` and removed on exit.

The same `.env` also configures the workshop access gateway:

```dotenv
GATEWAY_ACCESS_CODE=women-in-tech-shape-the-future
GATEWAY_ALLOWED_IPS=
```

The bypass list accepts comma-separated exact IP addresses and is intentionally empty initially. Every participant hostname and its `/mlflow` route therefore require the shared phrase. After changing either value, rerun `./infra/configure-secret.sh` and deploy again.

Run this command again whenever a provider key or shared setting changes. Existing app containers receive the new settings on the next deployment.

## 5. Build and deploy

```bash
./infra/deploy.sh
```

This command:

1. Runs tests and TypeScript checks.
2. Builds the linux/amd64 production image.
3. Pushes an immutable, commit-and-timestamp-tagged image to ECR.
4. Generates the 50-pair Compose and Traefik configuration.
5. Transfers the small deployment bundle to EC2 using SSM Run Command.
6. Runs the on-server redeploy script.
7. Waits for all 102 containers to be running and all health checks to pass.
8. Moves the `latest` tag to the successfully deployed image. ECR always retains that image and expires superseded images after 30 days.

To choose an explicit immutable image tag:

```bash
./infra/deploy.sh workshop-v1
```

## Redeploy directly on EC2

The workstation flow installs the reusable script at:

```text
/opt/greenhouse/infra/redeploy-on-ec2.sh
```

Connect using the `ssm_session_command` Terraform output and run:

```bash
sudo /opt/greenhouse/infra/redeploy-on-ec2.sh \
  ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/greenhouse-workshop-app:IMAGE_TAG \
  SECRET_ARN \
  REGION
```

The script prevents concurrent deployments, retrieves the encrypted `.env`, authenticates to ECR with the instance role, pulls the exact image, updates all app services, preserves the MLflow volumes, recreates only changed containers, and verifies service health.

The last successful image is recorded in `/opt/greenhouse/.last-successful-image`. Redeploy that image URI to roll back.

## Cloudflare verification

After deployment, verify:

```bash
curl -I https://greenhouse-01.botanica.tools
curl -I https://greenhouse-01.botanica.tools/mlflow
curl -I https://greenhouse-50.botanica.tools
```

In **Cloudflare Zero Trust → Networks → Tunnels**, `greenhouse-workshop` should report **Healthy**. In the `botanica.tools` DNS page, participant records should be proxied and point to the tunnel UUID under `cfargotunnel.com`.

Cloudflare Access is intentionally not enabled automatically because its policy needs an attendee identity decision. If access control is required, create an Access application covering the participant hostnames and allow the workshop email domain or an explicit attendee group before distributing the URLs.

## Operations

Start an SSM shell:

```bash
terraform -chdir=infra output -raw ssm_session_command | bash
```

On EC2:

```bash
cd /opt/greenhouse
./scripts/compose.sh --env-file .env -f docker-compose.generated.json ps
docker stats --no-stream
```

The EC2 bootstrap log is `/var/log/greenhouse-bootstrap.log`. Deployment command output is also retained in Systems Manager command history.
