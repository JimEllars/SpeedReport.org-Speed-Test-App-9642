import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { useState, useEffect } from 'react';

const { FiActivity, FiShield, FiLock, FiSun, FiMoon } = FiIcons;

export default function Header() {
  const [edgeStatus, setEdgeStatus] = useState('Checking...');
  const [colo, setColo] = useState('');
  const [protocol, setProtocol] = useState('');
  const [isHealthy, setIsHealthy] = useState(false);

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('speedreport-theme');
    return saved || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('speedreport-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };


  useEffect(() => {
    let isMounted = true;

    Promise.all([
      fetch('/health').then(r => r.json()).catch(() => ({ status: 'error' })),
      fetch('/api/meta').then(r => r.json()).catch(() => ({}))
    ]).then(([healthData, metaData]) => {
      if (isMounted) {
        if (healthData && healthData.status === 'healthy') {
          setEdgeStatus('🟢 Edge');
          setIsHealthy(true);
        } else {
          setEdgeStatus('🔴 Edge');
          setIsHealthy(false);
        }

        if (metaData) {
           setColo(metaData.colo || 'Unknown');
           // the requirement mentions HTTP/3 or HTTP/2, checking if httpProtocol has values
           setProtocol(metaData.httpProtocol || 'HTTP/2');
        }
      }
    });

    return () => { isMounted = false; };
  }, []);

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark"><SafeIcon icon={FiActivity} /></span>
        <div>
          <strong>SpeedReport<span>.org</span></strong>
          <small>Enterprise network diagnostics</small>
        </div>
      </div>
      <div className="trust">
        {isHealthy && colo && protocol && (
          <span className="badge">🟢 Edge: {colo} &middot; {protocol}</span>
        )}

        <span><SafeIcon icon={FiShield} /> Edge tested</span>
        <span><SafeIcon icon={FiLock} /> Private by design</span>
        <button
          onClick={toggleTheme}
          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
          aria-label="Toggle theme"
        >
          <SafeIcon icon={theme === 'dark' ? FiSun : FiMoon} />
        </button>

      </div>
    </header>
  );
}
