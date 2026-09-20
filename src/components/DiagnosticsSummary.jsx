import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';

const { FiActivity, FiClock, FiTrendingUp, FiShield } = FiIcons;

function difference(current, baseline) {
  return Math.max(0, current - baseline).toFixed(1);
}

function status(value, threshold) {
  return value <= threshold ? 'Healthy' : 'Review';
}

export default function DiagnosticsSummary({ report }) {
  if (!report) return null;

  const { metrics } = report;
  const loadedDelta = difference(metrics.loadedPing, metrics.ping);
  const loadedStatus = Number(loadedDelta) <= 15 ? 'Healthy' : 'Review';
  const latencyStatus = status(metrics.ping, 50);
  const jitterStatus = status(metrics.jitter, 10);
  const lossStatus = metrics.loss < 1 ? 'Healthy' : 'Review';

  const rows = [
    {
      icon: FiClock,
      label: 'Idle latency',
      value: `${metrics.ping} ms`,
      detail: `${metrics.min}–${metrics.max} ms observed range`,
      state: latencyStatus
    },
    {
      icon: FiActivity,
      label: 'Jitter consistency',
      value: `${metrics.jitter} ms`,
      detail: `${metrics.loadedJitter} ms during active load`,
      state: jitterStatus
    },
    {
      icon: FiTrendingUp,
      label: 'Loaded latency delta',
      value: `+${loadedDelta} ms`,
      detail: `${metrics.loadedPing} ms average while saturated`,
      state: loadedStatus
    },
    {
      icon: FiShield,
      label: 'Packet delivery',
      value: `${metrics.loss}% loss`,
      detail: `${metrics.loadedLoss}% loss during load`,
      state: lossStatus
    }
  ];

  return (
    <section className="panel diagnostics-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Detailed diagnostics</span>
          <h2>Connection quality profile</h2>
        </div>
        <span className="diagnostics-id">{report.id}</span>
      </div>

      <div className="diagnostic-grid">
        {rows.map((row) => (
          <div className="diagnostic-item" key={row.label}>
            <div className="diagnostic-icon">
              <SafeIcon icon={row.icon} />
            </div>
            <div className="diagnostic-copy">
              <span>{row.label}</span>
              <strong>{row.value}</strong>
              <small>{row.detail}</small>
            </div>
            <b className={row.state === 'Healthy' ? 'healthy' : 'review'}>
              {row.state}
            </b>
          </div>
        ))}
      </div>

      <p className="diagnostic-note">
        Bufferbloat measures the increase in latency when your connection is carrying
        heavy download and upload traffic. Lower increases indicate a more responsive
        connection for calls, meetings, and interactive cloud applications.
      </p>
    </section>
  );
}