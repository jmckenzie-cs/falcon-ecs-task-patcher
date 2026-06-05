import { useState, useRef } from 'react';
import { submitJobs } from '../api.js';
import EcsPicker from './EcsPicker.jsx';

export default function DropZone({ onSubmit }) {
  const [staged, setStaged] = useState([]);
  const [inputVal, setInputVal] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const addTaskDefs = raw => {
    const lines = Array.isArray(raw)
      ? raw
      : raw.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean);
    setStaged(prev => {
      const existing = new Set(prev);
      for (const arn of lines) existing.add(arn);
      return [...existing];
    });
  };

  const handleDragOver = e => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const handleDrop = e => {
    e.preventDefault();
    setDragging(false);
    const text = e.dataTransfer.getData('text');
    if (text) addTaskDefs(text);
  };

  const handleKeyDown = e => {
    if (e.key === 'Enter' && inputVal.trim()) {
      addTaskDefs(inputVal);
      setInputVal('');
    }
  };

  const handleAddClick = () => {
    if (inputVal.trim()) {
      addTaskDefs(inputVal);
      setInputVal('');
    }
  };

  const removeTaskDef = arn => {
    setStaged(prev => prev.filter(a => a !== arn));
  };

  const handleSubmit = async () => {
    if (staged.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      await submitJobs(staged);
      setStaged([]);
      onSubmit();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Add Task Definitions</h2>
        <button
          onClick={() => setPickerOpen(o => !o)}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            pickerOpen
              ? 'border-red-700 text-red-400 bg-red-950/30'
              : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-300'
          }`}
        >
          ☁ Browse ECS
        </button>
      </div>

      {/* ECS picker */}
      {pickerOpen && (
        <EcsPicker onAdd={arns => { addTaskDefs(arns); setPickerOpen(false); }} />
      )}

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.focus()}
        className={`border-2 border-dashed rounded-lg p-6 cursor-text transition-colors ${
          dragging ? 'border-red-500 bg-red-950/20' : 'border-gray-700 hover:border-gray-600'
        }`}
      >
        <p className="text-center text-gray-500 text-sm mb-4">
          Drag & drop task definition ARNs here, or type below
        </p>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. arn:aws:ecs:us-east-1:123456789:task-definition/my-app:42"
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-red-500 placeholder-gray-600"
          />
          <button
            onClick={handleAddClick}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      {/* Staged list */}
      {staged.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-700 flex items-center justify-between">
            <span className="text-sm text-gray-400">
              {staged.length} task def{staged.length !== 1 ? 's' : ''} staged
            </span>
            <button
              onClick={() => setStaged([])}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Clear all
            </button>
          </div>
          <ul className="divide-y divide-gray-800 max-h-48 overflow-y-auto">
            {staged.map(arn => (
              <li key={arn} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono text-gray-300 truncate">{arn}</span>
                <button
                  onClick={() => removeTaskDef(arn)}
                  className="text-gray-600 hover:text-red-400 ml-4 text-xs shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-end gap-4">
            {error && <span className="text-red-400 text-xs">{error}</span>}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
            >
              {submitting ? 'Submitting...' : `Patch ${staged.length} task def${staged.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
