import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { formatDuration, getReadiness } from '../utils/readiness';

const { FiPhoneCall, FiVideo, FiCloud, FiUsers, FiCheckCircle } = FiIcons;

export default function BusinessAuditCard({ metrics, complete }) {
  const audit = getReadiness(metrics);
  const rows = [
    [FiPhoneCall, 'VoIP & telephony', complete ? `${audit.calls}+ simultaneous HD calls` : 'Awaiting connection analysis'],
    [FiVideo, 'Video conferencing', complete ? (audit.strongVideo ? '4K multi-stream ready' : 'HD use with limitations') : 'Zoom, Teams & Meet readiness'],
    [FiCloud, 'Cloud workloads', complete ? `100 GB in ${formatDuration(audit.uploadSeconds(100))} · 1 TB in ${formatDuration(audit.uploadSeconds(1000))} · 10 TB in ${formatDuration(audit.uploadSeconds(10000))}` : 'Upload feasibility analysis'],
    [FiUsers, 'Office capacity', complete ? `Est. ${audit.employees} active employees` : 'Concurrent workforce estimate']
  ];

  return (
    <section className="panel audit-panel p-4 sm:p-6">
      <div className="panel-heading">
        <div><span className="eyebrow">Operational assessment</span><h2>Business readiness</h2></div>
        <div className={`grade ${complete ? 'ready' : ''}`}>{complete ? audit.grade : 'Pending'}</div>
      </div>
      <div className="audit-list">
        {rows.map(([icon, title, detail]) => (
          <div className="audit-row" key={title}>
            <span className="audit-icon"><SafeIcon icon={icon} /></span>
            <div><strong>{title}</strong><small>{detail}</small></div>
            {complete && <SafeIcon icon={FiCheckCircle} className="check" />}
          </div>
        ))}
      </div>
    </section>
  );
}