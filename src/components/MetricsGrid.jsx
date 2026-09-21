import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';

const {
  FiDownload,
  FiUpload,
  FiClock,
  FiZap,
  FiActivity,
  FiWifi
} = FiIcons;

export default function MetricsGrid({ metrics }) {
  const items = [
    ['Download', metrics.download.toFixed(1), 'Mbps', FiDownload],
    ['Upload', metrics.upload.toFixed(1), 'Mbps', FiUpload],
    ['Idle latency', metrics.ping.toFixed(1), 'ms', FiClock],
    ['Jitter', metrics.jitter.toFixed(1), 'ms variance', FiActivity],
    [
      'Bufferbloat',
      metrics.bufferbloat,
      metrics.loadedPing ? `${metrics.loadedPing} ms loaded` : 'grade',
      FiZap
    ],
    ['Packet loss', metrics.loss.toFixed(1), '%', FiWifi]
  ];

  return (
    <section className="metrics-grid">
      {items.map(([label, value, unit, icon]) => (
        <div className="metric-card p-4 sm:p-6" key={label}>
          <div className="metric-top">
            <SafeIcon icon={icon} />
            <span>{label}</span>
          </div>
          <div className="metric-value">
            {value} <small>{unit}</small>
          </div>
        </div>
      ))}
    </section>
  );
}