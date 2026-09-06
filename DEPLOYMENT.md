# EC2 workshop deployment

The deployment runs 50 isolated app and MLflow process/storage pairs behind Traefik and a remotely managed Cloudflare Tunnel. No inbound EC2 ports are required. The containers share an internal transport network, but every participant has distinct app and MLflow processes and persistent storage.

## Cloudflare and AWS setup

Terraform can create the EC2 server, ECR repository, encrypted persistent data volume, environment secret, remotely managed Cloudflare Tunnel, tunnel ingress configuration, and all participant DNS records. Follow [infra/README.md](infra/README.md) for the automated setup and deployment flow.

The participant app URLs are `https://greenhouse-01.botanica.tools` through `https://greenhouse-50.botanica.tools`. Each app links to its isolated MLflow UI on the same hostname, for example `https://greenhouse-01.botanica.tools/mlflow`. Cloudflare has no separate MLflow DNS records.

## Workshop access gateway

Traefik checks every app and MLflow request against the participant app's gateway endpoint. Visitors without an accepted source IP or access cookie are redirected to `/gateway`, where they enter the shared workshop phrase. A successful entry sets a secure, HTTP-only cookie for 12 hours and returns the visitor to the originally requested page.

The initial shared phrase is `women-in-tech-shape-the-future`. Configure it and the bypass list in `.env`:

```dotenv
GATEWAY_ACCESS_CODE=women-in-tech-shape-the-future
GATEWAY_ALLOWED_IPS=
```

`GATEWAY_ALLOWED_IPS` accepts comma-separated exact IPv4 or IPv6 addresses. It is empty by default, so every visitor must enter the phrase. The check prefers Cloudflare's connecting-IP header and is safe in this topology because the EC2 security group has no inbound rules; requests can reach Traefik only through the Cloudflare Tunnel.

## Server setup

For the Terraform deployment, the EC2 bootstrap installs Docker Engine, Docker Compose, AWS CLI, SSM Agent, and supporting utilities automatically. A 64 GiB / 8-vCPU EC2 instance is recommended for 50 simultaneous participants.

For a local/manual deployment, copy `.env.example` to `.env`, fill in the AI provider key and Cloudflare tunnel token, then deploy:

```bash
./scripts/deploy.sh
```

The generator creates `docker-compose.generated.json` and `deployment/generated/dynamic.yml`. These files are derived from `.env` and intentionally ignored by Git.

Check all services with:

```bash
./scripts/status.sh
```

Reset one participant, including their MLflow database and trace artifacts, with:

```bash
./scripts/reset-participant.sh 17 --confirm
```

## Environment model

Every app container loads the shared root `.env`, including the gateway phrase and IP bypass list. The generated Compose file overrides only the participant-specific values: the public site URL, the private Docker-network MLflow tracking address, and the same-host `/mlflow` UI URL. MLflow and infrastructure containers do not receive the AI provider secrets.

MLflow uses one API worker and disables its unused background job executor. Each instance has a dedicated named volume and a 512 MiB memory limit. Each app has a 256 MiB memory limit.

On the 50-participant reference deployment, the warm baseline was about 53 MiB per app and 281 MiB per MLflow instance, or about 335 MiB per participant and 16.3 GiB total for the 50 pairs. Traefik and cloudflared added about 36 MiB. Actual usage grows with workshop activity, so the recommended 64 GiB host preserves substantial working headroom.
