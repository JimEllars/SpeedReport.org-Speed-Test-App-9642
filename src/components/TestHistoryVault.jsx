import { useEffect } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { downloadHistoryCsv } from '../utils/reportActions';
import { downloadJsonReport } from '../utils/reportActions';
import './TestHistoryVault.css';

const {
  FiArchive,
  FiDownload,
  FiEye,
  FiTrash2,
  FiTrendingUp,
  FiBookmark,
  FiUploadCloud,
  FiX
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

export default function TestHistoryVault({ history, onClear, onSelect, onTogglePin, onExportVault, onImportVault, onClose }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);
  const maxVal = Math.max(
    ...history.map((test) => test.metrics.download),
    1
  );


  const exportHistoryJson = () => {
    try {
      const content = JSON.stringify(history, null, 2);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `SpeedReport-history-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Browser download permissions can block this action.
    }
  };

  const exportHistory = () => {
    try {
      downloadHistoryCsv(history);
    } catch {
      // Browser download permissions can block this action.
    }
  };

  return (

<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4 transition-all" onClick={onClose}>
  <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-2xl bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl max-h-[85dvh] sm:max-h-[80vh] flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-200">
    <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto my-3 sm:hidden shrink-0" />
    <button onClick={onClose} className="absolute top-4 right-4 sm:hidden p-2 text-slate-400 hover:text-white" style={{ minWidth: '44px', minHeight: '44px' }}>
      <SafeIcon icon={FiX} size={24} />
    </button>
    <div className="overflow-y-auto w-full flex-1 w-full max-w-full">
<section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Stored on this device</span>
          <h2>Past tests</h2>
        </div>

        {history.length > 0 && (
          <div className="history-actions">
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

      {history.length === 0 ? (
        <div className="empty-state" style={{ padding: '2rem', textAlign: 'center', color: '#718096' }}>
          <SafeIcon icon={FiArchive} style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }} />
          <p>No tests recorded yet.</p>
          <p style={{ fontSize: '0.875rem', opacity: 0.8, marginTop: '0.5rem' }}>Run your first diagnostic to start tracking performance history.</p>
        </div>
      ) : (
        <>
          <div className="history-chart">
            <div className="chart-label">
              <SafeIcon icon={FiTrendingUp} />
              Download trend
            </div>

            <div className="bars">
              {history.slice(0, 10).reverse().map((test) => (
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

            {history.slice(0, 6).map((test) => (
              <div className="history-row" key={test.id}>
                <span title={test.id}>{formatDate(test.timestamp)}</span>
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
            {history.length} report{history.length === 1 ? '' : 's'} saved locally.
            Export CSV to analyze the full device history.
          </p>
        </>
      )}

</section>
    </div>
  </div>
</div>

  );
}