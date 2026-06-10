import { useState } from 'react';
import { abuseService } from '@astro/shared';
import useScrollLock from '../lib/useScrollLock';
import { DateField } from './BirthInputs';

// Report an astrologer. Name + mobile + email are mandatory, a reason
// must be picked, and the description must be at least 100 characters.
// DOB (calendar) is optional. Admin is notified on submit.
const MIN_DESC = 100;

export default function ReportAstrologerModal({ astro, by, onClose }) {
  useScrollLock(true);
  const [f, setF] = useState({
    name: by?.name || '',
    email: by?.email || '',
    phone: by?.phone || '',
    dob: by?.dob || '',
    reason: '',
    description: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const phoneOk = f.phone.replace(/\D/g, '').length >= 10;

  async function submit() {
    setErr('');
    if (!f.name.trim()) { setErr('Please enter your name.'); return; }
    if (!phoneOk) { setErr('Enter a valid mobile number.'); return; }
    if (!emailOk) { setErr('Enter a valid email address.'); return; }
    if (!f.reason) { setErr('Please choose a reason.'); return; }
    if (f.description.trim().length < MIN_DESC) {
      setErr(`Description must be at least ${MIN_DESC} characters `
        + `(currently ${f.description.trim().length}).`);
      return;
    }
    setBusy(true);
    try {
      await abuseService.reportAstrologer({
        astroId: astro?.id, astroName: astro?.name,
        byUid: by?.uid, ...f,
      });
      setDone(true);
    } catch (e) {
      setErr(e?.message || 'Could not submit. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[2147483646] flex items-center
      justify-center bg-black/60 px-4">
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto
        rounded-2xl bg-white p-5 shadow-2xl">
        {done ? (
          <div className="text-center">
            <div className="text-4xl">✅</div>
            <div className="mt-2 text-lg font-bold">Report submitted</div>
            <p className="mt-1 text-sm text-sub-text">
              Thank you. Our team will review this and take appropriate
              action to keep the platform safe and fair.
            </p>
            <button onClick={onClose}
              className="btn-primary mt-4 w-full">Close</button>
          </div>
        ) : (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-bold">Report astrologer</h2>
              <button onClick={onClose} aria-label="Close"
                className="rounded-lg border border-gray-200 px-2.5
                  py-1 text-sm">✕</button>
            </div>
            <p className="mb-3 text-xs text-sub-text">
              Reporting {astro?.name || 'this astrologer'}. This helps us
              keep the platform fair, safe and compliant. Misuse of
              reporting may affect your account.
            </p>
            <div className="space-y-3">
              <input className="input" placeholder="Your name *"
                value={f.name}
                onChange={(e) => set('name', e.target.value)} />
              <input className="input" type="tel"
                placeholder="Mobile number *" value={f.phone}
                onChange={(e) => set('phone', e.target.value)} />
              <input className="input" type="email"
                placeholder="Email *" value={f.email}
                onChange={(e) => set('email', e.target.value)} />
              <DateField value={f.dob}
                onChange={(v) => set('dob', v)}
                label="Date of birth (optional)" />
              <div>
                <label className="text-sm text-sub-text">Reason *</label>
                <select className="input mt-1" value={f.reason}
                  onChange={(e) => set('reason', e.target.value)}>
                  <option value="">Select a reason...</option>
                  {abuseService.REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <textarea className="input" rows={4}
                  placeholder="Describe what happened (min 100 characters) *"
                  value={f.description}
                  onChange={(e) => set('description', e.target.value)} />
                <div className={`mt-1 text-right text-xs ${
                  f.description.trim().length >= MIN_DESC
                    ? 'text-success' : 'text-sub-text'}`}>
                  {f.description.trim().length}/{MIN_DESC}
                </div>
              </div>
              {err && <div className="text-sm text-danger">{err}</div>}
              <button onClick={submit} disabled={busy}
                className="btn-primary w-full">
                {busy ? 'Submitting...' : 'Submit report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
