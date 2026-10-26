import { useLocalVault } from '../hooks/useLocalVault';
import { useState } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { downloadJsonReport, printReport } from '../utils/reportActions';
import { downloadReport } from '../utils/pdfReportGenerator';

const {
  FiDownload,
  FiFileText,
  FiPrinter,
  FiShield,
  FiCode
} = FiIcons;

export default function ReportCard({ report }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [locationTag, setLocationTag] = useState(report?.locationTag || '');
  const { updateLocationTag } = useLocalVault();

  if (!report) return null;

  const runAction = (action, successMessage) => {
    setError('');
    setMessage('');

    try {
      action();
      setMessage(successMessage);
      window.setTimeout(() => setMessage(''), 2400);
    } catch {
      setError('This action was blocked by the browser.');
    }
  };


  const handleTagSave = () => {
    updateLocationTag(report.id, locationTag);
    setMessage('Location tag saved.');
    window.setTimeout(() => setMessage(''), 2400);
  };

  const handlePdfDownload = async () => {
    setError('');
    setMessage('');
    setIsDownloading(true);

    try {
      await downloadReport(report);
      setMessage('PDF report downloaded.');
    } catch {
      setError('The PDF could not be generated in this browser.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <section className="report-card">
      <div className="report-icon">
        <SafeIcon icon={FiFileText} />
      </div>

      <div className="report-copy">
        <span className="eyebrow">Verification certificate ready</span>
        <h2>Your official network report</h2>
        <p>
          Document performance, network identity, test node, and business readiness
          for IT or ISP review.
        </p>
        <span className="certificate">
          <SafeIcon icon={FiShield} /> {report.id}
        </span>
        {message && <small className="report-success">{message}</small>}
        {error && <small className="report-error">{error}</small>}
      </div>

      <div className="report-actions">
        <button
          className="report-button"
          onClick={handlePdfDownload}
          disabled={isDownloading}
        >
          <SafeIcon icon={FiDownload} />
          {isDownloading ? 'Preparing PDF…' : 'Download PDF'}
        </button>

        <button
          className="report-button secondary"
          onClick={() => runAction(
            () => printReport(report),
            'Print dialog opened.'
          )}
        >
          <SafeIcon icon={FiPrinter} />
          Print
        </button>

        <button
          className="report-button secondary"
          onClick={() => runAction(
            () => downloadJsonReport(report),
            'JSON data downloaded.'
          )}
        >
          <SafeIcon icon={FiCode} />
          JSON
        </button>

      <div className="report-tag-action" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="text"
          value={locationTag}
          onChange={(e) => setLocationTag(e.target.value)}
          placeholder="Assign Location Tag (e.g. Dallas HQ)"
          style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', flex: 1, fontSize: '0.875rem' }}
        />
        <button
          onClick={handleTagSave}
          style={{ padding: '0.5rem 1rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem' }}
        >
          Save
        </button>
      </div>
      </div>
    </section>
  );
}