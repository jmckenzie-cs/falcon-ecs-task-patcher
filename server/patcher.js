import { spawn } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const LOG_CAP = 10_000;

// Fields that must be stripped before passing a described task def to the patching utility
// or to register-task-definition (ECS rejects them as read-only).
const STRIP_FIELDS = [
  'taskDefinitionArn', 'revision', 'status', 'requiresAttributes',
  'compatibilities', 'registeredAt', 'registeredBy', 'tags',
];

export function appendLog(job, line) {
  if (job.logs.length >= LOG_CAP) job.logs.shift();
  job.logs.push(line);
  job.emitter.emit('log', { line });
}

// ── AWS CLI helpers ──────────────────────────────────────────────────────────

function spawnAws(args, cfg, raw = false) {
  const { awsRegion, awsProfile } = cfg;
  const fullArgs = raw ? [...args] : [...args, '--output', 'json'];
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
      } else if (raw) {
        resolve(stdout.trim());
      } else {
        try { resolve(stdout.trim() ? JSON.parse(stdout) : {}); }
        catch { reject(new Error(`Failed to parse AWS CLI output: ${stdout.slice(0, 200)}`)); }
      }
    });
    child.on('error', err => {
      reject(err.code === 'ENOENT'
        ? new Error('aws CLI not found — install the AWS CLI and ensure it is in your PATH')
        : err);
    });
  });
}

// ── ECR pull token ───────────────────────────────────────────────────────────

async function getEcrPullToken(cfg) {
  const registry = cfg.falconSensorImage.split('/')[0];
  if (!registry.includes('.dkr.ecr.')) return null;
  const password = await spawnAws(['ecr', 'get-login-password'], cfg, true);
  const auth = Buffer.from(`AWS:${password}`).toString('base64');
  const dockerConfig = JSON.stringify({ auths: { [registry]: { auth } } });
  return Buffer.from(dockerConfig).toString('base64');
}

// ── CrowdStrike patching utility (runs inside the sensor image via docker) ───

async function runPatchingUtility(taskDef, cfg, log = () => {}) {
  // Write sanitised task def to a temp dir that gets bind-mounted into the container
  const tmpDir = mkdtempSync(join(tmpdir(), 'falcon-patch-'));
  const specPath = join(tmpDir, 'taskdef.json');

  const sanitised = Object.fromEntries(
    Object.entries(taskDef).filter(([k]) => !STRIP_FIELDS.includes(k)),
  );
  writeFileSync(specPath, JSON.stringify(sanitised));

  // Build docker args
  const args = [
    'run', '--rm',
    '--platform', 'linux/amd64',
    '-v', `${tmpDir}:/var/run/spec`,
    cfg.falconSensorImage,
    '-cid', cfg.falconCid,
    '-image', cfg.falconSensorImage,
    '-ecs-spec-file', '/var/run/spec/taskdef.json',
  ];

  // Pull token lets the utility inspect private app-container images for their ENTRYPOINT/CMD
  try {
    const pullToken = await getEcrPullToken(cfg);
    if (pullToken) args.push('-pulltoken', pullToken);
  } catch { /* no token — public images will still work */ }

  if (cfg.falconctlOpts) args.push('--falconctl-opts', cfg.falconctlOpts);

  log(`[patcher] Running CrowdStrike patching utility (docker)...`);

  return new Promise((resolve, reject) => {
    const child = spawn('docker', args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => {
      stderr += d.toString();
      // Surface docker / utility progress to the job log
      d.toString().split('\n').filter(Boolean).forEach(line => log(`[docker] ${line}`));
    });
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Patching utility exited with code ${code}`));
      } else {
        try { resolve(JSON.parse(stdout.trim())); }
        catch { reject(new Error(`Patching utility produced invalid JSON: ${stdout.slice(0, 200)}`)); }
      }
    });
    child.on('error', err => {
      reject(err.code === 'ENOENT'
        ? new Error('docker not found — install Docker and ensure it is in your PATH')
        : err);
    });
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function patchTaskDefinition(job, cfg) {
  const { taskDefArn } = job;

  if (!cfg.falconSensorImage) throw new Error('Falcon Sensor Image URI is not configured.');
  if (!cfg.falconCid) throw new Error('Falcon CID is not configured.');

  appendLog(job, `[patcher] Describing task definition: ${taskDefArn}`);

  const describeResult = await spawnAws(
    ['ecs', 'describe-task-definition', '--task-definition', taskDefArn, '--include', 'TAGS'],
    cfg,
  );
  const original = describeResult.taskDefinition;
  const originalTags = describeResult.tags || [];

  appendLog(job, `[patcher] Family: ${original.family}, revision: ${original.revision}, containers: ${original.containerDefinitions.length}`);

  const alreadyPatched = original.containerDefinitions.some(c => c.name === 'crowdstrike-falcon-init-container');
  if (alreadyPatched) {
    throw new Error('Task definition is already patched (crowdstrike-falcon-init-container found).');
  }

  // Run the CrowdStrike patching utility — it outputs the patched register-task-definition JSON
  const patched = await runPatchingUtility(original, cfg, line => appendLog(job, line));

  appendLog(job, `[patcher] Registering new task definition revision...`);

  const tmpFile = join(tmpdir(), `falcon-ecs-register-${job.id}.json`);
  writeFileSync(tmpFile, JSON.stringify(patched));

  const registerResult = await spawnAws(
    ['ecs', 'register-task-definition', '--cli-input-json', `file://${tmpFile}`],
    cfg,
  );

  try { (await import('fs')).unlinkSync(tmpFile); } catch { /* ignore */ }

  const newTd = registerResult.taskDefinition;
  job.newTaskDefArn = newTd.taskDefinitionArn;
  job.newRevision = newTd.revision;

  appendLog(job, `[patcher] Registered: ${newTd.taskDefinitionArn}`);

  if (originalTags.length > 0) {
    appendLog(job, `[patcher] Copying ${originalTags.length} tag(s)...`);
    await spawnAws(
      ['ecs', 'tag-resource', '--resource-arn', newTd.taskDefinitionArn,
        '--tags', ...originalTags.map(t => `key=${t.key},value=${t.value}`)],
      cfg,
    );
  }

  appendLog(job, `[patcher] Patch complete. New ARN: ${newTd.taskDefinitionArn}`);
}

// Pure patch — no AWS calls. Used by the file-upload flow.
export async function applyPatch(taskDefinition, cfg) {
  if (!cfg.falconSensorImage) throw new Error('falconSensorImage not configured.');
  if (!cfg.falconCid) throw new Error('falconCid not configured.');

  const alreadyPatched = taskDefinition.containerDefinitions.some(c => c.name === 'crowdstrike-falcon-init-container');
  if (alreadyPatched) throw new Error('Task definition is already patched.');

  return runPatchingUtility(taskDefinition, cfg);
}
