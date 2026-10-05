import { useState, useEffect } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import {
  clearReportFromUrl,
  createReportShareUrl
} from '../utils/reportShareLinks';
import './ReportShareCard.css';

const { FiCheck, FiCopy, FiLink, FiShare2, FiX } = FiIcons;

export default function ReportShareCard({ report, isShared, onClose }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  if (!report) return null;

  const shareUrl = createReportShareUrl(report);

  const copyLink = async () => {
    setError('');

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('Copy was blocked. Select and copy the link manually.');
    }
  };

  const shareReport = async () => {
    setError('');

    const shareData = {
      title: 'SpeedReport.org Network Test',
      text: `My internet speed is ${report.metrics.download.toFixed(1)} Mbps down / ${report.metrics.upload.toFixed(1)} Mbps up with ${(report.metrics.loadedPing || report.metrics.ping).toFixed(1)}ms latency on SpeedReport.org.`,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('Share failed:', err);
          setError('The report could not be shared from this browser.');
        }
      }
    }

    // Fallback to clipboard
    await navigator.clipboard.writeText(shareData.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const returnToLocalReport = () => {
    clearReportFromUrl();
    window.location.reload();
  };

  return (

<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4 transition-all" onClick={onClose}>
  <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-2xl bg-slate-900 border-t sm:border border-slate-800 rounded-t-3xl sm:rounded-2xl max-h-[85dvh] sm:max-h-[80vh] flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-200">
    <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto my-3 sm:hidden shrink-0" />
    <button onClick={onClose} className="absolute top-4 right-4 sm:hidden p-2 text-slate-400 hover:text-white" style={{ minWidth: '44px', minHeight: '44px' }}>
      <SafeIcon icon={FiX} size={24} />
    </button>
    <div className="overflow-y-auto w-full flex-1 w-full max-w-full">
<section className="share-card">
      <div className="share-card-heading">
        <div className="share-card-icon">
          <SafeIcon icon={FiLink} />
        </div>
        <div>
          <span className="eyebrow">Private browser sharing</span>
          <h2>{isShared ? 'Shared report opened' : 'Share this report'}</h2>
        </div>
      </div>

      <p>
        Create a read-only link containing this report in the URL fragment.
        Nothing is uploaded or stored on a server.
      </p>

      <div className="share-link-row">
        <input
          value={shareUrl}
          readOnly
          aria-label="Report share link"
          onFocus={(event) => event.target.select()}
        />
        <button className="share-action" onClick={copyLink}>
          <SafeIcon icon={copied ? FiCheck : FiCopy} />
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button className="share-action secondary" onClick={shareReport}>
          <SafeIcon icon={FiShare2} />
          Share
        </button>
      </div>

      {error && <small className="share-error">{error}</small>}

      {isShared && (
        <button className="return-link" onClick={returnToLocalReport}>
          Return to this browser’s latest report
        </button>
      )}

</section>
    </div>
  </div>
</div>

  );
}
