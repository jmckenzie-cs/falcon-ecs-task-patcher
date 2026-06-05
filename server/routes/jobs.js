import express from 'express';
import { getJobs, getJob, addJobs, clearFinished } from '../jobQueue.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(getJobs());
});

router.post('/', express.json(), (req, res) => {
  const { taskDefArns } = req.body;
  if (!Array.isArray(taskDefArns) || taskDefArns.length === 0) {
    return res.status(400).json({ error: 'taskDefArns must be a non-empty array' });
  }
  const created = addJobs(taskDefArns);
  res.status(201).json(created);
});

router.delete('/', (_req, res) => {
  clearFinished();
  res.json({ ok: true });
});

router.get('/:id/logs', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function send(event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client disconnected
    }
  }

  for (const line of job.logs) {
    send('log', { line });
  }

  send('status', { status: job.status });

  const terminal = ['done', 'failed'];
  if (terminal.includes(job.status)) {
    send('end', {});
    res.end();
    return;
  }

  const onLog = data => send('log', data);
  const onStatus = data => send('status', data);
  const onEnd = data => {
    send('end', data);
    res.end();
  };

  job.emitter.on('log', onLog);
  job.emitter.on('status', onStatus);
  job.emitter.on('end', onEnd);

  req.on('close', () => {
    job.emitter.removeListener('log', onLog);
    job.emitter.removeListener('status', onStatus);
    job.emitter.removeListener('end', onEnd);
  });
});

export default router;
