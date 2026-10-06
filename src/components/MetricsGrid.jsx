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

  const coreItems = [
    ['Download', metrics.download.toFixed(1), 'Mbps', FiDownload],
    ['Upload', metrics.upload.toFixed(1), 'Mbps', FiUpload],
    ['Latency', (metrics.loadedPing || metrics.ping).toFixed(1), 'ms', FiClock],
  ];

  const secondaryItems = [
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
      <div className="flex justify-between items-center mb-4" style={{ minHeight: '32px' }}>
        <h3 className="text-xl font-bold text-slate-100">Performance Metrics</h3>
        {status && (
          <span className={`px-2 py-1 rounded text-xs font-semibold uppercase tracking-wider ${
            status === 'Optimal' ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/50' :
            status === 'Degraded' ? 'bg-amber-900/40 text-amber-300 border border-amber-500/50' :
            'bg-rose-900/40 text-rose-300 border border-rose-500/50'
          }`}>
            {status}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 w-full gap-2 sm:gap-4">
        {coreItems.map(([label, value, unit, icon]) => (
          <div className="metric-card p-2 xs:p-2.5 sm:p-4 text-center rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between" style={{ minHeight: '100px' }} key={label}>
            <div className="metric-top flex items-center justify-center gap-2 mb-2 text-slate-400 text-sm font-medium">
              <SafeIcon icon={icon} />
              <span>{label}</span>
            </div>
            <div className="metric-value text-lg xs:text-xl sm:text-2xl md:text-3xl font-black tabular-nums break-words leading-tight tracking-tight">
              {value} <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 w-full gap-2 sm:gap-4 mt-2 sm:mt-3">
        {secondaryItems.map(([label, value, unit, icon]) => (
          <div className="metric-card p-2 xs:p-2.5 sm:p-4 text-center rounded-xl bg-slate-900/40 border border-slate-800/60 flex flex-col justify-between opacity-90" style={{ minHeight: '80px' }} key={label}>
            <div className="metric-top flex items-center justify-center gap-1.5 mb-1 text-slate-500 text-xs sm:text-sm font-medium">
              <SafeIcon icon={icon} />
              <span>{label}</span>
            </div>
            <div className="metric-value text-sm xs:text-base sm:text-lg font-semibold tabular-nums break-words text-slate-300 leading-tight">
              {value} <span className="text-xs font-normal text-slate-500 ml-1">{unit}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
