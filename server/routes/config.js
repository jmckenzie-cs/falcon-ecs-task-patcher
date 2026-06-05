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

export default router;
