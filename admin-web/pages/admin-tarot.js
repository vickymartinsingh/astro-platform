import { useEffect, useState } from 'react';
import { tarotService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

// Admin-only record of the questions customers asked in the guided
// tarot flow (the customer never sees these again).
function fmt(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
  return ms ? new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit' }) : '';
}

export default function AdminTarot() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    tarotService.listTarotQuestions().then(setRows).catch(() =>
      setRows([]));
  }, []);

  if (loading || rows === null) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }
  const t = q.trim().toLowerCase();
  const shown = !t ? rows : rows.filter((r) =>
    [r.name, r.aspect, r.question, r.userId]
      .some((v) => String(v || '').toLowerCase().includes(t)));

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Tarot Questions</h1>
      <p className="mb-3 text-sm text-sub-text">
        Questions asked in the guided &quot;Pick your card&quot; flow.
        Admin-only - customers cannot see these.
      </p>
      <input className="input mb-3"
        placeholder="Search name / aspect / question..."
        value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="space-y-2">
        {shown.length === 0 ? (
          <div className="card text-sub-text">No questions yet.</div>
        ) : shown.map((r) => (
          <div key={r.id} className="card">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {r.name || 'User'}
                <span className="text-sub-text">
                  {' '}- {r.aspect || 'General'}
                </span>
              </span>
              <span className="rounded-full bg-bg-light px-2 py-0.5
                text-xs text-sub-text">{r.spread || 'single'}</span>
            </div>
            <p className="mt-1 text-sm">{r.question}</p>
            <div className="mt-1 text-xs text-sub-text">
              {fmt(r.createdAt)} - UID {r.userId || 'guest'}
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
