import { useState } from 'react';
import Link from 'next/link';
import {
  applicationService, authService,
  LANGUAGES, SKILLS, EXPERIENCE_BUCKETS,
} from '@astro/shared';
import Layout from '../components/Layout';
import { DateField, CityField } from '../components/BirthInputs';
import PhoneInput from '../components/PhoneInput';

// Public astrologer recruitment / onboarding form. Anyone with the
// link (including customers via the "Join as astrologer" link) can
// submit. Flow:
//   1. Fill the form (DOB picker is dd-mm-yyyy, city uses Places-style
//      autocomplete, languages + skills are chip multiselects, years
//      is a bucketed dropdown).
//   2. Hit "Send email code" -> relay sends a 6-digit OTP to the
//      entered email. Submit stays disabled until they paste the
//      code back and we verify it.
//   3. Submit. We block duplicate active astrologers + applicants
//      with >=6 prior rejections in the same email.
//   4. Success screen shows a 6-digit tracking token + tracking
//      link. Same token + link go out in the confirmation email.
//      Admin reviews in /admin-astro-applications.
const EMPTY = {
  fullName: '', email: '', phone: '+91', gender: 'female', dob: '',
  city: '', cityMeta: null,
  languages: [], skills: [], experienceYears: '', bio: '',
  expectedRate: '', referredBy: '', why: '',
  username: '', password: '', password2: '',
};

