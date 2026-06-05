import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, '..', 'config.json');

const DEFAULTS = {
  falconClientId: '',
  falconClientSecret: '',
  falconCid: '',
  falconSensorImage: '',
  falconctlOpts: '',
  containerName: 'falcon-sensor',
  concurrency: 3,
  awsRegion: 'us-east-1',
  awsProfile: '',
};

export function readConfig() {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
    return { ...DEFAULTS };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(updates) {
  const current = readConfig();
  const merged = { ...current };
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'falconClientSecret' && v === '***') continue;
    merged[k] = v;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}
