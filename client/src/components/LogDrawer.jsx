import { useState, useEffect, useRef } from 'react';
import { subscribeJobLogs } from '../api.js';

export default function LogDrawer({ jobId, isOpen }) {
  const [lines, setLines] = useState([]);
  const [done, setDone] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    setLines([]);
    setDone(false);

    const es = subscribeJobLogs(jobId);

    es.addEventListener('log', e => {
      try {
        const { line } = JSON.parse(e.data);
        setLines(prev => [...prev, line]);
      } catch {}
    });

    es.addEventListener('end', () => {
      setDone(true);
      es.close();
    });

    es.onerror = () => {
      setDone(true);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [jobId, isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="bg-gray-950 border border-gray-700 border-t-0 rounded-b-lg">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <span className="text-xs text-gray-500 font-mono">
          {lines.length} line{lines.length !== 1 ? 's' : ''}
        </span>
        {done && <span className="text-xs text-gray-600">stream closed</span>}
      </div>
      <div className="h-64 overflow-y-auto p-4 font-mono text-xs text-gray-300 leading-relaxed">
        {lines.length === 0 && !done && (
          <span className="text-gray-600">Waiting for output...</span>
        )}
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${
            line.startsWith('[stderr]') ? 'text-yellow-400' :
            line.startsWith('[patcher]') ? 'text-blue-400' :
            'text-gray-300'
          }`}>
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
