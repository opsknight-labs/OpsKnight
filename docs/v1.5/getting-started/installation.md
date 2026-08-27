---
title: Installation
description: Choose the shortest install path for evaluation or the deployment path that matches production needs.
order: 2
---

# Installation

Use the installation method that matches what you are trying to prove.

For a first evaluation, prefer Docker Compose. It has the fewest moving parts and is the path used by [Getting Started](./README).

## Choose an install path

| Goal | Recommended path |
| --- | --- |
| Evaluate OpsKnight locally | Docker Compose |
| Validate Kubernetes behavior | Kustomize profile |
| Operate with configurable Kubernetes packaging | Helm |
| Develop OpsKnight itself | From source |

Do not start with a production-style Kubernetes deployment if your only goal is to understand the incident workflow. Prove the application path first, then introduce infrastructure complexity.

## Docker Compose

Clone the repository and create a local environment file:

```bash
git clone https://github.com/opsknight-labs/OpsKnight.git
cd OpsKnight
cp env.example .env
```

Generate the required application secrets:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

Set at least:

```dotenv
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_SECRET=PASTE_BASE64_OUTPUT
ENCRYPTION_KEY=PASTE_64_HEX_CHARACTER_OUTPUT
```

Then start OpsKnight:

```bash
docker compose up -d
```

Open `http://localhost:3000` and complete `/setup`.

For the complete first-run workflow, return to [Getting Started](./README).

## Kubernetes

OpsKnight includes Kubernetes deployment assets for environments that need separate runtime roles, horizontal web scaling, and database connection management.

Before production use:

- use a persistent PostgreSQL deployment appropriate for your environment;
- configure secrets through your platform's secret-management mechanism rather than committing them;
- set the public application URLs to the externally reachable HTTPS address;
- verify web, worker, and scheduler roles are healthy;
- test ingress, DNS, TLS, storage, and backup behavior independently of the application;
- run a synthetic incident after deployment to verify the entire path.

Use the [Deployment](../deployment) documentation for the specific profile and operational details.

## From source

Use a source install when developing OpsKnight or debugging application behavior.

Follow the repository's development prerequisites and environment example rather than treating a development server as a production deployment.

## Verify any installation

After startup, check the application health endpoint:

```bash
curl -s http://localhost:3000/api/health
```

Then create a synthetic incident. Infrastructure health alone does not prove that service ownership, escalation, event ingestion, and incident lifecycle behavior are configured correctly.

## Next step

Continue with [Getting Started](./README) and verify one complete incident lifecycle before adding optional integrations or production controls.
