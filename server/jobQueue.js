import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { readConfig } from './config.js';
import { patchTaskDefinition } from './patcher.js';

const jobs = [];
let running = 0;

export function getJobs() {
  return jobs.map(serializeJob);
}

export function getJob(id) {
  return jobs.find(j => j.id === id) || null;
}

export function addJobs(taskDefArns) {
  const created = taskDefArns.map(taskDefArn => {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    const job = {
      id: uuidv4(),
      taskDefArn,
      newTaskDefArn: null,
      newRevision: null,
      status: 'pending',
      logs: [],
      emitter,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
    };
    jobs.push(job);
    return serializeJob(job);
  });
  return created;
}

export function clearFinished() {
  const terminal = ['done', 'failed'];
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (terminal.includes(jobs[i].status)) {
      jobs.splice(i, 1);
    }
  }
}

function tick() {
  const cfg = readConfig();
  const concurrency = cfg.concurrency || 3;
  const pending = jobs.filter(j => j.status === 'pending');
  for (const job of pending) {
    if (running >= concurrency) break;
    running++;
    startJob(job).finally(() => {
      running--;
    });
  }
}

async function startJob(job) {
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.emitter.emit('status', { status: 'running' });

  try {
    const cfg = readConfig();
    await patchTaskDefinition(job, cfg);

    job.status = 'done';
    job.finishedAt = new Date().toISOString();
    job.emitter.emit('status', { status: 'done' });
    job.emitter.emit('end', {});
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = new Date().toISOString();
    job.emitter.emit('status', { status: 'failed' });
    job.emitter.emit('end', {});
  }
}

function serializeJob(job) {
  const { emitter, ...rest } = job;
  return rest;
}

setInterval(tick, 500);

process.on('SIGTERM', () => {
  process.exit(0);
});
