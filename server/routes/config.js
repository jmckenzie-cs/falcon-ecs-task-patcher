import express from 'express';
import { readConfig, writeConfig } from '../config.js';

const router = express.Router();

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

// Auto-detect CID and sensor image URI from Falcon API credentials.
// Uses the same logic as falcon-container-sensor-pull.sh.
router.post('/detect', express.json(), async (req, res) => {
  const { falconClientId, falconClientSecret } = req.body;
  if (!falconClientId || !falconClientSecret) {
    return res.status(400).json({ error: 'falconClientId and falconClientSecret are required' });
  }

  try {
    // 1. Get OAuth token
    const tokenRes = await fetch('https://api.crowdstrike.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${encodeURIComponent(falconClientId)}&client_secret=${encodeURIComponent(falconClientSecret)}&grant_type=client_credentials`,
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(tokenData.errors?.[0]?.message || 'Failed to authenticate with CrowdStrike API');
    }
    const accessToken = tokenData.access_token;

    // 2. Get CID (with checksum)
    const cidRes = await fetch('https://api.crowdstrike.com/sensors/queries/installers/ccid/v1', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const cidData = await cidRes.json();
    if (!cidRes.ok) {
      throw new Error(cidData.errors?.[0]?.message || 'Failed to retrieve CID — ensure Sensor Download read scope is assigned');
    }
    const falconCid = cidData.resources?.[0];

    // 3. Get registry credentials
    const credsRes = await fetch('https://api.crowdstrike.com/container-security/entities/image-registry-credentials/v1', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const credsData = await credsRes.json();
    if (!credsRes.ok) {
      throw new Error(credsData.errors?.[0]?.message || 'Failed to retrieve registry credentials — ensure Falcon Images Download read scope is assigned');
    }
    const artPassword = credsData.resources?.[0]?.token;
    // ART_USERNAME mirrors the pull script: fc-<cid-lowercase-no-checksum>
    const artUsername = `fc-${falconCid.split('-')[0].toLowerCase()}`;

    // 4. Get registry bearer token for falcon-container/release/falcon-sensor
    const scope = 'repository:falcon-container/release/falcon-sensor:pull';
    const regTokenRes = await fetch(
      `https://registry.crowdstrike.com/v2/token?account=${encodeURIComponent(artUsername)}&scope=${encodeURIComponent(scope)}&service=registry.crowdstrike.com`,
      { headers: { Authorization: `Basic ${Buffer.from(`${artUsername}:${artPassword}`).toString('base64')}` } },
    );
    const regTokenData = await regTokenRes.json();
    const registryToken = regTokenData.token;

    // 5. Get tags and pick latest semver
    const tagsRes = await fetch('https://registry.crowdstrike.com/v2/falcon-container/release/falcon-sensor/tags/list', {
      headers: { Authorization: `Bearer ${registryToken}` },
    });
    const tagsData = await tagsRes.json();
    const tags = (tagsData.tags || []).filter(t => /^\d/.test(t)).sort().reverse();
    const latestTag = tags[0];

    if (!latestTag) throw new Error('No sensor tags found in registry');

    const falconSensorImage = `registry.crowdstrike.com/falcon-container/release/falcon-sensor:${latestTag}`;

    res.json({ falconCid, falconSensorImage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

