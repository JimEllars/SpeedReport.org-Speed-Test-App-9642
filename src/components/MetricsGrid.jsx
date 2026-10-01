import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { getReadiness } from '../utils/readiness';

const {
  FiDownload,
  FiUpload,
  FiClock,
  FiZap,
  FiActivity,
  FiWifi
} = FiIcons;

export default function MetricsGrid({ metrics }) {
  const readiness = getReadiness(metrics);
  const status = readiness.grade;

  const items = [
    ['Download', metrics.download.toFixed(1), 'Mbps', FiDownload],
    ['Upload', metrics.upload.toFixed(1), 'Mbps', FiUpload],
    ['Latency', (metrics.loadedPing || metrics.ping).toFixed(1), 'ms', FiClock],
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
    <section className="metrics-grid w-full max-w-full mt-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-slate-100">Performance Metrics</h3>
        {status && (
          <span className={`px-2 py-1 rounded text-xs font-semibold uppercase tracking-wider ${
            status === 'Optimal' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
            status === 'Degraded' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
            'bg-rose-500/20 text-rose-400 border border-rose-500/30'
          }`}>
            {status}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4 w-full">
        {items.map(([label, value, unit, icon]) => (
          <div className="metric-card p-2.5 sm:p-4 text-center rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between" style={{ minHeight: '100px' }} key={label}>
            <div className="metric-top flex items-center justify-center gap-2 mb-2 text-slate-400 text-sm font-medium">
              <SafeIcon icon={icon} />
              <span>{label}</span>
            </div>
            <div className="metric-value text-lg sm:text-xl md:text-2xl break-words font-semibold tabular-nums">
              {value} <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
