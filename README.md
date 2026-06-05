# Falcon ECS Task Patcher

A local web app for batch-patching ECS task definitions with the CrowdStrike Falcon Container sensor. Registers new task definition revisions that include the Falcon init container alongside your existing application containers.

## How It Works

For each task definition you submit, the patcher:

1. Fetches the current task definition from ECS
2. Injects a `falcon-sensor` init container that installs the Falcon sensor into a shared volume
3. Mounts that shared volume into each existing container
4. Registers a new task definition revision with these changes
5. Copies any existing tags to the new revision

The patched task definition uses the [Falcon Container sidecar injection](https://falcon.crowdstrike.com/documentation) pattern: the init container copies Falcon binaries into a shared `crowdstrike-falcon-volume` at `/tmp/CrowdStrike`, and all other containers mount that volume read-only and run via a wrapped entrypoint.

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
  - name: crowdstrike-falcon-init-container   # NEW — copies Falcon binaries, exits 0
    image: <falcon-sensor-image>
    essential: false
    entryPoint: [copy binaries to /tmp/CrowdStrike, set permissions]
    mountPoints:
      - sourceVolume: crowdstrike-falcon-volume
        containerPath: /tmp/CrowdStrike

  - name: web                                 # EXISTING — modified in-place
    dependsOn:
      - containerName: crowdstrike-falcon-init-container
        condition: COMPLETE
    entryPoint:
      - /tmp/CrowdStrike/rootfs/lib64/ld-linux-x86-64.so.2  # Falcon wrapper
      - ...
      - /tmp/CrowdStrike/rootfs/entrypoint-ecs.sh
      - <original-entrypoint>                               # preserved
    environment:
      - FALCONCTL_OPTS: --cid=<your-cid>
    linuxParameters:
      capabilities:
        add: [SYS_PTRACE]
    mountPoints:
      - sourceVolume: crowdstrike-falcon-volume
        containerPath: /tmp/CrowdStrike
        readOnly: true

  - name: worker                              # EXISTING — same treatment
    ...

volumes:
  - name: crowdstrike-falcon-volume           # NEW shared ephemeral volume
```

### readonlyRootFilesystem support

If any app container has `readonlyRootFilesystem: true`, the patching utility automatically detects this and injects additional per-container writable mounts so the Falcon sensor can write to `/tmp/CrowdStrike-private` at runtime:

```
  - name: web
    mountPoints:
      - sourceVolume: crowdstrike-falcon-volume
        containerPath: /tmp/CrowdStrike
        readOnly: true
      - sourceVolume: crowdstrike-private-web    # NEW — ReadOnly-specific
        containerPath: /tmp/CrowdStrike-private
        readOnly: false

volumes:
  - name: crowdstrike-falcon-volume
  - name: crowdstrike-private-web               # NEW — per-container ephemeral
```

See [`examples/readonly-pre-patch.json`](examples/readonly-pre-patch.json) and [`examples/readonly-post-patch.json`](examples/readonly-post-patch.json) for a complete before/after reference.

## Examples

The [`examples/`](examples/) directory contains reference task definitions showing the before and after state for a container with `readonlyRootFilesystem: true`:

| File | Description |
|---|---|
| [`readonly-pre-patch.json`](examples/readonly-pre-patch.json) | Task definition before patching — app container with `readonlyRootFilesystem: true` and app-specific writable mounts |
| [`readonly-post-patch.json`](examples/readonly-post-patch.json) | Task definition after patching — Falcon init container, entrypoint wrapping, `SYS_PTRACE`, and the additional `crowdstrike-private-<container>` volume for the readonly filesystem case |

All account IDs, CIDs, and image URIs are replaced with placeholders (e.g. `<AWS_ACCOUNT_ID>`, `<FALCON_CID>`).



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
