# Falcon ECS Task Patcher

A local web app for batch-patching ECS task definitions with the CrowdStrike Falcon Container sensor. Registers new task definition revisions that include the Falcon init container alongside your existing application containers.

## How It Works

For each task definition you submit, the patcher:

1. Fetches the current task definition from ECS
2. Injects a `falcon-sensor` init container that installs the Falcon sensor into a shared volume
3. Mounts that shared volume into each existing container
4. Registers a new task definition revision with these changes
5. Copies any existing tags to the new revision

The patched task definition uses the [Falcon Container sidecar injection](https://falcon.crowdstrike.com/documentation) pattern: the init container populates `/opt/CrowdStrike` via a shared `falconshm` volume, and all other containers mount that volume read-only.

## Features

- Browse ECS clusters, services, and task definition families to find what to patch
- Drag & drop or type task definition ARNs to stage a batch
- Live log streaming per job via SSE
- Configurable concurrency (patch multiple task definitions in parallel)
- Idempotency check — refuses to re-patch a task definition that already contains the Falcon container

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) configured with credentials that have ECS read/write access:
  - `ecs:DescribeTaskDefinition`
  - `ecs:RegisterTaskDefinition`
  - `ecs:ListClusters`, `ecs:DescribeClusters`
  - `ecs:ListServices`, `ecs:DescribeServices`
  - `ecs:ListTaskDefinitionFamilies`, `ecs:ListTaskDefinitions`
  - `ecs:TagResource` (for tag copying)
- A CrowdStrike subscription with:
  - Falcon Client ID and Secret
  - Falcon CID (with checksum)
  - Falcon Container sensor image URI (see below)

## Install & Run

```bash
# Clone
git clone https://github.com/<your-username>/falcon-ecs-task-patcher.git
cd falcon-ecs-task-patcher

# Install dependencies
npm install && cd client && npm install && cd ..

# Start dev server
npm run dev
```

Open **http://localhost:5173** in your browser.

## Pull the Falcon sensor image

Before patching, you need the Falcon Container sensor image URI. Pull it with the official script:

```bash
curl -sSL -o falcon-container-sensor-pull.sh \
  "https://raw.githubusercontent.com/CrowdStrike/falcon-scripts/main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh"
chmod +x falcon-container-sensor-pull.sh

export FALCON_CLIENT_ID="<your-client-id>"
export FALCON_CLIENT_SECRET="<your-client-secret>"

# Apple Silicon (aarch64)
./falcon-container-sensor-pull.sh --type falcon-container --platform aarch64

# Intel (x86_64)
./falcon-container-sensor-pull.sh --type falcon-container --platform x86_64
```

The script prints the full image URI — copy it into the **Falcon Sensor Image URI** field in Settings.

## Configuration

Click **Settings** in the top-right corner. All settings are saved to `config.json` (gitignored).

| Field | Description |
|---|---|
| Falcon Client ID | OAuth2 client ID |
| Falcon Client Secret | OAuth2 client secret (redacted in UI after save) |
| Falcon CID | Customer ID with checksum (e.g. `ABC123...-AB`) |
| Falcon Sensor Image URI | Full URI of the Falcon Container sensor image |
| Falcon Container Name | Name for the injected init container (default: `falcon-sensor`) |
| falconctl Options | Optional extra flags passed as `FALCONCTL_OPTS` env var |
| AWS Region | AWS region for ECS API calls (default: `us-east-1`) |
| AWS Profile | Named AWS profile to use (leave blank for default credential chain) |
| Concurrency | Max parallel patch jobs (default: 3) |

## What Gets Patched

Given a task definition with containers `[web, worker]`, the patcher registers a new revision with:

```
containers:
  - name: falcon-sensor          # NEW — init container, essential: false
    image: <falcon-sensor-image>
    command: [falconctl, install]
    mountPoints:
      - sourceVolume: falconshm
        containerPath: /opt/CrowdStrike
    environment:
      - FALCONCTL_OPT_CID: <your-cid>

  - name: web                    # EXISTING — unchanged, plus:
    mountPoints:
      - sourceVolume: falconshm
        containerPath: /opt/CrowdStrike
        readOnly: true
    dependsOn:
      - containerName: falcon-sensor
        condition: COMPLETE

  - name: worker                 # EXISTING — same treatment
    ...

volumes:
  - name: falconshm              # NEW shared volume
```

## Job Lifecycle

```
pending → running → done
any stage → failed
```

## Production Build

```bash
cd client && npm run build && cd ..
NODE_ENV=production node server/index.js
```

Serves the app on **http://localhost:3001**.

## Notes

- `config.json` is gitignored — credentials are never committed
- The patcher calls the AWS CLI under the hood; ensure your credentials and region are configured
- Log output is color-coded: stderr in yellow, patcher messages in blue
- The original task definition revision is never modified — a new revision is always registered