export default function RegisterAsAstrologer() {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState('');
  // Email OTP gate.
  const [otp, setOtp] = useState({
    sent: false, verified: false, code: '', sending: false,
    verifying: false, message: '',
  });
  // Username availability state. `state` cycles idle -> checking
  // -> available | taken | invalid.
  const [uname, setUname] = useState({ state: 'idle', message: '' });
  async function checkUsername() {
    const v = applicationService.normaliseUsername(f.username);
    setF((p) => ({ ...p, username: v }));
    if (!v || v.length < 3) {
      setUname({ state: 'invalid',
        message: 'Use 3-24 lowercase letters, digits, _ or -.' });
      return;
    }
    setUname({ state: 'checking', message: 'Checking availability...' });
    try {
      const r = await applicationService.isUsernameAvailable(v);
      if (r.available) {
        setUname({ state: 'available',
          message: `astroseer.in/a/${v} is yours.` });
      } else {
        const reasons = {
          empty: 'Username is required.',
          too_short: 'Username must be at least 3 characters.',
          reserved: 'That username is reserved.',
          taken: 'Already taken by another astrologer.',
          pending: 'Another applicant has claimed this username.',
          check_failed: r.message || 'Could not check right now.',
        };
        setUname({ state: 'taken',
          message: reasons[r.reason] || 'Not available.' });
      }
    } catch (e) {
      setUname({ state: 'invalid',
        message: 'Could not check right now. Try again.' });
    }
  }

  function set(k, v) { setF((p) => ({ ...p, [k]: v })); }

  function toggleMulti(k, value) {
    setF((p) => {
      const cur = p[k] || [];
      return {
        ...p,
        [k]: cur.includes(value)
          ? cur.filter((x) => x !== value)
          : [...cur, value],
      };
    });
  }

  async function sendOtp() {
    setErr('');
    if (!f.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
      setErr('Please enter a valid email address first.'); return;
    }
    // Pre-flight: don't send a code only to refuse the submit later.
    setOtp((o) => ({ ...o, sending: true, message: '' }));
    try {
      const guard = await applicationService.canApply(f.email);
      if (!guard.allowed) {
        const msg = {
          active: 'This email is already an active astrologer. '
            + 'Please log in to the astrologer app instead.',
          inProgress: 'You already have a live application. '
            + 'Use the tracking link with your email + token to '
            + 'check status.',
          maxRejections: 'This email has reached the maximum number '
            + 'of application attempts. Please contact support.',
        }[guard.reason] || 'Application not allowed for this email.';
        setErr(msg);
        return;
      }
      await authService.requestEmailOtp(f.email, f.fullName);
      setOtp((o) => ({
        ...o, sent: true, sending: false,
        message: 'We emailed a 6-digit code. It expires in 10 minutes.',
      }));
    } catch (e) {
      setOtp((o) => ({ ...o, sending: false, message: '' }));
      setErr(`Could not send code. ${e.message || ''}`);
    } finally {
      setOtp((o) => ({ ...o, sending: false }));
    }
  }

  async function verifyOtp() {
    setErr('');
    if (!/^\d{6}$/.test(otp.code.trim())) {
      setErr('Enter the 6-digit code from the email.'); return;
    }
    setOtp((o) => ({ ...o, verifying: true }));
    try {
      await authService.verifyEmailOtp(f.email, otp.code.trim());
      setOtp((o) => ({
        ...o, verified: true, verifying: false,
        message: 'Email verified. You can now submit.',
      }));
    } catch (e) {
      setOtp((o) => ({ ...o, verifying: false }));
      setErr(`Code rejected. ${e.message || ''}`);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!f.fullName.trim() || !f.email.trim() || !f.phone.trim()) {
      setErr('Name, email and phone are required.'); return;
    }
    if (!otp.verified) {
      setErr('Please verify your email with the 6-digit code first.');
      return;
    }
    if (f.languages.length === 0) {
      setErr('Pick at least one consulting language.'); return;
    }
    if (f.skills.length === 0) {
      setErr('Pick at least one skill.'); return;
    }
    if (!f.experienceYears) {
      setErr('Select your years of experience.'); return;
    }
    if (!f.why.trim() || f.why.trim().length < 20) {
      setErr('Please tell us why you would like to join '
        + '(at least 20 characters).');
      return;
    }
    // Username gate. Required + must have passed availability check.
    if (!f.username || uname.state !== 'available') {
      setErr('Please choose a username and confirm availability '
        + 'before submitting.');
      return;
    }
    // Applicant-chosen password so they can log in immediately and
    // track their KYC / upload progress. Minimum 8 chars + must
    // match confirmation.
    if (!f.password || f.password.length < 8) {
      setErr('Choose a password (at least 8 characters).');
      return;
    }
    if (f.password !== f.password2) {
      setErr('Passwords do not match. Re-enter the confirmation.');
      return;
    }
    setBusy(true);
    try {
      const r = await applicationService.submitApplication({
        ...f,
        emailVerified: true,
      });
      setDone(r);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) {
      setErr(e2.message || 'Could not submit.');
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <Layout>
        <div className="card mx-auto max-w-lg text-center">
          <h1 className="text-xl font-bold">Application received</h1>
          <p className="mt-2 text-sm text-sub-text">
            Thank you. Our recruitment team will review your
            application and reach out on the email you shared. We've
            also emailed you the token + tracking link below.
          </p>
          <div className="mt-4 rounded-2xl border-2 border-dashed
            border-primary p-4">
            <div className="text-[11px] font-bold uppercase
              tracking-wider text-sub-text">Your tracking token</div>
            <div className="mt-1 text-3xl font-bold tracking-[0.4em]
              text-primary">
              {done.token}
            </div>
          </div>
          <Link href="/track-application"
            className="mt-4 inline-block rounded-full bg-primary px-4
              py-2 text-sm font-bold text-white">
            Track my application
          </Link>
          <p className="mt-4 text-[11px] text-sub-text">
            Use this token + your registered email to check the
            status any time. Next steps will be sent on the same email:
            screening call, KYC, bank verification, agreement, and
            account approval.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-2xl">
        <div className="mb-3 flex flex-wrap items-center
          justify-between gap-2">
          <h1 className="text-2xl font-bold">Join AstroSeer as an
            astrologer</h1>
          <Link href="/track-application"
            className="text-xs font-bold text-primary underline">
            Already applied? Track here →
          </Link>
        </div>
        <p className="mb-4 text-sm text-sub-text">
          Tell us a little about yourself. We review every application
          personally and reach out to shortlisted astrologers within
          a few working days for a brief screening call.
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

            {/* Email + OTP. We block the rest of the form until the
                applicant verifies their email so we never collect a
                full application for an unreachable address. */}
            <F label="Email *">
              <div className="flex gap-2">
                <input className="input" type="email" value={f.email}
                  disabled={otp.verified}
                  onChange={(e) => {
                    set('email', e.target.value);
                    setOtp({ sent: false, verified: false, code: '',
                      sending: false, verifying: false, message: '' });
                  }}
                  required />
                {!otp.verified && (
                  <button type="button" onClick={sendOtp}
                    disabled={otp.sending || !f.email}
                    className="shrink-0 rounded-full bg-primary px-3
                      py-1 text-[11px] font-bold text-white
                      disabled:opacity-50">
                    {otp.sending ? '…' : otp.sent
                      ? 'Resend code' : 'Send email code'}
                  </button>
                )}
                {otp.verified && (
                  <span className="self-center text-[11px]
                    font-bold text-success">verified ✓</span>
                )}
              </div>
              {otp.sent && !otp.verified && (
                <div className="mt-2 flex gap-2">
                  <input className="input" inputMode="numeric"
                    maxLength={6} placeholder="6-digit code"
                    value={otp.code}
                    onChange={(e) => setOtp((o) => ({
                      ...o, code: e.target.value.replace(/\D/g, '')
                        .slice(0, 6) }))} />
                  <button type="button" onClick={verifyOtp}
                    disabled={otp.verifying || otp.code.length !== 6}
                    className="shrink-0 rounded-full bg-success px-3
                      py-1 text-[11px] font-bold text-white
                      disabled:opacity-50">
                    {otp.verifying ? '…' : 'Verify code'}
                  </button>
                </div>
              )}
              {otp.message && (
                <p className="mt-1 text-[10px] text-sub-text">
                  {otp.message}
                </p>
              )}
            </F>

            <F label="Phone *">
              <PhoneInput value={f.phone}
                onChange={(v) => set('phone', v)}
                placeholder="Mobile number" />
            </F>

            <F label="Date of birth (dd-mm-yyyy)">
              <DateField value={f.dob}
                onChange={(v) => set('dob', v)}
                label="" />
            </F>

            <F label="City">
              <CityField
                value={f.city || ''}
                label=""
                onChange={(meta) => {
                  if (meta && typeof meta === 'object') {
                    set('city', meta.place || '');
                    set('cityMeta', {
                      place: meta.place || '',
                      city: meta.city || '',
                      state: meta.state || '',
                      country: meta.country || '',
                      countryCode: meta.countryCode || '',
                      lat: meta.lat || null,
                      lng: meta.lng || null,
                      tz: meta.tz || null,
                    });
                  }
                }} />
            </F>
          </div>

          {/* Practice - multiselect chips for languages + skills,
              bucketed dropdown for years. No more comma-separated
              text fields. */}
          <F label="Languages you consult in *">
            <MultiSelectChips
              options={LANGUAGES}
              value={f.languages}
              onToggle={(v) => toggleMulti('languages', v)} />
          </F>

          <F label="Skills *">
            <MultiSelectChips
              options={SKILLS}
              value={f.skills}
              onToggle={(v) => toggleMulti('skills', v)} />
          </F>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <F label="Years of experience *">
              <select className="input" value={f.experienceYears}
                onChange={(e) =>
                  set('experienceYears', e.target.value)} required>
                <option value=""> - select - </option>
                {EXPERIENCE_BUCKETS.map((b) => (
                  <option key={b.value}
                    value={b.value}>{b.label}</option>
                ))}
              </select>
            </F>
            <F label="Expected per-minute rate (₹)">
              <input className="input" type="number" min={0}
                value={f.expectedRate}
                onChange={(e) =>
                  set('expectedRate', e.target.value)} />
            </F>
          </div>

          {/* Public profile URL + login password. Each astrologer's
              public page lives at astroseer.in/a/<username>, so we
              ask the applicant to pick their slug here with a live
              availability check. The password lets them sign into
              the astrologer app immediately to track KYC, upload
              docs, chat with the recruitment team etc. - so they
              don't have to wait for admin to provision an account. */}
          <div className="rounded-2xl border border-gray-200
            bg-bg-light/30 p-4">
            <h2 className="mb-2 text-sm font-bold uppercase
              tracking-wider text-sub-text">
              Profile URL + login
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <F label="Username (public profile slug) *">
                <div className="flex gap-2">
                  <div className="flex items-center rounded-xl
                    border border-gray-200 bg-white px-2 text-xs
                    text-sub-text">astroseer.in/a/</div>
                  <input className="input flex-1 font-mono"
                    placeholder="e.g. saira-kapoor"
                    value={f.username}
                    onChange={(e) => {
                      set('username', e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_-]/g, ''));
                      setUname({ state: 'idle', message: '' });
                    }} />
                  <button type="button" onClick={checkUsername}
                    disabled={!f.username
                      || uname.state === 'checking'}
                    className="shrink-0 rounded-full bg-primary
                      px-3 py-1 text-[11px] font-bold text-white
                      disabled:opacity-50">
                    {uname.state === 'checking' ? '...' : 'Check'}
                  </button>
                </div>
                {uname.message && (
                  <p className={`mt-1 text-[11px] font-semibold
                    ${uname.state === 'available'
                      ? 'text-success'
                      : uname.state === 'taken'
                        || uname.state === 'invalid'
                        ? 'text-danger'
                        : 'text-sub-text'}`}>
                    {uname.state === 'available' ? '✓ ' : ''}
                    {uname.message}
                  </p>
                )}
              </F>
              <F label="Password (min 8 chars) *">
                <input className="input" type="password"
                  minLength={8}
                  placeholder="At least 8 characters"
                  value={f.password}
                  onChange={(e) => set('password', e.target.value)} />
              </F>
              <F label="Confirm password *">
                <input className="input" type="password"
                  minLength={8}
                  placeholder="Re-enter the password"
                  value={f.password2}
                  onChange={(e) => set('password2', e.target.value)} />
              </F>
            </div>
            <p className="mt-2 text-[11px] text-sub-text">
              You can sign in to the astrologer app immediately with
              this username + password to track your KYC, upload
              documents, and chat with the recruitment team.
            </p>
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
          <F label="Invitation / referral code (optional)">
            <input className="input"
              value={f.referredBy}
              placeholder="6-character astrologer code (e.g. ABC123)"
              maxLength={10}
              onChange={(e) => set('referredBy',
                e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <p className="mt-1 text-[10px] text-sub-text">
              If an existing AstroSeer astrologer referred you, paste
              their code here. They earn a bonus once you complete
              your first paid 30-minute session.
            </p>
          </F>

          <button disabled={busy || !otp.verified}
            className="btn-primary w-full disabled:opacity-60">
            {busy ? 'Submitting…'
              : !otp.verified ? 'Verify your email to enable submit'
                : 'Submit application'}
          </button>
          <p className="text-[11px] text-sub-text">
            After we receive this, our team will email you with the
            next steps (screening call, KYC, bank verification,
            agreement and account approval). You will also get a
            6-digit token + tracking link to check status any time.
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

// Chip-style multi-select. Each option is a button that toggles
// presence in the value[] array. Selected chips get the primary fill,
// unselected ones get a white outline.
function MultiSelectChips({ options, value, onToggle }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button"
            onClick={() => onToggle(o)}
            className={`rounded-full border px-3 py-1 text-[11px]
              font-bold transition ${on
                ? 'border-primary bg-primary text-white'
                : 'border-gray-300 bg-white text-sub-text '
                  + 'hover:border-primary hover:text-primary'}`}>
            {on ? '✓ ' : ''}{o}
          </button>
        );
      })}
    </div>
  );
}
