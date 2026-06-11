import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { emailService, authService, adminService, db } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Default HTML for the beta invite (Royal palette only - maroon /
// amber). Editable on this page; saved to settings/email so the
// relay can render it from Firestore at send time.
const DEFAULT_BETA_HTML = `<div style="font-family:system-ui,Inter,Arial,sans-serif;max-width:560px;margin:24px auto;color:#1a1a1a;line-height:1.6">
  <div style="background:linear-gradient(135deg,#D4A12A,#7F2020);color:#fff;padding:24px;border-radius:14px 14px 0 0">
    <div style="font-size:22px;font-weight:700">AstroSeer Beta</div>
    <div style="opacity:.9;margin-top:4px;font-size:13px">You're personally invited to test the app</div>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #eee;border-top:0;border-radius:0 0 14px 14px">
    <p>Namaste {{name}},</p>
    <p>We have hand-picked you to try the early build of <b>AstroSeer</b> - your home for Vedic kundli, daily horoscope, tarot, numerology and 1:1 consultations with verified astrologers.</p>
    <p>Tap the button below to install on Android:</p>
    <p style="text-align:center;margin:24px 0">
      <a href="https://play.google.com/store/apps/details?id=com.astroseer.mobile"
        style="display:inline-block;background:#7F2020;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:700">
        Install AstroSeer (Beta)
      </a>
    </p>
    <p>Prefer the web? Open <a href="https://astroseer.in" style="color:#7F2020">astroseer.in</a>.</p>
    <p style="font-size:12px;color:#666;margin-top:20px">Thanks for being one of the first to try us out.<br>- The AstroSeer team</p>
  </div></div>`;

const BLANK = {
  smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
  smtpFrom: '', smtpSecure: false,
  imapHost: '', imapPort: 993, imapUser: '', imapPass: '',
  protocol: 'imap', adminAlertTo: '',
  // Silent admin BCC: applied to every outbound email the relay
  // sends (welcome, paid kundli, tester invite, OTP, complimentary).
  // Recipient never sees the BCC field. Toggle independently from
  // the address so admin can pause without losing the saved
  // recipient.
  bccEnabled: false,
  bccTo: '',
  // Welcome email controls (separate toggle - admin may want BCC
  // on operational mail but not the welcome flow).
  welcomeEnabled: true,
  welcomeSubject: 'Welcome to AstroSeer',
  // Beta invite template: admin can rewrite both subject and HTML
  // body. The body supports {{name}} which the relay substitutes per
  // recipient. The Play Store + web URLs are baked into the default
  // template (admin can change them in the HTML directly).
  betaInviteSubject: "You're invited to try AstroSeer (Beta)",
  betaInviteHtml: DEFAULT_BETA_HTML,
};

function fmt(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminEmail() {
  const { loading } = useRequireAdmin();
  const router = useRouter();
  const [f, setF] = useState(BLANK);
  const [emails, setEmails] = useState([]);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  // Mirror of settings/features.email_verification so admin can flip
  // OTP-on-signup from this page without leaving for /admin-features.
  // We persist back into settings/features through adminService.
  const [otpRequired, setOtpRequired] = useState(false);

  useEffect(() => {
    emailService.getEmailConfig().then((c) =>
      setF((p) => ({ ...p, ...c }))).catch(() => {});
    // Pull the current OTP toggle from settings/features.
    getDoc(doc(db, 'settings', 'features')).then((s) => {
      if (s.exists() && s.data()) {
        setOtpRequired(!!s.data().email_verification);
      }
    }).catch(() => {});
    return emailService.listenEmails(setEmails);
  }, []);

  if (loading) {
    return <Layout><div className="surface p-4">Loading...</div></Layout>;
  }

  const set = (k) => (e) => setF({
    ...f,
    [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  });

  async function save() {
    setBusy(true);
    try {
      await emailService.saveEmailConfig(f);
      // Also push the OTP toggle into settings/features so the client
      // form picks it up (it reads features.email_verification).
      try {
        await adminService.updateSettings('features',
          { email_verification: !!otpRequired });
      } catch (_) { /* best-effort */ }
      flash('Email settings saved');
    } catch (_) { flash('Could not save'); } finally { setBusy(false); }
  }
  async function logout() {
    try { await authService.logoutUser(); } catch (_) {}
    router.replace('/admin-login');
  }

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-center justify-between
        gap-2">
        <h1 className="text-xl font-bold">Email &amp; Notifications</h1>
        <button onClick={logout}
          className="rounded-full border border-danger px-4 py-2 text-sm
            font-semibold text-danger">
          Log out
        </button>
      </div>
      <p className="mb-3 text-sm text-sub-text">
        Configure outgoing (SMTP) and incoming (IMAP/POP) mail. Every
        ticket and activity update is queued here with its subject so
        you can see exactly what is sent to customers and astrologers.
      </p>

      <div className="surface mb-4 space-y-3 p-4">
        <div className="font-semibold">Outgoing mail (SMTP)</div>

        {/* Quick-fill buttons for common providers */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-sub-text self-center">
            Quick fill:
          </span>
          {[
            {
              label: 'Zoho (India) SSL',
              vals: { smtpHost: 'smtp.zoho.in', smtpPort: 465,
                smtpSecure: true },
            },
            {
              label: 'Zoho (India) TLS',
              vals: { smtpHost: 'smtp.zoho.in', smtpPort: 587,
                smtpSecure: false },
            },
            {
              label: 'Zoho Global SSL',
              vals: { smtpHost: 'smtp.zoho.com', smtpPort: 465,
                smtpSecure: true },
            },
            {
              label: 'Gmail',
              vals: { smtpHost: 'smtp.gmail.com', smtpPort: 587,
                smtpSecure: false },
            },
          ].map((p) => (
            <button key={p.label}
              onClick={() => setF((prev) => ({ ...prev, ...p.vals }))}
              className="rounded-full border border-gray-300 px-3 py-1
                text-xs hover:bg-gray-50">
              {p.label}
            </button>
          ))}
        </div>

        {/* Zoho 554 5.7.8 fix guide - shown whenever host contains zoho */}
        {f.smtpHost && f.smtpHost.toLowerCase().includes('zoho') && (
          <div className="rounded-xl border border-amber-200
            bg-amber-50 p-3 text-xs space-y-1.5">
            <div className="font-bold text-amber-900">
              Zoho SMTP: fix "554 5.7.8 Access Restricted"
            </div>
            <p className="text-amber-800">
              Zoho no longer allows your account password for SMTP.
              Follow these steps:
            </p>
            <ol className="list-decimal list-inside space-y-1
              text-amber-800">
              <li>
                Log in to{' '}
                <a href="https://mail.zoho.in" target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-semibold">
                  mail.zoho.in
                </a>
                {' '}(or mail.zoho.com) as the sending account
                (e.g. support@yourdomain.com).
              </li>
              <li>
                Go to <b>Settings</b> (top-right gear icon).
              </li>
              <li>
                Under <b>Mail Accounts</b>, select your account,
                then click <b>Configure</b> and enable
                <b> IMAP / SMTP Access</b>.
              </li>
              <li>
                Now go to{' '}
                <a href="https://accounts.zoho.in/home#security"
                  target="_blank" rel="noopener noreferrer"
                  className="underline font-semibold">
                  accounts.zoho.in/home#security
                </a>
                {' '}and under <b>App Passwords</b>, generate a new
                password (name it "AstroSeer Relay").
              </li>
              <li>
                Paste that app password into the
                <b> Password</b> field below (NOT your Zoho login
                password).
              </li>
              <li>
                Use <b>Port 465 + SSL on</b>{' '}
                (recommended), or Port 587 + SSL off.
                Both work with the relay.
              </li>
            </ol>
            <p className="text-amber-700 font-semibold">
              Username must be your full email address
              (e.g. support@yourdomain.com).
            </p>
          </div>
        )}

        <div className="grid gap-2 md:grid-cols-2">
          <input className="input" placeholder="SMTP host"
            value={f.smtpHost} onChange={set('smtpHost')} />
          <input className="input" type="number" placeholder="Port"
            value={f.smtpPort} onChange={set('smtpPort')} />
          <input className="input" placeholder="Username (full email)"
            value={f.smtpUser} onChange={set('smtpUser')} />
          <input className="input" type="password"
            placeholder="App password (NOT account password)"
            value={f.smtpPass} onChange={set('smtpPass')} />
          <input className="input" placeholder="From address"
            value={f.smtpFrom} onChange={set('smtpFrom')} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f.smtpSecure}
              onChange={set('smtpSecure')} /> Use SSL/TLS (port 465)
          </label>
        </div>
        <div className="font-semibold">Incoming mail (IMAP / POP)</div>
        <div className="grid gap-2 md:grid-cols-2">
          <select className="input" value={f.protocol}
            onChange={set('protocol')}>
            <option value="imap">IMAP</option>
            <option value="pop">POP3</option>
          </select>
          <input className="input" placeholder="Host"
            value={f.imapHost} onChange={set('imapHost')} />
          <input className="input" type="number" placeholder="Port"
            value={f.imapPort} onChange={set('imapPort')} />
          <input className="input" placeholder="Username"
            value={f.imapUser} onChange={set('imapUser')} />
          <input className="input" type="password" placeholder="Password"
            value={f.imapPass} onChange={set('imapPass')} />
        </div>
        <input className="input" placeholder="Admin alert email (status)"
          value={f.adminAlertTo} onChange={set('adminAlertTo')} />

        {/* Silent admin BCC. Applied by the relay to every outbound
            email (welcome, paid kundli, complimentary kundli, tester
            invite, OTP, generic). Goes in the BCC header so the
            recipient never sees it. Toggle and address are stored
            separately so admin can pause without losing the saved
            address. */}
        <div className="rounded-card border border-gray-200 bg-bg-light
          p-3">
          <div className="font-semibold">Silent admin BCC</div>
          <p className="mt-1 text-[11px] text-sub-text">
            When enabled, every outbound email the relay sends is
            silently BCC'd to the address below. The recipient never
            sees this in their copy. Useful for audit + monitoring.
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f.bccEnabled}
              onChange={set('bccEnabled')} />
            Enable silent BCC on all outbound mail
          </label>
          <input className="input mt-2" type="email"
            placeholder="bcc-archive@yourdomain.com"
            value={f.bccTo || ''} onChange={set('bccTo')} />
        </div>

        {/* OTP-on-signup enforcement. Mirrors the toggle that already
            lives on /admin-features so the operator can flip OTP gating
            from this page too. When ON, /signup creates the user in
            Firebase, immediately signs them out, sends a 6-digit code
            to their inbox, and only completes login after verify. When
            OFF, signup grants login instantly. */}
        <div className="rounded-card border border-gray-200 bg-bg-light
          p-3">
          <div className="font-semibold">Email OTP on signup</div>
          <p className="mt-1 text-[11px] text-sub-text">
            When enabled, every new signup must enter a 6-digit code
            emailed to their address before they are signed in.
            Disable to let signups complete instantly. (Synced with
            /admin-features &gt; "Require email verification on signup".)
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!otpRequired}
              onChange={(e) => setOtpRequired(e.target.checked)} />
            Require email OTP verification on every new signup
          </label>
        </div>

        {/* Welcome email controls. Separate toggle + subject so the
            admin can pause the welcome flow independently of the BCC
            archive. The body uses the same maroon/amber template the
            relay already renders for invites. */}
        <div className="rounded-card border border-gray-200 bg-bg-light
          p-3">
          <div className="font-semibold">Welcome email (new signups)</div>
          <p className="mt-1 text-[11px] text-sub-text">
            Fired automatically when a new user finishes signup. Turn
            this off to suppress the welcome touch without affecting
            transactional mail.
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f.welcomeEnabled}
              onChange={set('welcomeEnabled')} />
            Send welcome email on successful signup
          </label>
          <input className="input mt-2"
            placeholder="Welcome subject line"
            value={f.welcomeSubject || ''}
            onChange={set('welcomeSubject')} />
        </div>

        {/* Beta invite template. Admin can change subject + HTML body
            here and Save - the relay reads betaInviteSubject +
            betaInviteHtml from settings/email when sending an invite,
            so changes take effect on the very next send (no redeploy).
            Use {{name}} in the HTML to personalise the salutation. */}
        <div className="rounded-card border border-gray-200 bg-bg-light
          p-3">
          <div className="font-semibold">Beta invite template</div>
          <p className="mt-1 text-[11px] text-sub-text">
            Used by the "Send beta invite" panel below. The HTML body
            supports the <b>{'{{name}}'}</b> placeholder which gets
            substituted with the recipient's name at send time. The
            Play Store URL is already embedded; change it in the HTML
            if needed.
          </p>
          <input className="input mt-2"
            placeholder="Subject line"
            value={f.betaInviteSubject || ''}
            onChange={set('betaInviteSubject')} />
          <textarea className="input mt-2 min-h-[180px] font-mono
            text-[11px]"
            placeholder="HTML body"
            value={f.betaInviteHtml || ''}
            onChange={set('betaInviteHtml')} />
          <p className="mt-1 text-[10px] text-sub-text">
            Tip: leave this empty to fall back to the relay's default.
          </p>
        </div>

        <button onClick={save} disabled={busy}
          className="btn-primary w-full">
          {busy ? 'Saving...' : 'Save email settings'}
        </button>
        <p className="text-xs text-sub-text">
          Note: browsers cannot send SMTP directly. The push-relay
          service uses these credentials to actually deliver and fetch
          mail; until it is configured, messages stay queued below so
          nothing is lost.
        </p>
      </div>

      {/* Beta invite sender. Admin enters a single email (or pastes a
          list), the relay renders the template above, sends from
          support@astroseer.in, and the configured silent BCC archives
          a copy for admin. No Play Console step - this path is for
          inviting people directly without adding them as testers. */}
      <BetaInvitePanel />

      {/* Send a real test of any template through the relay's SMTP
          so we can verify the polished kundli email + signature
          actually deliver. Defaults to vickymartinsingh@gmail.com
          so the most common test is one click. */}
      <TestSendPanel />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide
        text-sub-text">Email log ({emails.length})</h2>
      <div className="space-y-2">
        {emails.length === 0 ? (
          <div className="surface p-4 text-sm text-sub-text">
            No emails yet.
          </div>
        ) : emails.map((m) => (
          <div key={m.id} className="surface p-3 text-sm">
            <button
              onClick={() => setOpen(open === m.id ? null : m.id)}
              className="flex w-full items-start justify-between gap-2
                text-left">
              <div className="min-w-0">
                <div className="truncate font-semibold">{m.subject}</div>
                <div className="truncate text-xs text-sub-text">
                  To {m.to} - {m.kind}
                  {m.ticketNo ? ` - ${m.ticketNo}` : ''}
                </div>
                <div className="text-[11px] text-sub-text">
                  {fmt(m.ts)}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5
                text-[11px] font-semibold ${m.status === 'sent'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'}`}>
                {m.status || 'queued'}
              </span>
            </button>
            {open === m.id && (
              <EmailLogDetail m={m} />
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}

// Full email detail: subject, to, kind, attachment name, raw text
// body, rendered HTML preview, and the SMTP error / response from
// the relay when applicable. Mirrors what a customer actually
// received via SMTP so admin can audit before forwarding.
function EmailLogDetail({ m }) {
  const [view, setView] = useState(m.html ? 'html' : 'text');
  const attachments = Array.isArray(m.attachments) ? m.attachments
    : (m.attachment ? [m.attachment] : []);
  return (
    <div className="mt-2 rounded-card border border-gray-200 bg-white">
      <div className="grid gap-1 border-b border-gray-100 p-3
        text-[11px] sm:grid-cols-2">
        <div><b>To:</b> {m.to || '·'}</div>
        <div><b>Kind:</b> {m.kind || 'generic'}</div>
        <div className="sm:col-span-2"><b>Subject:</b>{' '}
          {m.subject || '·'}</div>
        <div><b>Status:</b> {m.status || 'queued'}</div>
        <div><b>Sent:</b> {m.ts
          ? new Date(m.ts).toLocaleString() : '·'}</div>
        {m.messageId && (
          <div className="sm:col-span-2 break-all">
            <b>Message-ID:</b> {m.messageId}</div>
        )}
        {m.response && (
          <div className="sm:col-span-2 break-all">
            <b>SMTP response:</b> {m.response}</div>
        )}
        {m.error && (
          <div className="sm:col-span-2 break-all
            rounded-card bg-danger/10 p-2 text-danger">
            <b>Error:</b> {m.error}</div>
        )}
        {attachments.length > 0 && (
          <div className="sm:col-span-2">
            <b>Attachment(s):</b>{' '}
            {attachments.map((a, i) => (
              <span key={i} className="ml-1 rounded-full
                bg-bg-light px-2 py-0.5 text-[10px]">
                {a.filename || `file ${i + 1}`}
                {a.contentType ? ` · ${a.contentType}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
      {(m.body || m.html) && (
        <div className="border-b border-gray-100 px-3 py-2">
          <div className="flex gap-1">
            {['html', 'text'].map((v) => (
              <button key={v} type="button"
                disabled={(v === 'html' && !m.html)
                  || (v === 'text' && !m.body)}
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 text-[10px]
                  font-bold uppercase disabled:opacity-40
                  ${view === v ? 'bg-primary text-white'
                    : 'bg-bg-light text-sub-text'}`}>
                {v === 'html' ? 'HTML preview' : 'Plain text'}
              </button>
            ))}
          </div>
        </div>
      )}
      {view === 'html' && m.html && (
        <iframe
          title="email-html"
          // eslint-disable-next-line react/no-danger
          srcDoc={m.html}
          className="h-[420px] w-full" />
      )}
      {view === 'text' && m.body && (
        <pre className="whitespace-pre-wrap p-3 text-xs">{m.body}</pre>
      )}
      {!m.body && !m.html && (
        <div className="p-3 text-xs text-sub-text">
          (No body captured - the relay sent the email but did not
          persist the rendered content. Future sends will store
          subject + body + html + error here.)
        </div>
      )}
    </div>
  );
}

function TestSendPanel() {
  const [to, setTo] = useState('vickymartinsingh@gmail.com');
  const [kind, setKind] = useState('kundli_report_ready');
  const [name, setName] = useState('Vicky Martin Singh');
  const [profileName, setProfileName] = useState('Vicky Martin Singh');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', kind: '' });
  async function send() {
    setMsg({ text: '', kind: '' });
    if (!/.+@.+\..+/.test(to)) {
      setMsg({ text: 'Enter a valid email.', kind: 'err' }); return;
    }
    setBusy(true);
    try {
      const res = await emailService.sendEmail({
        to,
        kind,
        vars: {
          name,
          profileName,
          kindLabel: 'Free Vedic Kundli Report',
          ordersUrl: 'https://astroseer.in/orders',
        },
      });
      setMsg({
        text: `Sent. messageId=${res.messageId || '(none)'}.`
          + ' Check the inbox + Email Log below.',
        kind: 'ok',
      });
    } catch (e) {
      setMsg({ text: e.message || 'Send failed.', kind: 'err' });
    } finally { setBusy(false); }
  }
  return (
    <div className="surface mb-4 space-y-3 p-4">
      <div className="font-semibold">Send a test email</div>
      <p className="text-xs text-sub-text">
        Pushes a real SMTP send through the relay using the
        professional kundli template + signature. Useful to verify
        the layout end-to-end before announcing a campaign or
        approving an order resend.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="block text-sm">
          To
          <input className="input mt-1" type="email" value={to}
            onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="block text-sm">
          Template
          <select className="input mt-1" value={kind}
            onChange={(e) => setKind(e.target.value)}>
            <option value="kundli_report_ready">
              Kundli report ready
            </option>
            <option value="kundli_report_resend">
              Kundli report resend
            </option>
            <option value="astro_application_received">
              Astrologer application received
            </option>
            <option value="astro_application_approved">
              Astrologer approved
            </option>
            <option value="generic">Generic</option>
          </select>
        </label>
        <label className="block text-sm">
          Recipient name
          <input className="input mt-1" value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          Profile / chart name
          <input className="input mt-1" value={profileName}
            onChange={(e) => setProfileName(e.target.value)} />
        </label>
      </div>
      <button onClick={send} disabled={busy}
        className="btn-primary w-full">
        {busy ? 'Sending…' : `Send test to ${to}`}
      </button>
      {msg.text && (
        <div className={`rounded-card p-2 text-xs ${msg.kind === 'ok'
          ? 'bg-success/10 text-success'
          : 'bg-danger/10 text-danger'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// Beta invite sender. Reads the editable template from settings/email
// (betaInviteSubject + betaInviteHtml) via the relay's `send` action -
// we pass kind:'betaInvite' so the relay can apply the template at
// send time and substitute {{name}}. Falls back to a sensible default
// if the admin has not customised one.
function BetaInvitePanel() {
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', kind: '' });

  async function send() {
    setMsg({ text: '', kind: '' });
    const target = String(to || '').trim();
    if (!/.+@.+\..+/.test(target)) {
      setMsg({ text: 'Enter a valid email.', kind: 'err' }); return;
    }
    setBusy(true);
    try {
      const res = await emailService.sendEmail({
        to: target,
        kind: 'betaInvite',
        vars: { name: name.trim() || 'there' },
      });
      setMsg({
        text: `Invite sent. messageId=${res.messageId || '(none)'}. `
          + 'A BCC copy was archived to your admin address.',
        kind: 'ok',
      });
      setTo(''); setName('');
    } catch (e) {
      setMsg({ text: (e && e.message) || 'Send failed.', kind: 'err' });
    } finally { setBusy(false); }
  }

  return (
    <div className="surface mb-4 space-y-3 p-4">
      <div className="font-semibold">Send beta invite</div>
      <p className="text-xs text-sub-text">
        Sends the beta-invite email above to a single recipient
        directly from support@astroseer.in. No Play Console step. The
        recipient gets the official template (with the Play Store +
        web links) and the configured silent BCC gives you a copy.
        Recipient never sees the BCC.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="block text-sm">
          Recipient email
          <input className="input mt-1" type="email"
            placeholder="friend@example.com" value={to}
            onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="block text-sm">
          Recipient name (optional)
          <input className="input mt-1"
            placeholder="Friend's first name" value={name}
            onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <button onClick={send} disabled={busy}
        className="btn-primary w-full">
        {busy ? 'Sending…' : 'Send beta invite'}
      </button>
      {msg.text && (
        <div className={`rounded-card p-2 text-xs ${msg.kind === 'ok'
          ? 'bg-success/10 text-success'
          : 'bg-danger/10 text-danger'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
