import * as FiIcons from 'react-icons/fi';
import { useState, useMemo } from 'react';
import SafeIcon from '../common/SafeIcon';
import { downloadHistoryCsv } from '../utils/reportActions';
import './TestHistoryVault.css';
import { downloadReport } from '../utils/pdfReportGenerator';

const {
  FiArchive,
  FiDownload,
  FiEye,
  FiTrash2,
  FiTrendingUp,
  FiBookmark,
  FiUploadCloud,
  FiMapPin,
  FiFileText
} = FiIcons;

function getBarHeight(value, maxVal) {
  if (!maxVal) return 8;
  return Math.max(10, Math.round((value / maxVal) * 100));
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  });
}

export default function TestHistoryVault({ history, onClear, onSelect, onTogglePin, onExportVault, onImportVault }) {
  const [locationFilter, setLocationFilter] = useState('');

  const uniqueLocations = useMemo(() => {
    const locs = new Set();
    history.forEach(item => {
      if (item.locationTag) locs.add(item.locationTag);
    });
    return Array.from(locs).sort();
  }, [history]);

  const filteredHistory = useMemo(() => {
    if (!locationFilter) return history;
    return history.filter(item => item.locationTag === locationFilter);
  }, [history, locationFilter]);

  const maxVal = Math.max(
    ...filteredHistory.map((test) => test.metrics.download),
    1
  );

  const exportHistory = () => {
    try {
      downloadHistoryCsv(filteredHistory);
    } catch {
      // Browser download permissions can block this action.
    }
  };

  const getBranchHealth = () => {
    if (!locationFilter) return null;
    const count = filteredHistory.length;
    if (count === 0) return null;

    let breaches = 0;
    filteredHistory.forEach(h => {
       if (h.slaStatus === 'CONTRACTUAL_BREACH') breaches++;
    });

    if (breaches === 0) {
      return `${locationFilter}: ${count} tests, 100% Compliant`;
    }
    return `${locationFilter}: ${count} tests, ${breaches} Breaches`;
  };

  const branchHealth = getBranchHealth();

  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Stored on this device</span>
          <h2>Past tests</h2>
        </div>

        {history.length > 0 && (
          <div className="history-actions">
            {uniqueLocations.length > 0 && (
              <div style={{ marginRight: '1rem', display: 'flex', alignItems: 'center' }}>
                <SafeIcon icon={FiMapPin} style={{ marginRight: '0.25rem', color: '#94a3b8' }} />
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  style={{ background: '#1e293b', color: 'white', border: '1px solid #334155', borderRadius: '4px', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                >
                  <option value="">All Locations</option>
                  {uniqueLocations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
            )}

            <button className="icon-button" onClick={onExportVault}>
              <SafeIcon icon={FiDownload} />
              Export History
            </button>
            <label className="icon-button" style={{ cursor: 'pointer' }}>
              <SafeIcon icon={FiUploadCloud} />
              Import Backup
              <input
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    onImportVault(event.target.result);
                  };
                  reader.readAsText(file);
                }}
              />
            </label>
            <button className="icon-button" onClick={exportHistory}>
              <SafeIcon icon={FiDownload} />
              CSV
            </button>
            <button className="icon-button" onClick={onClear}>
              <SafeIcon icon={FiTrash2} />
              Clear
            </button>
          </div>
        )}
      </div>

      {branchHealth && (
        <div style={{ padding: '0.75rem', backgroundColor: '#1e293b', borderBottom: '1px solid #334155', fontSize: '0.9rem', color: '#cbd5e1' }}>
          <strong>Branch Health:</strong> {branchHealth}
        </div>
      )}

      {filteredHistory.length === 0 ? (
        <div className="empty-state" style={{ padding: '2rem', textAlign: 'center', color: '#718096' }}>
          <SafeIcon icon={FiArchive} style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }} />
          <p>{history.length > 0 ? "No tests found for this location." : "No tests recorded yet."}</p>
          {history.length === 0 && (
            <p style={{ fontSize: '0.875rem', opacity: 0.8, marginTop: '0.5rem' }}>Run your first diagnostic to start tracking performance history.</p>
          )}
        </div>
      ) : (
        <>
          <div className="history-chart">
            <div className="chart-label">
              <SafeIcon icon={FiTrendingUp} />
              Download trend
            </div>

            <div className="bars">
              {filteredHistory.slice(0, 10).reverse().map((test) => (
                <div className="bar-column" key={`bar-${test.id}`}>
                  <div
                    className="bar"
                    style={{
                      height: `${getBarHeight(
                        test.metrics.download,
                        maxVal
                      )}%`
                    }}
                    title={`${test.metrics.download} Mbps`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="history-table">
            <div className="history-head">
              <span>Date</span>
              <span>Down</span>
              <span>Up</span>
              <span>Ping</span>
              <span style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>Action</span>
            </div>

            {filteredHistory.slice(0, 6).map((test) => (
              <div className="history-row" key={test.id}>
                <span title={test.id}>
                  {formatDate(test.timestamp)}
                  {test.locationTag && <span style={{display: 'block', fontSize: '0.7rem', color: '#94a3b8'}}>{test.locationTag}</span>}
                </span>
                <strong>{test.metrics.download}</strong>
                <strong>{test.metrics.upload}</strong>
                <span>{test.metrics.ping} ms</span>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button
                    className="history-view"
                    onClick={() => onTogglePin(test.id)}
                    aria-label={test.pinned ? `Unpin report ${test.id}` : `Pin report ${test.id}`}
                    style={{ color: test.pinned ? '#f5bc6e' : '#719bea' }}
                  >
                    <SafeIcon icon={FiBookmark} />
                  </button>
                  <button
                    className="history-view"
                    onClick={(e) => { e.stopPropagation(); downloadReport(test, { mode: 'SLA_DISPUTE_DOSSIER' }); }}
                    aria-label={`Export Dispute Dossier for ${test.id}`}
                    title="Export SLA Dispute Dossier"
                  >
                    <SafeIcon icon={FiFileText}/>
                  </button>
                  <button
                    className="history-view"
                    onClick={() => onSelect(test)}
                    aria-label={`View report ${test.id}`}
                  >
                    <SafeIcon icon={FiEye} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="history-footnote">
            {filteredHistory.length} report{filteredHistory.length === 1 ? '' : 's'} saved locally.
            Export CSV to analyze the full device history.
          </p>
        </>
      )}

    </section>
  );
}