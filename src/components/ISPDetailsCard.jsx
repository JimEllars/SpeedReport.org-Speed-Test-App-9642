import { useState } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';

const { FiServer, FiEye, FiEyeOff, FiMapPin } = FiIcons;

const maskIp = (ip) => {
  if (!ip || ip === 'Unknown') return 'Awaiting test';
  return ip.includes(':') ? `${ip.slice(0, 7)}••••` : ip.replace(/\d+$/, '•••');
};

export default function ISPDetailsCard({ meta, metrics }) {
  const [visible, setVisible] = useState(false);

  const getRegionalBenchmark = () => {
    if (!metrics || !metrics.download) return null;
    const speed = Math.max(metrics.download, metrics.upload || 0);
    if (speed > 500) return 'Top 5% Commercial Fiber';
    if (speed >= 100) return 'Above Regional Average';
    return 'Standard Broadband Tier';
  };

  const benchmark = getRegionalBenchmark();

  return (
    <section className="panel p-4 sm:p-6">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Network path</span>
          <h2>Connection details</h2>
        </div>
        <SafeIcon icon={FiServer} />
      </div>

      <dl className="detail-list">
        <div>
          <dt>Provider</dt>
          <dd>{meta?.isp || 'Detected when test starts'}</dd>
        </div>
        <div>
          <dt>Public IP</dt>
          <dd className="ip">
            {visible ? meta?.ip : maskIp(meta?.ip)}
            {meta?.ip && (
              <button onClick={() => setVisible((current) => !current)} aria-label="Toggle IP visibility">
                <SafeIcon icon={visible ? FiEyeOff : FiEye} />
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>{meta ? `AS${meta.asn}` : '—'}</dd>
        </div>

        <div>
          <dt>Edge node</dt>
          <dd>
            <SafeIcon icon={FiMapPin} />
            {meta ? `${meta.city}, ${meta.country} · ${meta.colo || 'Nearest'}` : '—'}
          </dd>
        </div>
        {benchmark && (
          <div>
            <dt>Regional Rating</dt>
            <dd>
              <span style={{ display: 'inline-block', padding: '2px 8px', background: 'var(--accent-color, #2563EB)', color: '#fff', borderRadius: '12px', fontSize: '10px', fontWeight: 'bold' }}>
                {benchmark}
              </span>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}