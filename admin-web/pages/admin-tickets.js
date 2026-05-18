import { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { ticketService, adminService, db } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

function fmt(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
function chip(x) {
  const fin = ticketService.isFinalClosed(x);
  if (fin) return ['Closed', 'bg-gray-100 text-gray-500'];
  if (x.status === 'closed') return ['Closing', 'bg-gray-100 text-gray-500'];
  if (x.status === 'assigned') return ['In progress',
    'bg-blue-100 text-blue-700'];
  if (x.status === 'reopened') return ['Reopened',
    'bg-amber-100 text-amber-700'];
  return ['Open', 'bg-emerald-100 text-emerald-700'];
}

export default function AdminTickets() {
  const { loading } = useRequireAdmin();
  const [list, setList] = useState([]);
  const [tab, setTab] = useState('client'); // client | astrologer
  const [term, setTerm] = useState('');
  const [sel, setSel] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [reply, setReply] = useState('');
  const [prefs, setPrefs] = useState({ tickets: true, status: false });
  const endRef = useRef(null);

  useEffect(() => ticketService.listenAllTickets(setList), []);
  useEffect(() => {
    if (!sel) return undefined;
    return ticketService.listenTicket(sel.id, setMsgs);
  }, [sel]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);
  useEffect(() => {
    getDoc(doc(db, 'settings', 'features')).then((s) => {
      const d = s.exists() ? s.data() : {};
      setPrefs({
        tickets: d.admin_notify_tickets !== false,
        status: d.admin_notify_status === true,
      });
    }).catch(() => {});
  }, []);

  if (loading) {
    return <Layout><div className="surface p-4">Loading...</div></Layout>;
  }

  async function savePref(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      await adminService.updateSettings('features', {
        admin_notify_tickets: next.tickets,
        admin_notify_status: next.status,
      });
      flash('Notification settings saved');
    } catch (_) { flash('Could not save'); }
  }

  const t = term.trim().toLowerCase();
  const partition = list.filter((x) => (x.role === 'astrologer'
    ? tab === 'astrologer' : tab === 'client'));
  const shown = !t ? partition : partition.filter((x) =>
    [x.ticketNo, x.userId, x.name, x.subject, x.email, x.phone,
      x.userCode, x.category]
      .some((v) => String(v || '').toLowerCase().includes(t)));
  const openCount = (role) => list.filter((x) =>
    (x.role === 'astrologer' ? role === 'astrologer' : role === 'client')
    && ticketService.isActive(x)).length;

  async function send() {
    const v = reply.trim();
    if (!v || !sel) return;
    setReply('');
    await ticketService.sendTicketMessage(sel, 'support', v, true);
    flash('Reply sent');
  }
  async function close() {
    if (!sel) return;
    await ticketService.closeTicket(sel);
    flash('Ticket closed');
  }

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-center justify-between
        gap-2">
        <h1 className="text-xl font-bold">Support Desk</h1>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={prefs.tickets}
              onChange={(e) => savePref({ tickets: e.target.checked })} />
            Ticket alerts
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={prefs.status}
              onChange={(e) => savePref({ status: e.target.checked })} />
            Online/offline alerts
          </label>
        </div>
      </div>

      <div className="mb-3 flex gap-2">
        {[['client', 'Customer support'],
          ['astrologer', 'Astrologer support']].map(([k, lbl]) => (
          <button key={k} onClick={() => { setTab(k); setSel(null); }}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              tab === k ? 'bg-primary text-white' : 'bg-white'}`}>
            {lbl}
            <span className={`ml-2 rounded-full px-2 text-xs ${
              tab === k ? 'bg-white/25' : 'bg-bg-light'}`}>
              {openCount(k)}
            </span>
          </button>
        ))}
      </div>

      <input className="input mb-3"
        placeholder="Search ticket no / name / email / phone / code..."
        value={term} onChange={(e) => setTerm(e.target.value)} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-1">
          {shown.length === 0 ? (
            <div className="surface p-4 text-sm text-sub-text">
              No {tab === 'astrologer' ? 'astrologer' : 'customer'}{' '}
              tickets.
            </div>
          ) : shown.map((x) => {
            const [lbl, cls] = chip(x);
            return (
              <button key={x.id} onClick={() => setSel(x)}
                className={`surface w-full p-3 text-left ${
                  sel && sel.id === x.id ? 'ring-2 ring-primary' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{x.ticketNo}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px]
                    font-semibold ${cls}`}>{lbl}</span>
                </div>
                <div className="truncate text-sm">{x.subject}</div>
                <div className="truncate text-xs text-sub-text">
                  {x.name}{x.email ? ` - ${x.email}` : ''}
                </div>
                <div className="text-[11px] text-sub-text">
                  {x.team} - {fmt(x.updatedAt)}
                </div>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-2">
          {!sel ? (
            <div className="surface p-4 text-sm text-sub-text">
              Select a ticket to view the conversation.
            </div>
          ) : (
            <div className="surface p-0">
              <div className="border-b border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold">{sel.subject}</div>
                    <div className="text-xs text-sub-text">
                      {sel.ticketNo} - {sel.team} - {sel.category}
                    </div>
                    <div className="truncate text-xs text-sub-text">
                      {sel.name}
                      {sel.email ? ` - ${sel.email}` : ''}
                      {' '}- {sel.role || 'client'}
                    </div>
                    <div className="mt-1 text-[11px] text-sub-text">
                      Opened {fmt(sel.createdAt)}
                      {sel.closedAt ? ` - Closed ${fmt(sel.closedAt)}`
                        : ''}
                    </div>
                  </div>
                  {ticketService.isActive(sel) && (
                    <button onClick={close}
                      className="shrink-0 rounded-full border
                        border-danger px-3 py-1.5 text-sm text-danger">
                      Close ticket
                    </button>
                  )}
                </div>
              </div>
              <div className="h-[48vh] space-y-3 overflow-y-auto p-4">
                {msgs.map((m) => {
                  const admin = m.role === 'admin';
                  return (
                    <div key={m.id}
                      className={`flex ${admin ? 'justify-end'
                        : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2
                        text-sm ${admin ? 'bg-primary text-white'
                          : 'bg-bg-light text-dark-text'}`}>
                        <div className="mb-0.5 text-[11px] font-semibold
                          opacity-80">
                          {admin ? 'Support' : (sel.name || 'User')}
                        </div>
                        <div>{m.text}</div>
                        <div className={`mt-1 text-[10px] ${admin
                          ? 'text-white/70' : 'text-sub-text'}`}>
                          {fmt(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
              {ticketService.isFinalClosed(sel) ? (
                <div className="border-t border-gray-200 p-3 text-center
                  text-sm text-sub-text">
                  This ticket is closed.
                </div>
              ) : (
                <div className="flex items-center gap-2 border-t
                  border-gray-200 p-3">
                  <input className="input flex-1 !rounded-full"
                    placeholder="Reply..."
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && send()} />
                  <button onClick={send}
                    className="btn-primary !min-h-0 px-5 py-2">
                    Send
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
