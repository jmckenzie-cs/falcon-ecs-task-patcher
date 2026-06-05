import { useState, useEffect } from 'react';
import { fetchConfig, saveConfig } from '../api.js';

const FIELDS = [
  { key: 'falconClientId', label: 'Falcon Client ID', type: 'text' },
  { key: 'falconClientSecret', label: 'Falcon Client Secret', type: 'password' },
  { key: 'falconCid', label: 'Falcon CID', type: 'text', placeholder: 'ABC123...-AB' },
  { key: 'falconSensorImage', label: 'Falcon Sensor Image URI', type: 'text', placeholder: 'registry.crowdstrike.com/falcon-sensor/...' },
  { key: 'containerName', label: 'Falcon Container Name', type: 'text', placeholder: 'falcon-sensor' },
  { key: 'falconctlOpts', label: 'falconctl Options', type: 'text', placeholder: 'Optional extra flags' },
  { key: 'awsRegion', label: 'AWS Region', type: 'text', placeholder: 'us-east-1' },
  { key: 'awsProfile', label: 'AWS Profile', type: 'text', placeholder: 'leave blank for default' },
  { key: 'concurrency', label: 'Concurrency', type: 'number' },
];

export default function ConfigPanel({ onClose }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchConfig().then(cfg => setForm(cfg)).catch(() => {});
  }, []);

  const handleChange = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await saveConfig(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-md bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="font-semibold text-base">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {FIELDS.map(({ key, label, type, placeholder }) => (
            <div key={key}>
              <label className="block text-sm text-gray-400 mb-1">{label}</label>
              <input
                type={type}
                value={form[key] ?? ''}
                placeholder={placeholder}
                onChange={e => handleChange(key, type === 'number' ? Number(e.target.value) : e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-red-500 placeholder-gray-600"
              />
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-gray-700 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {saved && <span className="text-green-400 text-sm">Saved!</span>}
          {error && <span className="text-red-400 text-sm">{error}</span>}
        </div>
      </div>
    </div>
  );
}
