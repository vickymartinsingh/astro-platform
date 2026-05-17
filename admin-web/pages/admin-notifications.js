import { useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import UserPicker from '../components/UserPicker';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

export default function AdminNotifications() {
  const { loading } = useRequireAdmin();
  const [target, setTarget] = useState('all');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState([]); // selected user objects
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true); setMsg('');
    try {
      if (target === 'user') {
        if (!picked.length) {
          setMsg('Pick at least one user.'); setBusy(false); return;
        }
        let sent = 0;
        for (const u of picked) {
          // eslint-disable-next-line no-await-in-loop
          const r = await adminService.sendNotification({
            target: 'user', title, message, userId: u.uid });
          sent += (r && r.sent) || 1;
        }
        setMsg(`Sent to ${picked.length} selected user(s).`);
        flash(`Notification sent to ${picked.length} user(s)`);
        setTitle(''); setMessage(''); setPicked([]);
      } else {
        const res = await adminService.sendNotification({
          target, title, message, userId: null });
        setMsg(`Sent to ${res.sent} user(s).`);
        flash(`Notification sent to ${res.sent} user(s)`);
        setTitle(''); setMessage('');
      }
    } catch (e) {
      setMsg('Failed: ' + (e?.message || 'error'));
    } finally { setBusy(false); }
  }

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Notification System</h1>
      <div className="card space-y-3">
        <select className="input" value={target}
          onChange={(e) => setTarget(e.target.value)}>
          <option value="all">All users</option>
          <option value="clients">Clients only</option>
          <option value="astrologers">Astrologers only</option>
          <option value="user">Specific user</option>
        </select>
        {target === 'user' && (
          <UserPicker value={picked} onChange={setPicked} />
        )}
        <input className="input" placeholder="Title" value={title}
          onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={3} placeholder="Message"
          value={message} onChange={(e) => setMessage(e.target.value)} />
        {msg && <div className="text-success">{msg}</div>}
        <button onClick={send} disabled={busy || !title}
          className="btn-primary w-full">
          {busy ? 'Sending…' : 'Send Notification'}
        </button>
      </div>
    </Layout>
  );
}
