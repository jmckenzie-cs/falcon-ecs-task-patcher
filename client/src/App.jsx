import { useState, useEffect, useCallback } from 'react';
import { fetchJobs, clearJobs } from './api.js';
import ConfigPanel from './components/ConfigPanel.jsx';
import DropZone from './components/DropZone.jsx';
import FilePatcher from './components/FilePatcher.jsx';
import JobTable from './components/JobTable.jsx';

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [tab, setTab] = useState('aws'); // 'aws' | 'file'

  const refreshJobs = useCallback(async () => {
    try {
      const data = await fetchJobs();
      setJobs(data);
    } catch {
      // ignore transient errors
    }
  }, []);

  useEffect(() => {
    refreshJobs();
    const id = setInterval(refreshJobs, 2000);
    return () => clearInterval(id);
  }, [refreshJobs]);

  const handleClear = async () => {
    await clearJobs();
    await refreshJobs();
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center font-bold text-sm">F</div>
          <h1 className="text-lg font-semibold">Falcon ECS Task Patcher</h1>
        </div>
        <button
          onClick={() => setConfigOpen(true)}
          className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition-colors"
        >
          Settings
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Mode tabs */}
        <div className="flex gap-1 border-b border-gray-800 pb-0">
          {[['aws', '☁ Patch via AWS'], ['file', '📄 Patch a file']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === key
                  ? 'border-red-500 text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'aws' && (
          <>
            <DropZone onSubmit={refreshJobs} />
            <JobTable jobs={jobs} onClear={handleClear} />
          </>
        )}

        {tab === 'file' && <FilePatcher />}
      </main>

      {configOpen && <ConfigPanel onClose={() => setConfigOpen(false)} />}
    </div>
  );
}

