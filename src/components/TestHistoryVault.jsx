import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { downloadHistoryCsv } from '../utils/reportActions';
import './TestHistoryVault.css';

const {
  FiArchive,
  FiDownload,
  FiEye,
  FiTrash2,
  FiTrendingUp
} = FiIcons;

function getBarHeight(value, maximum) {
  if (!maximum) return 8;
  return Math.max(10, Math.round((value / maximum) * 100));
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  });
}

export default function TestHistoryVault({ history, onClear, onSelect }) {
  const maximum = Math.max(
    ...history.map((test) => test.metrics.download),
    1
  );

  const exportHistory = () => {
    try {
      downloadHistoryCsv(history);
    } catch {
      // Browser download permissions can block this action.
    }
  };

  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Stored on this device</span>
          <h2>Past tests</h2>
        </div>

        {history.length > 0 && (
          <div className="history-actions">
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
        <div className="empty-state">
          <SafeIcon icon={FiArchive} />
          <p>Your completed tests will appear here.</p>
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
                        maximum
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
              <span>View</span>
            </div>

            {history.slice(0, 6).map((test) => (
              <div className="history-row" key={test.id}>
                <span title={test.id}>{formatDate(test.timestamp)}</span>
                <strong>{test.metrics.download}</strong>
                <strong>{test.metrics.upload}</strong>
                <span>{test.metrics.ping} ms</span>
                <button
                  className="history-view"
                  onClick={() => onSelect(test)}
                  aria-label={`View report ${test.id}`}
                >
                  <SafeIcon icon={FiEye} />
                </button>
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
  );
}