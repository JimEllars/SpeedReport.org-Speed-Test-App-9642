import * as FiIcons from 'react-icons/fi';
import { useState } from 'react';
import SafeIcon from '../common/SafeIcon';
import { formatDuration, getReadiness } from '../utils/readiness';
import { sendAnonymousTelemetry } from '../utils/telemetry';
import { evaluateSlaCompliance } from '../utils/slaEngine';

const { FiPhoneCall, FiVideo, FiCloud, FiUsers, FiCheckCircle, FiFileText, FiShield, FiAlertTriangle, FiXCircle } = FiIcons;

export default function BusinessAuditCard({ metrics, complete, reportId }) {
  const audit = getReadiness(metrics);
  const [requested, setRequested] = useState(() => {
    try { return localStorage.getItem('sr_audit_requested') === 'true'; } catch { return false; }
  });

  const [selectedTier, setSelectedTier] = useState('Tier 1: Dedicated Internet Access (DIA)');
  const [subscribedPlan, setSubscribedPlan] = useState('1000/1000');
  const [customPlan, setCustomPlan] = useState('');

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

  let slaResult = null;
  if (complete && metrics) {
    const planToUse = subscribedPlan === 'Custom' ? customPlan : subscribedPlan;
    if (planToUse && planToUse.includes('/')) {
        slaResult = evaluateSlaCompliance(metrics, selectedTier, planToUse);
    }
  }

  return (
    <section className="panel audit-panel p-4 sm:p-6" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div>
        <div className="panel-heading flex justify-between items-start mb-4">
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
      </div>

      {complete && (
        <div className="border-t border-slate-800 pt-6">
          <div className="mb-4">
            <span className="eyebrow">Compliance check</span>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Enterprise SLA Verification</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#94a3b8' }}>Service Tier</label>
                <select
                  value={selectedTier}
                  onChange={(e) => setSelectedTier(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', background: '#1e293b', color: 'white', border: '1px solid #334155' }}
                >
                  <option value="Tier 1: Dedicated Internet Access (DIA)">Tier 1: Dedicated Internet Access (DIA)</option>
                  <option value="Tier 2: Business Broadband (Coax/Fiber)">Tier 2: Business Broadband (Coax/Fiber)</option>
                  <option value="Tier 3: Remote Workforce / Best Effort">Tier 3: Remote Workforce / Best Effort</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#94a3b8' }}>Subscribed Plan (Mbps)</label>
                <select
                  value={subscribedPlan}
                  onChange={(e) => setSubscribedPlan(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', background: '#1e293b', color: 'white', border: '1px solid #334155' }}
                >
                  <option value="200/200">200/200</option>
                  <option value="500/500">500/500</option>
                  <option value="1000/1000">1000/1000</option>
                  <option value="2000/2000">2000/2000</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>
            </div>
            {subscribedPlan === 'Custom' && (
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: '#94a3b8' }}>Custom Plan (e.g., 300/300)</label>
                <input
                  type="text"
                  value={customPlan}
                  onChange={(e) => setCustomPlan(e.target.value)}
                  placeholder="Download/Upload Mbps"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', background: '#1e293b', color: 'white', border: '1px solid #334155' }}
                />
              </div>
            )}
          </div>

          {slaResult && (
            <div>
              <div style={{
                padding: '1rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                backgroundColor: slaResult.status === 'COMPLIANT' ? 'rgba(16, 185, 129, 0.1)' :
                               slaResult.status === 'AT_RISK' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${slaResult.status === 'COMPLIANT' ? '#10b981' :
                                 slaResult.status === 'AT_RISK' ? '#f59e0b' : '#ef4444'}`
              }}>
                <SafeIcon
                  icon={slaResult.status === 'COMPLIANT' ? FiShield :
                        slaResult.status === 'AT_RISK' ? FiAlertTriangle : FiXCircle}
                  style={{
                    fontSize: '1.5rem',
                    color: slaResult.status === 'COMPLIANT' ? '#10b981' :
                           slaResult.status === 'AT_RISK' ? '#f59e0b' : '#ef4444'
                  }}
                />
                <span style={{
                  fontWeight: 'bold',
                  color: slaResult.status === 'COMPLIANT' ? '#10b981' :
                         slaResult.status === 'AT_RISK' ? '#f59e0b' : '#ef4444'
                }}>
                  {slaResult.status === 'COMPLIANT' ? 'SLA Compliant (Contractual Guarantee Met)' :
                   slaResult.status === 'AT_RISK' ? 'SLA At Risk (Within 15% of Breach Threshold)' :
                   'CONTRACTUAL SLA BREACH DETECTED'}
                </span>
              </div>

              {slaResult.violations.length > 0 && (
                <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#1e293b', borderRadius: '8px' }}>
                  <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: '#cbd5e1' }}>SLA Warnings & Breaches:</h4>
                  <ul style={{ listStyleType: 'disc', paddingLeft: '1.5rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                    {slaResult.violations.map((v, i) => (
                      <li key={i} style={{ marginBottom: '0.25rem' }}>{v}</li>
                    ))}
                  </ul>
                </div>
              )}

              <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem' }}>Metric</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Measured</th>
                    <th style={{ textAlign: 'right', padding: '0.5rem' }}>Fulfillment</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '0.5rem', color: '#cbd5e1' }}>Download</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: 'white' }}>{metrics.download} Mbps</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: slaResult.fulfillment.download >= 1 ? '#10b981' : (slaResult.fulfillment.download < 0.95 && selectedTier.includes('Tier 1') ? '#ef4444' : '#cbd5e1') }}>
                      {(slaResult.fulfillment.download * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '0.5rem', color: '#cbd5e1' }}>Upload</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: 'white' }}>{metrics.upload} Mbps</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: slaResult.fulfillment.upload >= 1 ? '#10b981' : (slaResult.fulfillment.upload < 0.95 && selectedTier.includes('Tier 1') ? '#ef4444' : '#cbd5e1') }}>
                      {(slaResult.fulfillment.upload * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '0.5rem', color: '#cbd5e1' }}>Latency</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: 'white' }}>{metrics.ping} ms</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: '#cbd5e1' }}>—</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0.5rem', color: '#cbd5e1' }}>Jitter</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: 'white' }}>{metrics.jitter} ms</td>
                    <td style={{ textAlign: 'right', padding: '0.5rem', color: '#cbd5e1' }}>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
