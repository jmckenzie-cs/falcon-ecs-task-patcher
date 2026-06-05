import { useState, useRef } from 'react';
import { patchTaskDefFile } from '../api.js';

export default function FilePatcher() {
  const [taskDef, setTaskDef] = useState(null);
  const [fileName, setFileName] = useState('');
  const [patched, setPatched] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    setPatched(null);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        // Accept either the raw taskDefinition object or the describe-task-definition wrapper
        const td = json.taskDefinition ?? json;
        if (!td.containerDefinitions) throw new Error('No containerDefinitions found');
        setTaskDef(td);
        setFileName(file.name);
      } catch (err) {
        setError(`Invalid JSON: ${err.message}`);
        setTaskDef(null);
        setFileName('');
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  };

  const handlePatch = async () => {
    if (!taskDef) return;
    setLoading(true);
    setError('');
    setPatched(null);
    try {
      const result = await patchTaskDefFile(taskDef);
      setPatched(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(patched, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = fileName.replace(/\.json$/i, '');
    a.href = url;
    a.download = `${base}-falcon.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setTaskDef(null);
    setFileName('');
    setPatched(null);
    setError('');
  };

  return (
    <div className="space-y-3">
      {/* Drop zone / file picker */}
      {!taskDef && (
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-gray-700 hover:border-gray-500 rounded-lg p-6 text-center cursor-pointer transition-colors"
        >
          <p className="text-sm text-gray-500">Drop a task definition JSON here, or click to browse</p>
          <p className="text-xs text-gray-600 mt-1">Accepts the output of <span className="font-mono">describe-task-definition</span> or a raw task def object</p>
          <input
            ref={inputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={e => handleFile(e.target.files[0])}
          />
        </div>
      )}

      {/* Loaded file */}
      {taskDef && !patched && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-mono text-gray-200 truncate">{fileName}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {taskDef.family && <span>family: <span className="text-gray-400">{taskDef.family}</span> · </span>}
              {taskDef.containerDefinitions.length} container{taskDef.containerDefinitions.length !== 1 ? 's' : ''}: <span className="text-gray-400">{taskDef.containerDefinitions.map(c => c.name).join(', ')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={reset} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Clear</button>
            <button
              onClick={handlePatch}
              disabled={loading}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded text-xs font-medium transition-colors"
            >
              {loading ? 'Patching...' : 'Patch file'}
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {patched && (
        <div className="bg-gray-900 border border-green-800 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-green-400 font-medium">Patched successfully</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {patched.containerDefinitions.length} containers: <span className="text-gray-400">{patched.containerDefinitions.map(c => c.name).join(', ')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={reset} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Clear</button>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-medium transition-colors"
            >
              Download JSON
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
