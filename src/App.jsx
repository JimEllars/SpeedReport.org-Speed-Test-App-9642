import { useCallback, useEffect, useState } from 'react';
import './App.css';
import { STATES } from './common/testConstants';
import Header from './components/Header';
import SpeedGauge from './components/SpeedGauge';
import MetricsGrid from './components/MetricsGrid';
import ISPDetailsCard from './components/ISPDetailsCard';
import BusinessAuditCard from './components/BusinessAuditCard';
import TestHistoryVault from './components/TestHistoryVault';
import ReportCard from './components/ReportCard';
import ReportShareCard from './components/ReportShareCard';
import ReportComparisonCard from './components/ReportComparisonCard';
import DiagnosticsSummary from './components/DiagnosticsSummary';
import { useLocalVault } from './hooks/useLocalVault';
import { useSpeedTest } from './hooks/useSpeedTest';
import { readReportFromUrl } from './utils/reportShareLinks';

function App() {
  const {
    history,
    latestReport,
    save,
    clear,
    togglePin
  } = useLocalVault();
  const [report, setReport] = useState(null);
  const [isShared, setIsShared] = useState(false);

useEffect(() => {
    const handleHashChange = () => {
      const sharedReport = readReportFromUrl();
      if (sharedReport) {
        setReport(sharedReport);
        setIsShared(true);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {

    const sharedReport = readReportFromUrl();

    if (sharedReport) {
      setReport(sharedReport);
      setIsShared(true);
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const runId = urlParams.get('runId');
    if (runId) {
      const foundInHistory = history.find(r => r.id === runId);
      if (foundInHistory) {
        setReport(foundInHistory);
        setIsShared(false);
        return;
      } else {
        // Just show a small native browser toast or warning (or could use an alert for simplicity here if no toast library is available)
        // using simple console/alert for non-intrusive warning as requested
        console.warn('Referenced report not found on this device; ready for a new test.');
        const toast = document.createElement('div'); toast.style = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#f5bc6e;color:#18263c;padding:10px 20px;border-radius:8px;font-size:12px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2)'; toast.innerText = 'Referenced report not found on this device; ready for a new test.'; document.body.appendChild(toast); setTimeout(() => toast.remove(), 4000);
      }
    }

    if (latestReport) {
      setReport(latestReport);
    }
  }, [latestReport, history]);

  const handleComplete = useCallback((result) => {
    setReport(result);
    setIsShared(false);
    save(result);
  }, [save]);

  const handleSelectReport = useCallback((selectedReport) => {
    setReport(selectedReport);
    setIsShared(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleClearHistory = useCallback(() => {
    if (window.confirm('Clear all locally saved reports from this device?')) {
      clear();
    }
  }, [clear]);

  const test = useSpeedTest(handleComplete);
  const complete = test.state === STATES.COMPLETE;
  const displayedMetrics = report?.metrics || test.metrics;
  const displayedMeta = report?.meta || test.meta;
  const previousReport = history.find((item) => item.id !== report?.id);

  return (
    <div className="app-shell w-full max-w-full overflow-x-hidden">
      <Header />

      <main>
        <section className="intro">
          <div>
            <span className="eyebrow">Commercial-grade edge testing</span>
            <h1>
              Know if your connection
              <br />
              <em>means business.</em>
            </h1>
          </div>
          <p>
            Measure bandwidth, latency, jitter, packet loss, and loaded performance
            —then translate the numbers into operational readiness.
          </p>
        </section>

        <div className="dashboard-grid">
          <SpeedGauge
            {...test}
            onStart={test.start}
            onCancel={test.cancel}
          />

          <div className="metrics-column">
            <MetricsGrid metrics={test.metrics} />

            {test.error && (
              <div className="error-banner" role="alert">
                <strong>Edge engine unavailable.</strong> {test.error} Deploy the
                included Worker or configure <code>VITE_API_BASE</code>.
              </div>
            )}

            <ISPDetailsCard meta={displayedMeta} metrics={displayedMetrics} />
          </div>
        </div>

        <ReportCard report={report} />
        <ReportShareCard report={report} isShared={isShared} />
        <ReportComparisonCard
          currentReport={report}
          previousReport={previousReport}
        />
        <DiagnosticsSummary report={report} />

        <div className="lower-grid">
          <BusinessAuditCard
            metrics={displayedMetrics}
            complete={complete || Boolean(report)}
          />
          <TestHistoryVault
            history={history}
            onClear={handleClearHistory}
            onSelect={handleSelectReport}
            onTogglePin={togglePin}
          />
        </div>
      </main>

      <footer>
        <strong>SpeedReport.org</strong>
        <span>
          Private, ad-free network intelligence. Test history remains in your browser.
        </span>
        <span>© {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}

export default App;