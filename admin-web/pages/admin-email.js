import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { emailService, authService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const BLANK = {
  smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
  smtpFrom: '', smtpSecure: false,
  imapHost: '', imapPort: 993, imapUser: '', imapPass: '',
  protocol: 'imap', adminAlertTo: '',
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

  useEffect(() => {
    emailService.getEmailConfig().then((c) =>
      setF((p) => ({ ...p, ...c }))).catch(() => {});
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
        <div className="grid gap-2 md:grid-cols-2">
          <input className="input" placeholder="SMTP host"
            value={f.smtpHost} onChange={set('smtpHost')} />
          <input className="input" type="number" placeholder="Port"
            value={f.smtpPort} onChange={set('smtpPort')} />
          <input className="input" placeholder="Username"
            value={f.smtpUser} onChange={set('smtpUser')} />
          <input className="input" type="password" placeholder="Password"
            value={f.smtpPass} onChange={set('smtpPass')} />
          <input className="input" placeholder="From address"
            value={f.smtpFrom} onChange={set('smtpFrom')} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!f.smtpSecure}
              onChange={set('smtpSecure')} /> Use SSL/TLS
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
