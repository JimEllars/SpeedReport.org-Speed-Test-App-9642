import { useState } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import {
  clearReportFromUrl,
  createReportShareUrl
} from '../utils/reportShareLinks';
import './ReportShareCard.css';

const { FiCheck, FiCopy, FiLink, FiShare2 } = FiIcons;

export default function ReportShareCard({ report, isShared }) {
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
  );
}
