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
    clear
  } = useLocalVault();
  const [report, setReport] = useState(null);
  const [isShared, setIsShared] = useState(false);

  useEffect(() => {
    const sharedReport = readReportFromUrl();

    if (sharedReport) {
      setReport(sharedReport);
      setIsShared(true);
      return;
    }

    if (latestReport) {
      setReport(latestReport);
    }
  }, [latestReport]);

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
    <div className="app-shell">
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

            <ISPDetailsCard meta={displayedMeta} />
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