export async function detectFalconConfig(falconClientId, falconClientSecret, falconCloud) {
  const res = await fetch('/api/config/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ falconClientId, falconClientSecret, falconCloud }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Detection failed');
  return data;
}

export async function fetchConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('Failed to fetch config');
  return res.json();
}

export async function saveConfig(data) {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save config');
  return res.json();
}

export async function fetchJobs() {
  const res = await fetch('/api/jobs');
  if (!res.ok) throw new Error('Failed to fetch jobs');
  return res.json();
}

export async function submitJobs(taskDefArns) {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskDefArns }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to submit jobs');
  }
  return res.json();
}

export async function clearJobs() {
  const res = await fetch('/api/jobs', { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear jobs');
  return res.json();
}

export function subscribeJobLogs(jobId) {
  return new EventSource(`/api/jobs/${jobId}/logs`);
}

export async function fetchClusters() {
  const res = await fetch('/api/ecs/clusters');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch ECS clusters');
  }
  return res.json();
}

export async function fetchServices(clusterArn) {
  const res = await fetch(`/api/ecs/services?cluster=${encodeURIComponent(clusterArn)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch ECS services');
  }
  return res.json();
}

export async function fetchTaskDefinitionFamilies() {
  const res = await fetch('/api/ecs/task-definition-families');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch task definition families');
  }
  return res.json();
}

export async function fetchTaskDefinitions(family) {
  const res = await fetch(`/api/ecs/task-definitions?family=${encodeURIComponent(family)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch task definitions');
  }
  return res.json();
}

export async function patchTaskDefFile(taskDefinition) {
  const res = await fetch('/api/ecs/patch-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskDefinition }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to patch file');
  return data.patched;
}
