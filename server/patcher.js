import { spawn } from 'child_process';
import { readConfig } from './config.js';

const LOG_CAP = 10_000;

export function appendLog(job, line) {
  if (job.logs.length >= LOG_CAP) {
    job.logs.shift();
  }
  job.logs.push(line);
  job.emitter.emit('log', { line });
}

function spawnAws(args, cfg) {
  const { awsRegion, awsProfile } = cfg;
  const fullArgs = [...args, '--output', 'json'];
  if (awsRegion) fullArgs.push('--region', awsRegion);
  if (awsProfile) fullArgs.push('--profile', awsProfile);

  return new Promise((resolve, reject) => {
    const child = spawn('aws', fullArgs);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `aws CLI exited with code ${code}`));
      } else {
        try {
          resolve(stdout.trim() ? JSON.parse(stdout) : {});
        } catch {
          reject(new Error(`Failed to parse AWS CLI output: ${stdout.slice(0, 200)}`));
        }
      }
    });

    child.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error('aws CLI not found — install the AWS CLI and ensure it is in your PATH'));
      } else {
        reject(err);
      }
    });
  });
}

export async function patchTaskDefinition(job, cfg) {
  const { taskDefArn } = job;

  if (!cfg.falconSensorImage) {
    throw new Error('Falcon Sensor Image URI is not configured — open Settings and set it before patching.');
  }
  if (!cfg.falconCid) {
    throw new Error('Falcon CID is not configured — open Settings and set it before patching.');
  }

  appendLog(job, `[patcher] Describing task definition: ${taskDefArn}`);

  // Fetch current task definition
  const describeResult = await spawnAws(
    ['ecs', 'describe-task-definition', '--task-definition', taskDefArn, '--include', 'TAGS'],
    cfg,
  );

  const original = describeResult.taskDefinition;
  const originalTags = describeResult.tags || [];

  appendLog(job, `[patcher] Found task definition family: ${original.family}, revision: ${original.revision}`);
  appendLog(job, `[patcher] Container count: ${original.containerDefinitions.length}`);

  // Check if already patched
  const alreadyPatched = original.containerDefinitions.some(
    c => c.name === cfg.containerName,
  );
  if (alreadyPatched) {
    throw new Error(`Task definition already contains a container named "${cfg.containerName}". Deregister the existing patched revision first.`);
  }

  const needsTmpVolumes = original.containerDefinitions.some(c => c.readonlyRootFilesystem === true);
  if (needsTmpVolumes) {
    appendLog(job, `[patcher] Detected readonlyRootFilesystem — injecting writable /tmp mounts for Falcon sensor`);
  }

  // Build Falcon sidecar container definition
  const falconContainer = buildFalconContainer(cfg, original, needsTmpVolumes);
  appendLog(job, `[patcher] Injecting Falcon container: ${falconContainer.name} (image: ${falconContainer.image})`);

  // Build updated container definitions — inject Falcon first
  const updatedContainers = [falconContainer, ...original.containerDefinitions.map(c => injectFalconVolume(c, cfg, needsTmpVolumes))];

  // Build new task definition request
  const registerInput = buildRegisterInput(original, updatedContainers, cfg, needsTmpVolumes);

  appendLog(job, `[patcher] Registering new task definition revision...`);

  // Write register input to a temp file to avoid shell escaping issues
  const { writeFileSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const tmpFile = join(tmpdir(), `falcon-ecs-patch-${job.id}.json`);
  writeFileSync(tmpFile, JSON.stringify(registerInput));

  const registerResult = await spawnAws(
    ['ecs', 'register-task-definition', '--cli-input-json', `file://${tmpFile}`],
    cfg,
  );

  // Clean up temp file
  try {
    const { unlinkSync } = await import('fs');
    unlinkSync(tmpFile);
  } catch { /* ignore */ }

  const newTd = registerResult.taskDefinition;
  job.newTaskDefArn = `${newTd.taskDefinitionArn}`;
  job.newRevision = newTd.revision;

  appendLog(job, `[patcher] Registered: ${newTd.taskDefinitionArn}`);

  // Re-apply tags if present
  if (originalTags.length > 0) {
    appendLog(job, `[patcher] Copying ${originalTags.length} tag(s) to new revision...`);
    await spawnAws(
      ['ecs', 'tag-resource', '--resource-arn', newTd.taskDefinitionArn,
        '--tags', ...originalTags.map(t => `key=${t.key},value=${t.value}`)],
      cfg,
    );
  }

  appendLog(job, `[patcher] Patch complete. New ARN: ${newTd.taskDefinitionArn}`);
}

// Pure patch — works on a plain task definition object, no AWS calls.
// Returns the register-task-definition input object (patched task def).
export function applyPatch(taskDefinition, cfg) {
  const alreadyPatched = taskDefinition.containerDefinitions.some(
    c => c.name === (cfg.containerName || 'falcon-sensor'),
  );
  if (alreadyPatched) {
    throw new Error(`Task definition already contains a container named "${cfg.containerName || 'falcon-sensor'}".`);
  }
  const needsTmpVolumes = taskDefinition.containerDefinitions.some(c => c.readonlyRootFilesystem === true);
  const falconContainer = buildFalconContainer(cfg, taskDefinition, needsTmpVolumes);
  const updatedContainers = [falconContainer, ...taskDefinition.containerDefinitions.map(c => injectFalconVolume(c, cfg, needsTmpVolumes))];
  return buildRegisterInput(taskDefinition, updatedContainers, cfg, needsTmpVolumes);
}

function buildFalconContainer(cfg, original, needsTmpVolumes) {
  // The Falcon container sensor runs as a persistent sidecar via /entrypoint.sh.
  // It does not use an init-container pattern — no command override, no shared volume.
  const container = {
    name: cfg.containerName || 'falcon-sensor',
    image: cfg.falconSensorImage,
    essential: false,
    user: '0:0',
    environment: [],
  };

  if (cfg.falconCid) {
    container.environment.push({ name: 'FALCONCTL_OPT_CID', value: cfg.falconCid });
  }

  if (cfg.falconctlOpts) {
    container.environment.push({ name: 'FALCONCTL_OPT_OPTS', value: cfg.falconctlOpts });
  }

  // When app containers use readonlyRootFilesystem, mount writable ephemeral volumes
  // for the paths the Falcon sensor writes to at runtime.
  if (needsTmpVolumes) {
    container.mountPoints = [
      { sourceVolume: 'falcon-tmp-private', containerPath: '/tmp/CrowdStrike-private', readOnly: false },
      { sourceVolume: 'falcon-tmp',         containerPath: '/tmp/CrowdStrike',         readOnly: false },
    ];
  }

  return container;
}

function injectFalconVolume(container, cfg, needsTmpVolumes) {
  const updated = { ...container };

  // Add depends-on so app containers wait for the sensor sidecar to start
  updated.dependsOn = [
    ...(container.dependsOn || []),
    {
      containerName: cfg.containerName || 'falcon-sensor',
      condition: 'START',
    },
  ];

  // For containers with a read-only root filesystem, punch writable mounts through
  // for the specific paths the Falcon sensor needs at runtime.
  if (needsTmpVolumes && container.readonlyRootFilesystem) {
    updated.mountPoints = [
      ...(container.mountPoints || []),
      { sourceVolume: 'falcon-tmp-private', containerPath: '/tmp/CrowdStrike-private', readOnly: false },
      { sourceVolume: 'falcon-tmp',         containerPath: '/tmp/CrowdStrike',         readOnly: false },
    ];
  }

  return updated;
}

function buildRegisterInput(original, updatedContainers, cfg, needsTmpVolumes) {
  // Copy fields that are valid for register-task-definition
  const allowed = [
    'family',
    'taskRoleArn',
    'executionRoleArn',
    'networkMode',
    'cpu',
    'memory',
    'requiresCompatibilities',
    'pidMode',
    'ipcMode',
    'proxyConfiguration',
    'inferenceAccelerators',
    'ephemeralStorage',
    'runtimePlatform',
  ];

  const input = {};
  for (const key of allowed) {
    if (original[key] !== undefined && original[key] !== null) {
      input[key] = original[key];
    }
  }

  input.containerDefinitions = updatedContainers;

  // Build volumes list — preserve originals, add ephemeral tmp volumes if needed
  const originalVolumes = (original.volumes || []);
  if (needsTmpVolumes) {
    input.volumes = [
      ...originalVolumes.filter(v => v.name !== 'falcon-tmp-private' && v.name !== 'falcon-tmp'),
      { name: 'falcon-tmp-private' },
      { name: 'falcon-tmp' },
    ];
  } else if (originalVolumes.length > 0) {
    input.volumes = originalVolumes;
  }

  return input;
}
