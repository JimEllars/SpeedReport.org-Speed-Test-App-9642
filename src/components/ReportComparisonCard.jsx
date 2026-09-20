import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import './ReportComparisonCard.css';

const { FiArrowDown, FiArrowUp, FiMinus, FiGitCompare } = FiIcons;

function difference(current, previous) {
  return Number(current - previous).toFixed(1);
}

function Delta({ value, inverse = false }) {
  const numericValue = Number(value);
  const improved = inverse ? numericValue < 0 : numericValue > 0;
  const unchanged = numericValue === 0;
  const Icon = unchanged ? FiMinus : improved ? FiArrowUp : FiArrowDown;

  return (
    <span className={`comparison-delta ${unchanged ? 'neutral' : improved ? 'positive' : 'negative'}`}>
      <SafeIcon icon={Icon} />
      {numericValue > 0 ? '+' : ''}
      {value}
    </span>
  );
}

export default function ReportComparisonCard({ currentReport, previousReport }) {
  if (!currentReport || !previousReport || currentReport.id === previousReport.id) {
    return null;
  }

  const rows = [
    {
      label: 'Download',
      current: `${currentReport.metrics.download} Mbps`,
      delta: difference(currentReport.metrics.download, previousReport.metrics.download)
    },
    {
      label: 'Upload',
      current: `${currentReport.metrics.upload} Mbps`,
      delta: difference(currentReport.metrics.upload, previousReport.metrics.upload)
    },
    {
      label: 'Idle latency',
      current: `${currentReport.metrics.ping} ms`,
      delta: difference(currentReport.metrics.ping, previousReport.metrics.ping),
      inverse: true
    },
    {
      label: 'Jitter',
      current: `${currentReport.metrics.jitter} ms`,
      delta: difference(currentReport.metrics.jitter, previousReport.metrics.jitter),
      inverse: true
    },
    {
      label: 'Packet loss',
      current: `${currentReport.metrics.loss}%`,
      delta: difference(currentReport.metrics.loss, previousReport.metrics.loss),
      inverse: true
    }
  ];

  return (
    <section className="panel comparison-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Historical analysis</span>
          <h2>What changed?</h2>
        </div>
        <SafeIcon icon={FiGitCompare} />
      </div>

      <p className="comparison-description">
        Current results compared with your previous saved diagnostic.
      </p>

      <div className="comparison-reports">
        <span>Current · {currentReport.id}</span>
        <span>Previous · {previousReport.id}</span>
      </div>

      <div className="comparison-list">
        {rows.map((row) => (
          <div className="comparison-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.current}</strong>
            <Delta value={row.delta} inverse={row.inverse} />
          </div>
        ))}
      </div>

      <p className="comparison-footnote">
        For latency, jitter, and packet loss, a negative change indicates improvement.
      </p>
    </section>
  );
}