import { useState } from 'react';
import { applicationService } from '@astro/shared';
import Layout from '../components/Layout';

// Public astrologer recruitment / onboarding form. Anyone with the link
// (including customers via the "Join as astrologer" link) can submit.
// After submission they get a reference token to share with our team.
// Admin reviews in /admin-astro-applications.
const EMPTY = {
  fullName: '', email: '', phone: '', gender: 'female', dob: '',
  city: '',
  languages: '', skills: '', experienceYears: '', bio: '',
  expectedRate: '', referredBy: '', why: '',
};

export default function RegisterAsAstrologer() {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);   // { token } on success
  const [err, setErr] = useState('');

  function set(k, v) { setF((p) => ({ ...p, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!f.fullName.trim() || !f.email.trim() || !f.phone.trim()) {
      setErr('Name, email and phone are required.'); return;
    }
    if (!f.skills.trim() || !f.languages.trim()) {
      setErr('Please tell us your skills and languages.'); return;
    }
    if (!f.why.trim() || f.why.trim().length < 20) {
      setErr('Please tell us why you would like to join (at least 20 '
        + 'characters).'); return;
    }
    setBusy(true);
    try {
      const r = await applicationService.submitApplication(f);
      setDone(r);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) {
      setErr(`Could not submit. ${e2.message || ''}`);
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <Layout>
        <div className="card mx-auto max-w-lg text-center">
          <div className="text-4xl">🌟</div>
          <h1 className="mt-2 text-xl font-bold">Application received</h1>
          <p className="mt-2 text-sm text-sub-text">
            Thank you. Our recruitment team will review your application
            and reach out to you on the email you shared. Keep your
            reference token safe in case you need to follow up.
          </p>
          <div className="mt-4 rounded-2xl border-2 border-dashed
            border-primary p-4">
            <div className="text-[11px] font-bold uppercase
              tracking-wider text-sub-text">Your reference token</div>
            <div className="mt-1 text-2xl font-bold tracking-widest
              text-primary">
              {done.token}
            </div>
          </div>
          <p className="mt-4 text-[11px] text-sub-text">
            Next steps: a screening call, KYC + bank details, agreement
            sign-off, and account approval. You will be guided through
            each step over email.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-2xl font-bold">Join AstroSeer as an
          astrologer</h1>
        <p className="mb-4 text-sm text-sub-text">
          Tell us a little about yourself. We review every application
          personally and reach out to shortlisted astrologers within a
          few working days for a brief screening call.
        </p>
        {err && (
          <div className="card mb-3 bg-danger/10 text-sm text-danger">
            {err}
          </div>
        )}
        <form onSubmit={submit} className="card space-y-3">
          {/* Identity */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <F label="Full name *">
              <input className="input" value={f.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                required />
            </F>
            <F label="Gender *">
              <select className="input" value={f.gender}
                onChange={(e) => set('gender', e.target.value)}>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </F>
            <F label="Email *">
              <input className="input" type="email" value={f.email}
                onChange={(e) => set('email', e.target.value)}
                required />
            </F>
            <F label="Phone (with country code) *">
              <input className="input" type="tel" value={f.phone}
                onChange={(e) => set('phone', e.target.value)}
                required />
            </F>
            <F label="Date of birth">
              <input className="input" type="date" value={f.dob}
                onChange={(e) => set('dob', e.target.value)} />
            </F>
            <F label="City">
              <input className="input" value={f.city}
                onChange={(e) => set('city', e.target.value)} />
            </F>
          </div>

          {/* Practice */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <F label="Languages you consult in (comma separated) *">
              <input className="input" value={f.languages}
                placeholder="e.g. Hindi, English, Tamil"
                onChange={(e) => set('languages', e.target.value)}
                required />
            </F>
            <F label="Skills (comma separated) *">
              <input className="input" value={f.skills}
                placeholder="e.g. Vedic, KP, Numerology, Tarot, Vastu"
                onChange={(e) => set('skills', e.target.value)}
                required />
            </F>
            <F label="Years of experience">
              <input className="input" type="number" min={0}
                value={f.experienceYears}
                onChange={(e) => set('experienceYears', e.target.value)} />
            </F>
            <F label="Expected per-minute rate (₹)">
              <input className="input" type="number" min={0}
                value={f.expectedRate}
                onChange={(e) => set('expectedRate', e.target.value)} />
            </F>
          </div>
          <F label="Short bio">
            <textarea className="input" rows={3} value={f.bio}
              placeholder="A short introduction shown on your profile."
              onChange={(e) => set('bio', e.target.value)} />
          </F>
          <F label="Why would you like to join AstroSeer? *">
            <textarea className="input" rows={4} value={f.why}
              placeholder="Tell us about your motivation, the kind of
                clients you love working with, and what makes you
                different."
              onChange={(e) => set('why', e.target.value)} required />
          </F>
          <F label="Referred by (optional)">
            <input className="input" value={f.referredBy}
              placeholder="Name / code of the astrologer or team member"
              onChange={(e) => set('referredBy', e.target.value)} />
          </F>

          <button disabled={busy} className="btn-primary w-full">
            {busy ? 'Submitting…' : 'Submit application'}
          </button>
          <p className="text-[11px] text-sub-text">
            After we receive this, our team will email you with the next
            steps (screening call, KYC, bank verification, agreement and
            account approval).
          </p>
        </form>
      </div>
    </Layout>
  );
}

function F({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase
        tracking-wider text-sub-text">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
