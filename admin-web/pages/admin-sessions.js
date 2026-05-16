import { useEffect, useState, useRef } from 'react';
import { db, adminService, chatService } from '@astro/shared';
import {
  collection, query, orderBy, limit, getDocs, doc, getDoc,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

const fmt = (secs) => {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${ss}`
    : `${String(m).padStart(2, '0')}:${ss}`;
};

export default function AdminSessions() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [names, setNames] = useState({});           // uid -> name
  const [now, setNow] = useState(Date.now());
  const [mon, setMon] = useState(null);             // session being watched
  const [msgs, setMsgs] = useState([]);
  const unsubRef = useRef(null);

  async function resolveNames(ids) {
    const map = {};
    await Promise.all([...new Set(ids)].filter(Boolean).map(async (id) => {
      try {
        const a = await getDoc(doc(db, 'astrologers', id));
        if (a.exists() && a.data().name) { map[id] = a.data().name; return; }
      } catch (_) {}
      try {
        const u = await getDoc(doc(db, 'users', id));
        map[id] = (u.exists() && u.data().name) || '—';
      } catch (_) { map[id] = '—'; }
    }));
    return map;
  }

  async function load() {
    const snap = await getDocs(query(collection(db, 'sessions'),
      orderBy('createdAt', 'desc'), limit(100)));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setRows(list);
    const ids = [];
    list.forEach((s) => { ids.push(s.userId, s.astroId); });
    setNames(await resolveNames(ids));
  }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  // Tick every second so live durations update.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  function startMs(s) {
    if (s.startTime?.toMillis) return s.startTime.toMillis();
    if (s.createdAt?.toMillis) return s.createdAt.toMillis();
    return now;
  }
  const nm = (id) => `${names[id] || '…'} (${String(id || '').slice(0, 8)})`;

  async function forceEnd(id) {
    if (!window.confirm('Force-end this session?')) return;
    await adminService.forceEndSession(id);
    load();
  }

  function openMonitor(s) {
    setMon(s); setMsgs([]);
    if (unsubRef.current) unsubRef.current();
    const chatId = chatService.conversationId(s.userId, s.astroId);
    // VIEW-ONLY: just a live read of the thread. No writes, no presence,
    // nothing is sent — neither the client nor the astrologer is notified.
    unsubRef.current = chatService.listenMessages(chatId, setMsgs);
  }
  function closeMonitor() {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    setMon(null); setMsgs([]);
  }
  useEffect(() => () => { if (unsubRef.current) unsubRef.current(); }, []);

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  const live = rows.filter((s) => s.status === 'active'
    || s.status === 'accepted');

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Session Monitoring</h1>

      <h2 className="mb-2 font-semibold">Live ({live.length})</h2>
      <div className="mb-5 space-y-2">
        {live.length === 0 && (
          <div className="card text-sub-text">No live sessions.</div>
        )}
        {live.map((s) => (
          <div key={s.id}
            className="card flex flex-wrap items-center justify-between
                       gap-2">
            <div>
              <div className="font-semibold capitalize">
                {s.type} · {fmt((now - startMs(s)) / 1000)}
                {' '}<span className="text-xs font-normal text-success">
                  ● live</span>
              </div>
              <div className="text-sm text-sub-text">
                Astrologer: <b>{nm(s.astroId)}</b> ↔ Client:{' '}
                <b>{nm(s.userId)}</b> · ₹{s.cost || 0} so far
              </div>
            </div>
            <div className="flex gap-3 text-sm">
              <button onClick={() => openMonitor(s)}
                className="font-semibold text-primary">
                Live monitor
              </button>
              <button onClick={() => forceEnd(s.id)}
                className="text-danger">Force End</button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-2 font-semibold">Recent</h2>
      <div className="surface overflow-x-auto p-2">
        <table className="w-full text-sm">
          <thead className="text-left text-sub-text">
            <tr>
              <th className="p-2">Astrologer</th>
              <th className="p-2">Client</th>
              <th className="p-2">Type</th><th className="p-2">Dur</th>
              <th className="p-2">Status</th><th className="p-2">Cost</th>
              <th className="p-2">Date</th><th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{nm(s.astroId)}</td>
                <td className="p-2">{nm(s.userId)}</td>
                <td className="p-2 capitalize">{s.type}</td>
                <td className="p-2">
                  {Math.round((s.duration || 0) / 60)}m
                </td>
                <td className="p-2 capitalize">{s.status}</td>
                <td className="p-2">₹{s.cost || 0}</td>
                <td className="p-2">
                  {s.createdAt?.toDate
                    ? s.createdAt.toDate().toLocaleString() : ''}
                </td>
                <td className="p-2">
                  <button onClick={() => openMonitor(s)}
                    className="text-primary">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        px-3 py-6" style={{ background: 'rgba(20,14,46,.55)' }}>
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col
                          overflow-hidden rounded-2xl bg-white">
            <div className="bg-primary p-4 text-white">
              <div className="flex items-center justify-between">
                <span className="font-bold">Live monitor (view-only)</span>
                <button onClick={closeMonitor}
                  className="rounded-full bg-white/25 px-3 py-1 text-sm">
                  Close
                </button>
              </div>
              <div className="mt-1 text-xs opacity-90">
                Astrologer <b>{nm(mon.astroId)}</b> ↔ Client{' '}
                <b>{nm(mon.userId)}</b> · {mon.type} ·{' '}
                {(mon.status === 'active' || mon.status === 'accepted')
                  ? `${fmt((now - startMs(mon)) / 1000)} ● live`
                  : mon.status}{' '}· ₹{mon.cost || 0}
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto bg-bg-gray p-4">
              {msgs.length === 0 ? (
                <div className="text-center text-sm text-sub-text">
                  No messages in this conversation.
                </div>
              ) : msgs.map((m) => {
                const who = m.senderId === mon.astroId ? 'Astrologer'
                  : m.senderId === mon.userId ? 'Client'
                  : 'System';
                return (
                  <div key={m.id} className="text-sm">
                    <span className="text-xs font-semibold text-sub-text">
                      {who}:
                    </span>{' '}
                    <span className="whitespace-pre-line">{m.text}</span>
                  </div>
                );
              })}
            </div>
            <div className="border-t bg-white p-3 text-center text-xs
                            text-sub-text">
              View-only — nothing is sent. The client and astrologer are
              NOT notified that you are watching.
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
