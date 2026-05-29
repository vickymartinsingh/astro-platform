import { useState } from 'react';
import Link from 'next/link';
import { authService, userService } from '@astro/shared';
import { DateField } from './BirthInputs';
import { useSettings } from '../lib/useSettings';

// Email + Google sign-in card. Reused by the /login page and the login
// popup. Calls onDone(user) after a successful, allowed sign-in.
export default function LoginCard({ onDone, compact, initialMode }) {
  const { features } = useSettings();
  const [mode, setMode] = useState(
    initialMode === 'signup' ? 'signup' : 'login'); // login | signup
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // OTP step state. Only entered when the admin has
  // settings/features.email_verification === true AND the user is
  // creating a fresh account (mode === 'signup'). otpUser holds the
  // freshly-created Firebase user so we can complete sign-in once the
  // OTP verifies; while otpUser is set, the form re-renders as the
  // OTP-entry screen instead of the email/password fields.
  const [otpUser, setOtpUser] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpInfo, setOtpInfo] = useState('');

  // Hard timeout for any auth promise. Firebase Auth occasionally hangs
  // (flaky network, IndexedDB lock, popup race) and never resolves OR
  // rejects, which used to leave the button stuck on "Please wait..."
  // forever. We race the auth call against a timeout so the UI ALWAYS
  // unsticks within `ms` and the user can retry.
  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const e = new Error(`${label} timed out after ${ms / 1000}s`);
          e.code = 'auth/timeout';
          reject(e);
        }, ms);
      }),
    ]);
  }

  async function finish(user) {
    const p = await withTimeout(userService.getUser(user.uid), 15000,
      'Profile lookup');
    if (p && p.isBlocked) {
      await authService.logoutUser();
      setErr('Your account has been suspended. Contact support.');
      return;
    }
    if (p && (p.role === 'astrologer' || p.role === 'admin')) {
      await authService.logoutUser();
      setErr(`Please use the ${p.role} portal to sign in.`);
      return;
    }
    onDone && onDone(user);
  }

  async function submit(e) {
    e.preventDefault();
    // Re-entrancy guard: ignore submits while one is in flight so a
    // double-click doesn't stack runaway auth promises.
    if (busy) return;
    // Validate BEFORE flipping busy, so a bad field never traps the
    // button in the "Please wait..." state.
    if (mode === 'signup') {
      if (!name.trim()) { setErr('Enter your full name.'); return; }
      // Indian mobile numbers are exactly 10 digits. The form strips
      // anything non-digit (spaces, dashes, leading +91 if user typed
      // it) before checking the length.
      const digits = phone.replace(/\D/g, '').replace(/^91/, '');
      if (digits.length !== 10) {
        setErr('Mobile number must be exactly 10 digits.'); return;
      }
      if (!gender) {
        setErr('Please select your gender.'); return;
      }
      if (!/^\d{2}-\d{2}-\d{4}$/.test(dob)) {
        setErr('Please select your date of birth.'); return;
      }
      if (!email.trim() || !/.+@.+\..+/.test(email.trim())) {
        setErr('Enter a valid email.'); return;
      }
      if (password.length < 6) {
        setErr('Password must be at least 6 characters.'); return;
      }
    }
    setErr(''); setBusy(true);
    try {
      let user;
      if (mode === 'signup') {
        user = await withTimeout(
          authService.signupUser(name.trim(), email.trim(),
            password, { phone: phone.replace(/\D/g, '').replace(/^91/, ''),
              dob, gender }),
          25000, 'Signup');
        // Admin-toggled email verification:
        // settings/features.email_verification === true forces a
        // 6-digit OTP sent from support@astroseer.in before the new
        // user is signed in. Default OFF: signup completes as before.
        // Belt-and-braces: also peek at the localStorage cache in case
        // the in-memory `features` prop hasn't hydrated yet (the form
        // can be submitted before the live snapshot lands).
        let liveFeatures = features;
        try {
          if ((!liveFeatures || liveFeatures.email_verification == null)
            && typeof localStorage !== 'undefined') {
            const cached = JSON.parse(
              localStorage.getItem('settings_features') || '{}');
            liveFeatures = { ...(features || {}), ...cached };
          }
        } catch (_) { /* ignore */ }
        if (liveFeatures && liveFeatures.email_verification === true) {
          try {
            // Sign the freshly-created user OUT immediately so the
            // AuthModalProvider's auto-close-on-login effect does NOT
            // fire and yank the modal away from us. We re-sign-in
            // with the same email/password after the OTP verifies.
            try { await authService.logoutUser(); } catch (_) { /* ignore */ }
            await authService.requestEmailOtp(email.trim(), name.trim());
            setOtpUser({
              email: email.trim(),
              password,
              displayName: name.trim(),
            });
            setOtpInfo(`We just emailed a 6-digit code to ${email.trim()}.`
              + ' Please enter it below to finish signing up.');
            return;
          } catch (e3) {
            // OTP send failed - keep the user logged in so they aren't
            // locked out, but surface the error.
            setErr('Could not send the verification email: '
              + (e3 && e3.message || 'unknown') + '. You can still '
              + 'continue but the operator has been notified.');
            // Try to re-login so the user lands on home (we logged out
            // above as part of the OTP path).
            try {
              user = await authService.loginUser(email.trim(), password);
            } catch (_) { /* user can log in manually */ }
            // Fall through to finish() so the user lands on home
            // rather than being trapped on a non-functional OTP screen.
          }
        }
      } else {
        user = await withTimeout(
          authService.loginUser(email.trim(), password),
          25000, 'Login');
      }
      await finish(user);
    } catch (e2) {
      const code = e2?.code || '';
      if (code === 'auth/timeout') {
        setErr('Network is slow or unavailable. Please check your '
          + 'connection and try again.');
      } else if (mode === 'signup') {
        setErr(code === 'auth/email-already-in-use'
          ? 'That email is already registered.'
          : 'Could not create account.');
      } else {
        setErr('Invalid email or password.');
      }
    } finally {
      // Belt and braces: always release the button, no matter what.
      setBusy(false);
    }
  }

  async function google() {
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const u = await withTimeout(authService.loginWithGoogle(),
        45000, 'Google sign-in');
      // null = a full-page redirect started; the browser navigates
      // away and watchAuth finishes the sign-in on return.
      if (u) await finish(u);
    } catch (e) {
      const c = e?.code || '';
      const msg = String(e?.message || '');
      const native = typeof window !== 'undefined'
        && window.Capacitor
        && typeof window.Capacitor.isNativePlatform === 'function'
        && window.Capacitor.isNativePlatform();
      // Android Google sign-in config not finished (SHA-1 / OAuth
      // client not registered in Firebase): SDK throws code 10 /
      // DEVELOPER_ERROR / ApiException with no auth/* code.
      const isCfg = /DEVELOPER_ERROR|ApiException|: *10\b|status: *10|"?10"?:/i
        .test(`${c} ${msg}`);
      if (c === 'auth/timeout') {
        setErr('Google sign-in took too long. Please try again.');
      } else if (c === 'auth/operation-not-allowed') {
        setErr('Google sign-in is disabled. Enable it in Firebase: '
          + 'Authentication > Sign-in method > Google.');
      } else if (c === 'auth/unauthorized-domain') {
        setErr('This domain is not authorised. Add it in Firebase '
          + 'Auth > Settings > Authorised domains.');
      } else if (c === 'auth/popup-blocked') {
        setErr('Browser blocked the popup. Allow popups and retry.');
      } else if (c === 'auth/popup-closed-by-user'
                 || c === 'auth/cancelled-popup-request'
                 || /cancel/i.test(msg)) {
        setErr('Google sign-in was cancelled. Try again.');
      } else if (native && (isCfg || !c)) {
        setErr('Google sign-in for the app is still being set up on '
          + 'the server (the app fingerprint must be added in '
          + 'Firebase). Please sign in with email and password for '
          + 'now - it works normally.');
      } else if (/unavailable/i.test(msg)) {
        setErr('Google sign-in is not available in this app build. '
          + 'Please use email and password here.');
      } else {
        setErr(`Google sign-in failed (${c || msg || 'unknown'}). `
          + 'Try email/password.');
      }
    } finally { setBusy(false); }
  }

  async function forgot() {
    if (!email.trim()) { setErr('Enter your email first.'); return; }
    try {
      await authService.sendPasswordReset(email.trim());
      setErr('Password reset email sent. Check your inbox.');
    } catch { setErr('Could not send reset email.'); }
  }

  async function verifyOtp(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (busy) return;
    setErr('');
    const code = String(otpCode || '').trim();
    if (!/^\d{6}$/.test(code)) {
      setErr('Enter the 6-digit code from the email.'); return;
    }
    setBusy(true);
    try {
      await authService.verifyEmailOtp(otpUser.email, code);
      // Sign back in with the credentials we held on otpUser - the
      // signup path signed out so the modal would stay open. Now that
      // the email is verified we can finish login normally.
      const user = await withTimeout(
        authService.loginUser(otpUser.email, otpUser.password),
        25000, 'Login');
      setOtpUser(null); setOtpCode(''); setOtpInfo('');
      await finish(user);
    } catch (e2) {
      setErr(e2 && e2.message ? e2.message
        : 'Could not verify the code. Please try again.');
    } finally { setBusy(false); }
  }

  async function resendOtp() {
    if (busy) return;
    setErr(''); setBusy(true);
    try {
      const target = (otpUser && otpUser.email) || email.trim();
      const dn = (otpUser && otpUser.displayName) || name.trim();
      await authService.requestEmailOtp(target, dn);
      setOtpInfo(`A new code has been emailed to ${target}.`);
    } catch (e) {
      setErr(e && e.message ? e.message : 'Could not resend the code.');
    } finally { setBusy(false); }
  }

  return (
    <div className={compact ? '' : 'w-full max-w-md'}>
      <div className="overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="hero-grad p-6 text-white">
          <div className="text-xl font-bold">AstroSeer</div>
          <div className="mt-1 text-2xl font-bold">
            {otpUser ? 'Verify your email'
              : mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </div>
          <p className="mt-1 text-sm opacity-90">
            {otpUser ? 'Enter the 6-digit code from your inbox.'
              : mode === 'signup'
                ? 'Sign up to connect with astrologers.'
                : 'Sign in to continue.'}
          </p>
        </div>
        <div className="p-6">
          {err && (
            <div className="mb-3 rounded-xl bg-rose-50 p-3 text-sm
                            text-rose-600">{err}</div>
          )}
          {otpUser && otpInfo && (
            <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm
                            text-emerald-700">{otpInfo}</div>
          )}
          {otpUser ? (
            <form onSubmit={verifyOtp} className="space-y-3">
              <input className="input text-center tracking-[0.4em]
                font-mono text-2xl" inputMode="numeric"
                placeholder="000000" maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(
                  e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus />
              <button className="btn-grad w-full justify-center py-3"
                disabled={busy || otpCode.length !== 6}>
                {busy ? 'Please wait…' : 'Verify & finish'}
              </button>
              <button type="button" onClick={resendOtp} disabled={busy}
                className="w-full text-sm text-primary">
                Didn&apos;t get the email? Resend code
              </button>
            </form>
          ) : (
          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <>
                <input className="input" placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)} required />
                {/* Indian mobile only - +91 stamped as a non-editable
                    prefix chip so the user just types their 10 digits.
                    The submit handler strips anything non-digit (and a
                    leading 91 if the user pastes it). */}
                <div className="flex items-stretch gap-2">
                  <div className="flex items-center rounded-xl border
                    border-gray-200 bg-bg-light px-3 text-sm font-bold
                    text-sub-text">+91</div>
                  <input className="input flex-1" type="tel"
                    inputMode="numeric" maxLength={10}
                    placeholder="10-digit mobile number"
                    value={phone}
                    onChange={(e) => setPhone(
                      e.target.value.replace(/\D/g, '').slice(0, 10))}
                    required />
                </div>
                {/* Gender is mandatory so we can offer the right
                    pronouns + a sensibly defaulted kundli profile. */}
                <div className="flex gap-2">
                  {['Male', 'Female', 'Other'].map((g) => (
                    <button key={g} type="button"
                      onClick={() => setGender(g)}
                      className={`flex-1 rounded-xl border px-3 py-2
                        text-sm font-semibold transition
                        ${gender === g
                          ? 'border-primary bg-primary text-white'
                          : 'border-gray-200 bg-white text-sub-text'}`}>
                      {g}
                    </button>
                  ))}
                </div>
                <DateField value={dob} onChange={setDob}
                  label="Date of birth" />
              </>
            )}
            <input className="input" type="email" placeholder="Email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              required />
            <input className="input" type="password" placeholder="Password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              required />
            <button className="btn-grad w-full justify-center py-3"
              disabled={busy}>
              {busy ? 'Please wait…'
                : mode === 'signup' ? 'Sign up' : 'Login'}
            </button>
            {mode === 'login' && (
              <button type="button" onClick={forgot}
                className="w-full text-sm text-primary">
                Forgot password?
              </button>
            )}
          </form>
          )}

          {!otpUser && (() => {
            // Admin-toggled per platform (admin -> Feature Toggles):
            //   google_signin_mobile, google_signin_desktop
            // Default: OFF (hidden) until admin explicitly enables. The
            // admin Feature Toggles page has both checkboxes so the
            // operator can re-enable Google sign-in for either platform
            // at any time without a rebuild.
            const isNative = typeof window !== 'undefined'
              && window.Capacitor && window.Capacitor.isNativePlatform
              && window.Capacitor.isNativePlatform();
            const key = isNative ? 'google_signin_mobile'
              : 'google_signin_desktop';
            const showGoogle = !!(features && features[key] === true);
            if (!showGoogle) return null;
            return (
              <>
                <div className="my-4 flex items-center gap-3 text-sm
                                text-sub-text">
                  <span className="h-px flex-1 bg-gray-200" /> OR
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
                <button onClick={google} disabled={busy}
                  className="flex w-full items-center justify-center gap-2
                             rounded-full border border-gray-200 py-3
                             font-semibold hover:bg-bg-light">
                  <span className="text-lg font-bold text-[#4285F4]">
                    G
                  </span>
                  {mode === 'signup' ? 'Sign up with Google'
                    : 'Sign in with Google'}
                </button>
              </>
            );
          })()}

          {!otpUser && (
            <button
              onClick={() => { setErr(''); setMode(
                mode === 'signup' ? 'login' : 'signup'); }}
              className="mt-3 w-full text-center text-sm text-primary">
              {mode === 'signup'
                ? 'Already have an account? Login'
                : 'New here? Create an account'}
            </button>
          )}
          <p className="mt-3 text-center text-xs text-sub-text">
            By continuing you agree to our{' '}
            <Link href="/terms" className="text-primary">Terms</Link>
            {' '}and{' '}
            <Link href="/privacy" className="text-primary">
              Privacy
            </Link>.
          </p>
          {/* Note: "Register as astrologer" is intentionally NOT shown
              here. It lives only as the last item in the side menu and
              only when the admin enables it (features.register_as_astro
              _show). */}
        </div>
      </div>
    </div>
  );
}
