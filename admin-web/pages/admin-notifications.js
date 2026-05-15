import { useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminNotifications() {
  const { loading } = useRequireAdmin();
  const [target, setTarget] = useState('all');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [userId, setUserId] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true); setMsg('');
    try {
      const res = await adminService.sendNotification({
        target, title, message, userId: target === 'user' ? userId : null });
      setMsg(`Sent to ${res.sent} user(s).`);
      setTitle(''); setMessage('');
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
          <input className="input" placeholder="User ID" value={userId}
            onChange={(e) => setUserId(e.target.value)} />
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
