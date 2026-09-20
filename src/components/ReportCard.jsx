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
      </div>
    </section>
  );
}