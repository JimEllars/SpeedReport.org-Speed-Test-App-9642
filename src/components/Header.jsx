import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';

const { FiActivity, FiShield, FiLock } = FiIcons;

export default function Header() {
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
        <span><SafeIcon icon={FiShield} /> Edge tested</span>
        <span><SafeIcon icon={FiLock} /> Private by design</span>
      </div>
    </header>
  );
}