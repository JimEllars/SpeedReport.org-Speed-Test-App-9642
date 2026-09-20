import { useState } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';

const { FiServer, FiEye, FiEyeOff, FiMapPin } = FiIcons;

const maskIp = (ip) => {
  if (!ip || ip === 'Unknown') return 'Awaiting test';
  return ip.includes(':') ? `${ip.slice(0, 7)}••••` : ip.replace(/\d+$/, '•••');
};

export default function ISPDetailsCard({ meta }) {
  const [visible, setVisible] = useState(false);

  return (
    <section className="panel">
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
            {meta ? `${meta.city}, ${meta.country} · ${meta.colo}` : '—'}
          </dd>
        </div>
      </dl>
    </section>
  );
}