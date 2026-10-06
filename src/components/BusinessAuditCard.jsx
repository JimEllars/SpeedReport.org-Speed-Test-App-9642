import * as FiIcons from 'react-icons/fi';
import { useState } from 'react';
import SafeIcon from '../common/SafeIcon';
import { formatDuration, getReadiness } from '../utils/readiness';
import { sendAnonymousTelemetry } from '../utils/telemetry';

const { FiPhoneCall, FiVideo, FiCloud, FiUsers, FiCheckCircle, FiFileText } = FiIcons;

export default function BusinessAuditCard({ metrics, complete, reportId }) {
  const audit = getReadiness(metrics);
  const [requested, setRequested] = useState(() => {
    try { return localStorage.getItem('sr_audit_requested') === 'true'; } catch { return false; }
  });

  const handleRequestAudit = () => {
    setRequested(true);
    try { localStorage.setItem('sr_audit_requested', 'true'); } catch (e) { /* ignore */ }
    const payload = {
      id: reportId || 'unknown',
      metrics: metrics,
      audit_requested: true
    };
    sendAnonymousTelemetry(payload);
  };

  const rows = [
    [FiPhoneCall, 'VoIP & telephony', complete ? `${audit.calls}+ simultaneous HD calls` : 'Awaiting connection analysis'],
    [FiVideo, 'Video conferencing', complete ? (audit.strongVideo ? '4K multi-stream ready' : 'HD use with limitations') : 'Zoom, Teams & Meet readiness'],
    [FiCloud, 'Cloud workloads', complete ? `100 GB in ${formatDuration(audit.uploadSeconds(100))} · 1 TB in ${formatDuration(audit.uploadSeconds(1000))} · 10 TB in ${formatDuration(audit.uploadSeconds(10000))}` : 'Upload feasibility analysis'],
    [FiUsers, 'Office capacity', complete ? `Est. ${audit.employees} active employees` : 'Concurrent workforce estimate']
  ];

  return (
    <section className="panel audit-panel p-4 sm:p-6" style={{ minWidth: 0 }}>
      <div className="panel-heading flex justify-between items-start">
        <div><span className="eyebrow">Operational assessment</span><h2>Business readiness</h2></div>
        <div className={`grade ${complete ? 'ready' : ''}`}>{complete ? audit.grade : 'Pending'}</div>
      </div>
      <div className="audit-list" style={{ overflowX: 'hidden' }}>
        {rows.map(([icon, title, detail]) => (
          <div className="audit-row" key={title} style={{ minWidth: 0 }}>
            <span className="audit-icon"><SafeIcon icon={icon} /></span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{title}</strong>
              <small style={{ display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{detail}</small>
            </div>
            {complete && <SafeIcon icon={FiCheckCircle} className="check" />}
          </div>
        ))}
      </div>

      {complete && (
        <div className="mt-4 pt-4 border-t border-slate-800 flex justify-center">
          {requested ? (
             <div className="text-emerald-400 text-sm font-medium flex items-center gap-2">
               <SafeIcon icon={FiCheckCircle} />
               Audit request recorded
             </div>
          ) : (
            <button
              onClick={handleRequestAudit}
              className="text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-2"
            >
              <SafeIcon icon={FiFileText} />
              Request full IT readiness audit
            </button>
          )}
        </div>
      )}
    </section>
  );
}