import { useState, useEffect } from 'react';
import { fetchClusters, fetchServices, fetchTaskDefinitions } from '../api.js';

export default function EcsPicker({ onAdd }) {
  // view: 'families' | 'revisions' | 'clusters' | 'services'
  const [view, setView] = useState('families');
  const [families, setFamilies] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedFamily, setSelectedFamily] = useState(null);
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());

  const loadFamilies = async () => {
    setLoading(true);
    setError('');
    try {
      const { fetchTaskDefinitionFamilies } = await import('../api.js');
      const data = await fetchTaskDefinitionFamilies();
      setFamilies(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadRevisions = async (family) => {
    setLoading(true);
    setError('');
    setRevisions([]);
    setSelected(new Set());
    try {
      const data = await fetchTaskDefinitions(family);
      setRevisions(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadClusters = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchClusters();
      setClusters(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadServices = async (cluster) => {
    setLoading(true);
    setError('');
    setServices([]);
    setSelected(new Set());
    try {
      const data = await fetchServices(cluster.arn);
      setServices(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'families') loadFamilies();
    if (view === 'clusters') loadClusters();
  }, [view]);

  const handleFamilyClick = (family) => {
    setSelectedFamily(family);
    setSearch('');
    setView('revisions');
    loadRevisions(family);
  };

  const handleClusterClick = (cluster) => {
    setSelectedCluster(cluster);
    setSearch('');
    setView('services');
    loadServices(cluster);
  };

  const handleBack = () => {
    if (view === 'revisions') { setView('families'); setSearch(''); setSelectedFamily(null); setSelected(new Set()); }
    if (view === 'services') { setView('clusters'); setSearch(''); setSelectedCluster(null); setSelected(new Set()); }
  };

  const toggle = (arn) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(arn) ? next.delete(arn) : next.add(arn);
      return next;
    });
  };

  const toggleAllRevisions = () => {
    const filtered = revisions.filter(r => r.arn.toLowerCase().includes(search.toLowerCase()));
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(r => r.arn)));
    }
  };

  const toggleAllServices = () => {
    const filtered = services.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(s => s.taskDefinition)));
    }
  };

  const handleAdd = () => {
    if (selected.size === 0) return;
    onAdd([...selected]);
    setSelected(new Set());
  };

  const filteredFamilies = families.filter(f => f.toLowerCase().includes(search.toLowerCase()));
  const filteredRevisions = revisions.filter(r => r.arn.toLowerCase().includes(search.toLowerCase()));
  const filteredClusters = clusters.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredServices = services.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  const browseLabel = view === 'families' || view === 'revisions' ? 'Task Families' : 'Clusters';
  const altBrowse = view === 'families' || view === 'revisions' ? 'clusters' : 'families';
  const altBrowseLabel = altBrowse === 'clusters' ? 'Clusters' : 'Task Families';

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        {(view === 'revisions' || view === 'services') && (
          <button
            onClick={handleBack}
            className="text-xs text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-800 transition-colors"
          >
            ← Back
          </button>
        )}
        {view === 'revisions' && selectedFamily && (
          <span className="text-xs text-gray-500 truncate max-w-[120px]" title={selectedFamily}>{selectedFamily}</span>
        )}
        {view === 'services' && selectedCluster && (
          <span className="text-xs text-gray-500 truncate max-w-[120px]" title={selectedCluster.name}>{selectedCluster.name}</span>
        )}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={
            view === 'families' ? 'Filter families...' :
            view === 'revisions' ? 'Filter revisions...' :
            view === 'clusters' ? 'Filter clusters...' :
            'Filter services...'
          }
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-red-500 placeholder-gray-600"
        />
        {(view === 'families' || view === 'clusters') && (
          <button
            onClick={() => setView(altBrowse === 'clusters' ? 'clusters' : 'families')}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 bg-gray-800 border border-gray-700 rounded transition-colors whitespace-nowrap"
          >
            {altBrowseLabel}
          </button>
        )}
        <button
          onClick={() => {
            if (view === 'families') loadFamilies();
            else if (view === 'revisions') loadRevisions(selectedFamily);
            else if (view === 'clusters') loadClusters();
            else if (view === 'services') loadServices(selectedCluster);
          }}
          disabled={loading}
          title="Refresh"
          className="px-2 py-1 text-xs text-gray-400 hover:text-white bg-gray-800 border border-gray-700 rounded disabled:opacity-50 transition-colors"
        >
          {loading ? '↻' : '⟳'} Refresh
        </button>
      </div>

      {/* List */}
      <div className="max-h-56 overflow-y-auto">
        {error && <div className="px-4 py-3 text-xs text-red-400">{error}</div>}

        {/* Families view */}
        {!error && view === 'families' && (
          <>
            {filteredFamilies.length === 0 && !loading && (
              <div className="px-4 py-3 text-xs text-gray-600">No task definition families found.</div>
            )}
            {filteredFamilies.map(family => (
              <div
                key={family}
                onClick={() => handleFamilyClick(family)}
                className="flex items-center justify-between px-3 py-2 cursor-pointer text-xs hover:bg-gray-800/50 transition-colors"
              >
                <span className="font-mono text-gray-200 truncate">{family}</span>
                <span className="text-gray-600 shrink-0 ml-2">›</span>
              </div>
            ))}
          </>
        )}

        {/* Revisions view */}
        {!error && view === 'revisions' && (
          <>
            {filteredRevisions.length === 0 && !loading && (
              <div className="px-4 py-3 text-xs text-gray-600">No active revisions found.</div>
            )}
            {filteredRevisions.length > 0 && (
              <>
                <div
                  className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-800 cursor-pointer hover:bg-gray-800/50"
                  onClick={toggleAllRevisions}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={selected.size > 0 && selected.size === filteredRevisions.length}
                    className="w-3.5 h-3.5 accent-red-500"
                  />
                  <span className="text-xs text-gray-500">
                    {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
                  </span>
                </div>
                {filteredRevisions.map(td => {
                  const isSelected = selected.has(td.arn);
                  return (
                    <div
                      key={td.arn}
                      onClick={() => toggle(td.arn)}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-xs transition-colors ${
                        isSelected ? 'bg-red-950/30' : 'hover:bg-gray-800/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={isSelected}
                        className="w-3.5 h-3.5 accent-red-500 shrink-0"
                      />
                      <span className="font-mono text-gray-200 flex-1 truncate">rev {td.revision}</span>
                      <span className="text-gray-500 shrink-0 truncate max-w-[160px]">{td.containers.join(', ')}</span>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

        {/* Clusters view */}
        {!error && view === 'clusters' && (
          <>
            {filteredClusters.length === 0 && !loading && (
              <div className="px-4 py-3 text-xs text-gray-600">No ECS clusters found.</div>
            )}
            {filteredClusters.map(cluster => (
              <div
                key={cluster.arn}
                onClick={() => handleClusterClick(cluster)}
                className="flex items-center justify-between px-3 py-2 cursor-pointer text-xs hover:bg-gray-800/50 transition-colors"
              >
                <span className="font-mono text-gray-200 truncate">{cluster.name}</span>
                <span className="text-gray-600 shrink-0 ml-2">{cluster.activeServicesCount} svc</span>
              </div>
            ))}
          </>
        )}

        {/* Services view */}
        {!error && view === 'services' && (
          <>
            {filteredServices.length === 0 && !loading && (
              <div className="px-4 py-3 text-xs text-gray-600">No services found.</div>
            )}
            {filteredServices.length > 0 && (
              <>
                <div
                  className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-800 cursor-pointer hover:bg-gray-800/50"
                  onClick={toggleAllServices}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={selected.size > 0 && selected.size === filteredServices.length}
                    className="w-3.5 h-3.5 accent-red-500"
                  />
                  <span className="text-xs text-gray-500">
                    {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
                  </span>
                </div>
                {filteredServices.map(svc => {
                  const isSelected = selected.has(svc.taskDefinition);
                  return (
                    <div
                      key={svc.arn}
                      onClick={() => toggle(svc.taskDefinition)}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer text-xs transition-colors ${
                        isSelected ? 'bg-red-950/30' : 'hover:bg-gray-800/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={isSelected}
                        className="w-3.5 h-3.5 accent-red-500 shrink-0"
                      />
                      <span className="font-mono text-gray-200 flex-1 truncate">{svc.name}</span>
                      <span className="text-gray-500 shrink-0 font-mono truncate max-w-[180px]" title={svc.taskDefinition}>
                        {svc.taskDefinition.split('/').pop()}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {selected.size > 0 && (
        <div className="px-3 py-2 border-t border-gray-700 flex justify-end">
          <button
            onClick={handleAdd}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-medium transition-colors"
          >
            Add {selected.size} task def{selected.size !== 1 ? 's' : ''} to staging
          </button>
        </div>
      )}
    </div>
  );
}
