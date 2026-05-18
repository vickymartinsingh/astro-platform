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
              <pre className="mt-2 whitespace-pre-wrap rounded-card
                bg-bg-light p-3 text-xs">{m.body}</pre>
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
