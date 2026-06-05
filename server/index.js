import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import configRouter from './routes/config.js';
import jobsRouter from './routes/jobs.js';
import ecsRouter from './routes/ecs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

app.use('/api/config', configRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/ecs', ecsRouter);

if (isProd) {
  const distPath = join(__dirname, '..', 'client', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Falcon ECS Task Patcher server running on http://localhost:${PORT}`);
  if (!isProd) {
    console.log('Frontend dev server: http://localhost:5173');
  }
});
