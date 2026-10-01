# Deploying QRavy to Contabo

This production stack runs both frontends and the backend in Docker. GitHub Actions builds and publishes images to GHCR after CI passes on `main`, then sends the Compose/Caddy config and transcript exporter script to Contabo and deploys the exact commit-tagged images. The application source stays in GitHub; it is not copied to the VPS. Caddy is the only container published to the internet and provides HTTPS. MongoDB remains external; use MongoDB Atlas and allowlist the VPS IP.

## Prepare the VPS

Create an Ubuntu 24.04 VPS. A starting size of 4 vCPU and 8 GB RAM is recommended for the AI waiter. Add DNS A records for the Braincell and storefront hostnames in `.env.production` to the VPS IPv4 address.

Allow inbound SSH, TCP 80/443, and UDP 443 in the Contabo firewall and UFW. Do not open application ports or MongoDB.

Install Docker Engine and the Docker Compose plugin using Docker's official Ubuntu instructions. Create the deployment directory and runtime environment directory:

```sh
sudo mkdir -p /opt/qravy/runtime
sudo chown -R "$USER":"$USER" /opt/qravy
```

## Configure secrets

Copy `deploy/contabo.env.example` to `/opt/qravy/.env.production` and fill in the domains, TLS email, GHCR image prefix, and API keys. Create these runtime files under `/opt/qravy/runtime` from the matching examples in the repository, then fill in production values:

- `auth-service.env`
- `upload-service.env`
- `storefront-host.env`
- `ai-waiter-service.env`

From the repository root, the initial placeholder files can be transferred with:

```sh
scp deploy/contabo.env.example user@CONTABO_HOST:/opt/qravy/.env.production
scp services/auth-service/.env.example user@CONTABO_HOST:/opt/qravy/runtime/auth-service.env
scp services/upload-service/.env.example user@CONTABO_HOST:/opt/qravy/runtime/upload-service.env
scp services/storefront-host/.env.example user@CONTABO_HOST:/opt/qravy/runtime/storefront-host.env
scp services/ai-waiter-service/.env.example user@CONTABO_HOST:/opt/qravy/runtime/ai-waiter-service.env
```

Edit those files on the VPS before deploying; the examples intentionally contain placeholders.

Use a MongoDB Atlas URI in the auth and waiter environment files, and allowlist the VPS's outbound IP in Atlas. The upload token must match between `.env.production` and `upload-service.env`. Restrict the deployment user to SSH access and Docker administration; no application ports need to be published.

## Configure GitHub Actions

Add these repository **Variables** under Settings → Secrets and variables → Actions → Variables:

- `ADMIN_DOMAIN`: Braincell's hostname, such as `app.example.com`
- `STOREFRONT_DOMAIN`: Tastebud's hostname, such as `menu.example.com`
- `CONTABO_DEPLOY_PATH`: `/opt/qravy`

Add these repository **Secrets** under Settings → Secrets and variables → Actions → Secrets:

- `CONTABO_HOST`: the VPS IP address or SSH hostname
- `CONTABO_USER`: the deployment SSH user
- `CONTABO_SSH_KEY`: its private SSH key; install the matching public key in the user's `authorized_keys`
- `CONTABO_KNOWN_HOSTS`: the verified SSH host-key line for the VPS
- `GHCR_READ_USER`: GitHub username authorized to read the packages
- `GHCR_READ_TOKEN`: a GitHub classic PAT with `read:packages`

The workflow's `GITHUB_TOKEN` publishes the images. The separate read token lets the VPS pull private GHCR packages. Set `IMAGE_PREFIX` in `/opt/qravy/.env.production` to `ghcr.io/<lowercase-github-owner>`.

## Start the stack

After setup, push to `main`. The `CI` workflow runs first; if it succeeds, `Release Images` builds and pushes both frontends and all backend images, then deploys them to Contabo. The deploy job uploads the current `compose.production.yml` and `Caddyfile`, logs into GHCR, pulls the SHA-tagged images, and restarts the stack.

You can verify the running stack over SSH:

```sh
cd /opt/qravy
IMAGE_TAG=prod docker compose --env-file .env.production -f compose.production.yml ps
```

Check logs with:

```sh
docker compose --env-file .env.production -f compose.production.yml logs -f caddy api-gateway storefront-host ai-waiter-service transcripts-exporter
```

Live production review files are written on the VPS under `/opt/qravy/fine_tuning/review_transcripts-YYYYMMDD.jsonl`.

Visit the Braincell hostname and storefront hostname. Restaurant menus use `/t/<restaurant-subdomain>/menu` or `/t/<restaurant-subdomain>/menu/dine-in`. Caddy obtains and renews HTTPS certificates automatically after DNS resolves and ports 80/443 are reachable.

## Updating

Every successful `main` push deploys automatically. To roll back, set `IMAGE_TAG` to a previously published `sha-<commit>` tag and restart the Compose stack.

Back up MongoDB Atlas, the Docker volume `caddy_data`, and `/opt/qravy/fine_tuning` if you need to retain exported review files.