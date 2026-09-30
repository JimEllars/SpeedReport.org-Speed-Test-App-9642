import { useState } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { API_BASE } from '../common/testConstants';

const { FiZap, FiSend } = FiIcons;

export default function FiberLeadCard({ report }) {
  const [email, setEmail] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  if (!report) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email && !postalCode) return;

    setError('');

    try {
      const payload = {
        testId: report.id,
        timestamp: new Date().toISOString(),
        metrics: {
          downloadMbps: report.metrics.download,
          uploadMbps: report.metrics.upload,
          latencyMs: report.metrics.ping,
          jitterMs: report.metrics.jitter,
          bufferbloatGrade: report.metrics.bufferbloat,
          packetLossPct: report.metrics.loss
        },
        isp: report.meta?.isp || '',
        colo: report.meta?.colo || '',
        leadInfo: {
          email,
          postalCode,
          requestedFiberCheck: true
        }
      };

      const endpoint = `${API_BASE}/telemetry`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Failed to submit');
      }

      setSubmitted(true);
    } catch (err) {
      console.error('Lead capture error:', err);
      setError('Unable to send request. Please try again.');
    }
  };

  if (submitted) {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mt-6">
        <div className="flex items-center gap-3 text-emerald-400 mb-2">
          <SafeIcon icon={FiZap} className="w-6 h-6" />
          <h3 className="text-xl font-bold">Request Received</h3>
        </div>
        <p className="text-slate-400">
          We'll check fiber availability in your area and send a summary to {email || 'your team'}.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mt-6">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2 mb-2">
            <SafeIcon icon={FiZap} className="text-amber-400" />
            Looking for Faster, Symmetrical Gigabit Fiber?
          </h3>
          <p className="text-slate-400 text-sm">
            Check if enterprise-grade fiber is available at your location, or email this official report directly to your IT team.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="email"
              placeholder="IT or Personal Email (Optional)"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-32">
            <input
              type="text"
              placeholder="Zip Code"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <SafeIcon icon={FiSend} />
            Check Availability & Send Report
          </button>
        </form>
        {error && <p className="text-rose-400 text-sm">{error}</p>}
      </div>
    </section>
  );
}
