import express from 'express';
import os from 'os';
import { readConfig, writeConfig } from '../config.js';

const router = express.Router();

router.get('/system', (_req, res) => {
  const platform = os.platform(); // 'darwin' | 'linux' | 'win32'
  const arch = os.arch();         // 'arm64' | 'x64' | ...
  res.json({ platform, arch });
});

router.get('/', (_req, res) => {
  const cfg = readConfig();
  const safe = { ...cfg, falconClientSecret: cfg.falconClientSecret ? '***' : '' };
  res.json(safe);
});

router.post('/', express.json(), (req, res) => {
  try {
    const updated = writeConfig(req.body);
    const safe = { ...updated, falconClientSecret: updated.falconClientSecret ? '***' : '' };
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-detect CID and sensor image URI by invoking falcon-container-sensor-pull.sh.
router.post('/detect', express.json(), async (req, res) => {
  const { falconClientId, falconClientSecret, falconCloud } = req.body;
  if (!falconClientId || !falconClientSecret) {
    return res.status(400).json({ error: 'falconClientId and falconClientSecret are required' });
  }

  const { spawn } = await import('child_process');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pullScript = join(__dirname, '../../..', 'falcon-scripts-main/bash/containers/falcon-container-sensor-pull/falcon-container-sensor-pull.sh');

  const runScript = (extraArgs) => new Promise((resolve, reject) => {
    const args = [
      pullScript,
      '-u', falconClientId,
      '-s', falconClientSecret,
      '-t', 'falcon-sensor',
      ...extraArgs,
    ];
    const env = { ...process.env, FALCON_CLOUD: falconCloud || 'us-1' };
    const child = spawn('bash', args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => {
      if (code !== 0) reject(new Error(stderr.trim() || `Script exited with code ${code}`));
      else resolve(stdout.trim());
    });
    child.on('error', reject);
  });

  try {
    const [falconCid, falconSensorImage] = await Promise.all([
      runScript(['--get-cid']),
      runScript(['--get-image-path']),
    ]);

    if (!falconCid) throw new Error('Failed to retrieve CID from pull script');
    if (!falconSensorImage) throw new Error('Failed to retrieve image path from pull script');

    res.json({ falconCid, falconSensorImage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

