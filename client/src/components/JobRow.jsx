import { useState } from 'react';
import LogDrawer from './LogDrawer.jsx';

const STATUS_COLORS = {
  pending: 'bg-gray-600 text-gray-200',
  running: 'bg-blue-600 text-white',
  done: 'bg-green-600 text-white',
  failed: 'bg-red-600 text-white',
};

const STATUS_LABELS = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

export default function JobRow({ job }) {
  const [logsOpen, setLogsOpen] = useState(false);

  const colorClass = STATUS_COLORS[job.status] || 'bg-gray-700 text-gray-200';
  const label = STATUS_LABELS[job.status] || job.status;
  const isActive = job.status === 'running';

  // Extract short name from ARN: family:revision
  const shortName = job.taskDefArn
    ? job.taskDefArn.split('/').pop()
    : job.taskDefArn;

  const newShortName = job.newTaskDefArn
    ? job.newTaskDefArn.split('/').pop()
    : null;

  return (
    <>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 flex items-center gap-4 cursor-pointer hover:border-gray-600 transition-colors"
        onClick={() => setLogsOpen(o => !o)}
      >
        {/* Status badge */}
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium shrink-0 ${colorClass}`}>
          {isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          )}
          {label}
        </span>

        {/* Task def names */}
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm text-gray-200 truncate">{shortName}</div>
          {newShortName && (
            <div className="font-mono text-xs text-gray-500 truncate">&rarr; {newShortName}</div>
          )}
        </div>

        {/* Error snippet */}
        {job.error && (
          <span className="text-xs text-red-400 truncate max-w-xs" title={job.error}>
            {job.error}
          </span>
        )}

        {/* Log toggle */}
        <span className="text-gray-600 text-xs shrink-0">{logsOpen ? '▲' : '▼'} logs</span>
      </div>

      {logsOpen && <LogDrawer jobId={job.id} isOpen={logsOpen} />}
    </>
  );
}
