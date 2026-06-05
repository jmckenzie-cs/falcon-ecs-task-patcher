import express from 'express';
import { spawn } from 'child_process';
import { readConfig } from '../config.js';
import { applyPatch } from '../patcher.js';

const router = express.Router();

function buildArgs(base, cfg) {
  const { awsRegion, awsProfile } = cfg;
  const args = [...base, '--region', awsRegion, '--output', 'json'];
  if (awsProfile) args.push('--profile', awsProfile);
  return args;
}

function spawnAws(args, res, onSuccess) {
  const child = spawn('aws', args);
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  child.on('close', code => {
    if (code !== 0) {
      return res.status(500).json({ error: stderr.trim() || 'aws CLI command failed' });
    }
    try {
      onSuccess(JSON.parse(stdout));
    } catch {
      res.status(500).json({ error: 'Failed to parse AWS CLI output' });
    }
  });

  child.on('error', err => {
    if (err.code === 'ENOENT') {
      res.status(500).json({ error: 'aws CLI not found — install the AWS CLI and ensure it is in your PATH' });
    } else {
      res.status(500).json({ error: err.message });
    }
  });
}

// List ECS clusters
router.get('/clusters', (req, res) => {
  const cfg = readConfig();
  const listArgs = buildArgs(['ecs', 'list-clusters'], cfg);

  spawnAws(listArgs, res, listData => {
    const arns = listData.clusterArns || [];
    if (arns.length === 0) return res.json([]);

    const describeArgs = buildArgs(['ecs', 'describe-clusters', '--clusters', ...arns], cfg);
    spawnAws(describeArgs, res, describeData => {
      const clusters = (describeData.clusters || []).map(c => ({
        name: c.clusterName,
        arn: c.clusterArn,
        status: c.status,
        activeServicesCount: c.activeServicesCount,
        runningTasksCount: c.runningTasksCount,
      }));
      res.json(clusters);
    });
  });
});

// List services in a cluster
router.get('/services', (req, res) => {
  const clusterArn = req.query.cluster;
  if (!clusterArn) return res.status(400).json({ error: 'cluster query parameter is required' });

  const cfg = readConfig();
  const listArgs = buildArgs(['ecs', 'list-services', '--cluster', clusterArn], cfg);

  spawnAws(listArgs, res, listData => {
    const arns = listData.serviceArns || [];
    if (arns.length === 0) return res.json([]);

    const describeArgs = buildArgs(
      ['ecs', 'describe-services', '--cluster', clusterArn, '--services', ...arns],
      cfg,
    );
    spawnAws(describeArgs, res, describeData => {
      const services = (describeData.services || []).map(s => ({
        name: s.serviceName,
        arn: s.serviceArn,
        taskDefinition: s.taskDefinition,
        status: s.status,
        runningCount: s.runningCount,
        desiredCount: s.desiredCount,
      }));
      res.json(services);
    });
  });
});

// List task definition families
router.get('/task-definition-families', (req, res) => {
  const cfg = readConfig();
  const args = buildArgs(['ecs', 'list-task-definition-families', '--status', 'ACTIVE'], cfg);

  spawnAws(args, res, data => {
    res.json(data.families || []);
  });
});

// List revisions for a task definition family
router.get('/task-definitions', (req, res) => {
  const family = req.query.family;
  if (!family) return res.status(400).json({ error: 'family query parameter is required' });

  const cfg = readConfig();
  const args = buildArgs(
    ['ecs', 'list-task-definitions', '--family-prefix', family, '--status', 'ACTIVE', '--sort', 'DESC'],
    cfg,
  );

  spawnAws(args, res, listData => {
    const arns = (listData.taskDefinitionArns || []).slice(0, 20); // cap at 20
    if (arns.length === 0) return res.json([]);

    // Describe the latest revision for metadata
    const describeArgs = buildArgs(
      ['ecs', 'describe-task-definition', '--task-definition', arns[0]],
      cfg,
    );
    spawnAws(describeArgs, res, describeData => {
      const td = describeData.taskDefinition;
      res.json(arns.map(arn => ({
        arn,
        family: td.family,
        revision: Number(arn.split(':').pop()),
        containers: td.containerDefinitions.map(c => c.name),
      })));
    });
  });
});

// Patch a task definition JSON file in-memory — no AWS credentials needed.
// Accepts: { taskDefinition: { ... } }  (the object from describe-task-definition)
// Returns: the patched register-task-definition input as JSON for download.
router.post('/patch-file', express.json({ limit: '1mb' }), (req, res) => {
  const { taskDefinition } = req.body;
  if (!taskDefinition || !taskDefinition.containerDefinitions) {
    return res.status(400).json({ error: 'Request body must contain a taskDefinition object with containerDefinitions' });
  }
  const cfg = readConfig();
  if (!cfg.falconSensorImage) {
    return res.status(400).json({ error: 'falconSensorImage not configured — open Settings and set the Falcon Sensor Image URI' });
  }
  try {
    const patched = applyPatch(taskDefinition, cfg);
    res.json({ patched });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

export default router;
