import JobRow from './JobRow.jsx';

export default function JobTable({ jobs, onClear }) {
  const hasFinished = jobs.some(j => j.status === 'done' || j.status === 'failed');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
          Jobs {jobs.length > 0 && <span className="text-gray-600 normal-case">({jobs.length})</span>}
        </h2>
        {hasFinished && (
          <button
            onClick={onClear}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear finished
          </button>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-12 text-gray-600 text-sm border border-gray-800 rounded-lg">
          No jobs yet. Add task definitions above to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
