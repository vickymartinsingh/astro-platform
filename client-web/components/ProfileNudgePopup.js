import { useEffect, useState } from 'react';
import { profileNudgeService, userService } from '@astro/shared';
import { useAuth } from '../lib/useAuth';
import PhoneInput from './PhoneInput';

// Profile-completion popup (2026-06-07 spec).
//
// Boot-time decision lives in profileNudgeService.shouldShowNudge.
// We re-evaluate on:
//   - first mount (signed in + profile loaded)
//   - whenever the user doc changes (e.g. admin pushes a manual nudge)
//   - whenever the visibility changes back to "visible" (returning to
//     foreground - the moment "next time the user opens the app").
//
// When the customer fills the missing fields and taps Save, we write
// the values to users/{uid} via userService.updateProfile and then
// call markNudgeCompleted to clear the admin push hook.
//
// Tapping "Later" calls markNudgeDismissed which stamps lastShownAt so
// the global throttle (intervalHours) suppresses the popup until next
// window.

const GENDER_OPTIONS = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['other', 'Other'],
];

export default function ProfileNudgePopup() {
  const { user, profile } = useAuth();
  const [decision, setDecision] = useState(null);     // null | {show,fields,...}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Form state, only the fields we need to ask are rendered.
  const [phone, setPhone] = useState('');
  const [dialCode, setDialCode] = useState('+91');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [tob, setTob] = useState('');
  const [pob, setPob] = useState('');
  const [name, setName] = useState('');

  // Re-evaluate whether to show the popup any time the user profile
  // changes (admin push lands via the user doc snapshot inside useAuth)
  // or the tab returns to foreground.
  useEffect(() => {
    let cancelled = false;
    async function evaluate() {
      if (!user || !profile) { setDecision(null); return; }
      // If we just collected the missing fields - profile reflects
      // them now - the decision flips to {show:false} naturally.
      const r = await profileNudgeService.shouldShowNudge(
        user.uid, profile);
      if (cancelled) return;
      setDecision(r);
      if (r && r.show) {
        // Pre-fill form with whatever the user already has so we don't
        // wipe partial data.
        setPhone(String(profile.phone || ''));
        setDialCode(String(profile.dialCode || '+91'));
        setGender(String(profile.gender || ''));
        setDob(String(profile.dob || ''));
        setTob(String(profile.tob || ''));
        setPob(String(profile.pob || ''));
        setName(String(profile.name || ''));
        // Stamp lastShownAt so the throttle counts from NOW.
        profileNudgeService.markNudgeShown(user.uid).catch(() => {});
      }
    }
    evaluate();
    function onVis() {
      if (document.visibilityState === 'visible') evaluate();
    }
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user, profile]);

  if (!decision || !decision.show || !user) return null;
  const fields = decision.fields || [];

  function need(k) { return fields.includes(k); }

  async function save() {
    setErr(''); setBusy(true);
    const patch = {};
    if (need('name')) {
      if (!name.trim()) {
        setErr('Please enter your full name.'); setBusy(false); return;
      }
      patch.name = name.trim();
    }
    if (need('phone')) {
      const cleaned = String(phone || '').replace(/[^0-9]/g, '');
      if (cleaned.length < 6) {
        setErr('Please enter a valid mobile number.');
        setBusy(false); return;
      }
      patch.phone = cleaned;
      patch.dialCode = dialCode || '+91';
    }
    if (need('gender')) {
      if (!gender) {
        setErr('Please select your gender.'); setBusy(false); return;
      }
      patch.gender = gender;
    }
    if (need('dob')) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        setErr('Please enter a valid date of birth (YYYY-MM-DD).');
        setBusy(false); return;
      }
      patch.dob = dob;
    }
    if (need('tob') && tob) patch.tob = tob;
    if (need('pob') && pob.trim()) patch.pob = pob.trim();
    try {
      await userService.updateUser(user.uid, patch);
      await profileNudgeService.markNudgeCompleted(user.uid);
      setDecision({ show: false });
    } catch (e) {
      setErr((e && e.message) || 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function later() {
    if (busy) return;
    try {
      await profileNudgeService.markNudgeDismissed(user.uid);
    } catch (_) { /* swallow */ }
    setDecision({ show: false });
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 85,
      background: 'rgba(15, 7, 8, 0.6)',
      display: 'flex', alignItems: 'flex-end',
      justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 520, background: '#fff',
        borderTopLeftRadius: 22, borderTopRightRadius: 22,
        padding: '20px 18px 24px',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: '#FFF1E6', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 12px', fontSize: 24, color: '#7F2020',
        }}>👤</div>
        <h2 style={{
          margin: '0 0 6px', textAlign: 'center',
          fontSize: 18, fontWeight: 700, color: '#2A1A1A',
        }}>
          Complete your profile
        </h2>
        <p style={{
          margin: '0 0 14px', textAlign: 'center', color: '#5C4A4A',
          fontSize: 13,
        }}>
          {decision.source === 'admin' && decision.message
            ? decision.message
            : 'A few details are missing. Add them so your kundli, '
              + 'reports and astrologer matches stay accurate.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column',
          gap: 12 }}>
          {need('name') && (
            <Field label="Full name">
              <input type="text" value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="As on your kundli"
                style={inputStyle} />
            </Field>
          )}
          {need('phone') && (
            <Field label="Mobile number">
              <PhoneInput value={phone} onChange={setPhone}
                dialCode={dialCode} onDialCode={setDialCode} />
            </Field>
          )}
          {need('gender') && (
            <Field label="Gender">
              <div style={{ display: 'flex', gap: 8 }}>
                {GENDER_OPTIONS.map(([code, label]) => (
                  <button key={code} type="button"
                    onClick={() => setGender(code)}
                    style={{
                      flex: 1, padding: '10px 12px', fontSize: 13,
                      fontWeight: 600, borderRadius: 12,
                      border: '1px solid',
                      borderColor: gender === code ? '#7F2020' : '#E5D9CC',
                      background: gender === code ? '#7F2020' : '#fff',
                      color: gender === code ? '#fff' : '#5C4A4A',
                      cursor: 'pointer',
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {need('dob') && (
            <Field label="Date of birth">
              <input type="date" value={dob}
                onChange={(e) => setDob(e.target.value)}
                style={inputStyle} />
            </Field>
          )}
          {need('tob') && (
            <Field label="Time of birth (optional)">
              <input type="time" value={tob}
                onChange={(e) => setTob(e.target.value)}
                style={inputStyle} />
            </Field>
          )}
          {need('pob') && (
            <Field label="Place of birth">
              <input type="text" value={pob}
                onChange={(e) => setPob(e.target.value)}
                placeholder="City, state, country"
                style={inputStyle} />
            </Field>
          )}
          {need('email') && (
            <Field label="Email">
              <div style={{ ...inputStyle, color: '#5C4A4A',
                background: '#FAF7F2' }}>
                {profile?.email || '(missing)'}
              </div>
            </Field>
          )}
        </div>

        {err && (
          <div style={{
            marginTop: 12, padding: '10px 12px',
            borderRadius: 10, fontSize: 13,
            background: '#FEE2E2', color: '#7F1D1D',
          }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {decision.source !== 'admin' && (
            <button type="button" onClick={later} disabled={busy}
              style={{
                flex: 1, padding: '12px 16px', fontSize: 14,
                fontWeight: 600, background: '#fff',
                color: '#7F2020', border: '1px solid #7F2020',
                borderRadius: 999, cursor: 'pointer',
              }}>
              Later
            </button>
          )}
          <button type="button" onClick={save} disabled={busy}
            style={{
              flex: decision.source === 'admin' ? 1 : 2,
              padding: '12px 16px', fontSize: 14,
              fontWeight: 700, background: '#7F2020',
              color: '#fff', border: 0,
              borderRadius: 999, cursor: 'pointer',
              opacity: busy ? 0.6 : 1,
            }}>
            {busy ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 12px', fontSize: 14,
  border: '1px solid #E5D9CC', borderRadius: 12,
  background: '#FAF7F2', color: '#2A1A1A',
  fontFamily: 'inherit',
};

function Field({ label, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 0.5, color: '#5C4A4A', marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}
