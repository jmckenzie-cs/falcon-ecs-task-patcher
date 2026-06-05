import { useState, useEffect, useCallback } from 'react';
import { fetchJobs, clearJobs, fetchSystemInfo } from './api.js';
import ConfigPanel from './components/ConfigPanel.jsx';
import DropZone from './components/DropZone.jsx';
import FilePatcher from './components/FilePatcher.jsx';
import JobTable from './components/JobTable.jsx';

function PlatformNotice({ platform, arch }) {
  if (arch === 'arm64' && platform === 'darwin') {
    return (
      <div className="bg-yellow-900/40 border border-yellow-700/60 rounded-lg px-4 py-3 text-sm text-yellow-300 flex items-start gap-3">
        <span className="mt-0.5 shrink-0">⚠</span>
        <span>
          <strong>Apple Silicon detected</strong> — the patching utility runs via amd64 emulation (Rosetta).
          Ensure your sensor image is pulled as <code className="font-mono bg-yellow-900/50 px-1 rounded">linux/amd64</code> and app container images are built for <code className="font-mono bg-yellow-900/50 px-1 rounded">linux/amd64</code>.
        </span>
      </div>
    );
  }
  if (platform === 'win32') {
    return (
      <div className="bg-yellow-900/40 border border-yellow-700/60 rounded-lg px-4 py-3 text-sm text-yellow-300 flex items-start gap-3">
        <span className="mt-0.5 shrink-0">⚠</span>
        <span>
          <strong>Windows detected</strong> — Docker Desktop with WSL2 is required. Ensure Docker is running and WSL2 integration is enabled. App container images must be built for <code className="font-mono bg-yellow-900/50 px-1 rounded">linux/amd64</code>.
        </span>
      </div>
    );
  }
  return null;
}

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [tab, setTab] = useState('aws'); // 'aws' | 'file'
  const [systemInfo, setSystemInfo] = useState(null);

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

  useEffect(() => {
    fetchSystemInfo().then(setSystemInfo).catch(() => {});
  }, []);

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
        {systemInfo && <PlatformNotice platform={systemInfo.platform} arch={systemInfo.arch} />}
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

