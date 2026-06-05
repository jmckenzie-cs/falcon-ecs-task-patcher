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

  // Build Falcon init container definition
  const falconContainer = buildFalconContainer(cfg, original);
  appendLog(job, `[patcher] Injecting Falcon container: ${falconContainer.name} (image: ${falconContainer.image})`);

  // Build updated container definitions — inject Falcon first
  const updatedContainers = [falconContainer, ...original.containerDefinitions.map(c => injectFalconVolume(c, cfg))];

  // Build new task definition request
  const registerInput = buildRegisterInput(original, updatedContainers, cfg);

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
  const falconContainer = buildFalconContainer(cfg, taskDefinition);
  const updatedContainers = [falconContainer, ...taskDefinition.containerDefinitions.map(c => injectFalconVolume(c, cfg))];
  return buildRegisterInput(taskDefinition, updatedContainers, cfg);
}

function buildFalconContainer(cfg, original) {
  // Determine shared memory volume name
  const volumeName = 'falconshm';

  const container = {
    name: cfg.containerName || 'falcon-sensor',
    image: cfg.falconSensorImage,
    essential: false,
    user: '0:0',
    environment: [],
    mountPoints: [
      {
        sourceVolume: volumeName,
        containerPath: '/opt/CrowdStrike',
        readOnly: false,
      },
    ],
    command: ['falconctl', 'install'],
  };

  if (cfg.falconCid) {
    container.environment.push({ name: 'FALCONCTL_OPT_CID', value: cfg.falconCid });
  }

  if (cfg.falconctlOpts) {
    container.environment.push({ name: 'FALCONCTL_OPTS', value: cfg.falconctlOpts });
  }

  return container;
}

function injectFalconVolume(container, cfg) {
  const volumeName = 'falconshm';
  const updated = { ...container };

  updated.mountPoints = [
    ...(container.mountPoints || []),
    {
      sourceVolume: volumeName,
      containerPath: '/opt/CrowdStrike',
      readOnly: true,
    },
  ];

  // Add depends-on so app containers wait for the sensor init to complete
  updated.dependsOn = [
    ...(container.dependsOn || []),
    {
      containerName: cfg.containerName || 'falcon-sensor',
      condition: 'COMPLETE',
    },
  ];

  return updated;
}

function buildRegisterInput(original, updatedContainers, cfg) {
  const volumeName = 'falconshm';

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

  // Add the shared volume
  input.volumes = [
    ...(original.volumes || []).filter(v => v.name !== volumeName),
    { name: volumeName },
  ];

  return input;
}
