import { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  ticketService, adminService, db,
  sessionService, userService, astrologerService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

const { REFUND_REASONS, sessionRefNo } = sessionService;
const TYPE_ICON = { chat: '💬', call: '📞', video: '📹' };
function fmtDur(sec) {
  const s = Number(sec || 0);
  if (s <= 0) return '0m';
  const m = Math.floor(s / 60); const r = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m${r ? ` ${r}s` : ''}` : `${r}s`;
}

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
  const { user, loading } = useRequireAdmin();
  const [list, setList] = useState([]);
  const [tab, setTab] = useState('client'); // client | astrologer
  const [term, setTerm] = useState('');
  const [sel, setSel] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [reply, setReply] = useState('');
  const [prefs, setPrefs] = useState({ tickets: true, status: false });
  // Linked session details for the selected ticket (orderRef).
  const [order, setOrder] = useState(null);
  const [orderMeta, setOrderMeta] = useState({ astro: '', client: '' });
  const [rfOpen, setRfOpen] = useState(false);
  const [rfReason, setRfReason] = useState('');
  const [rfBusy, setRfBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => ticketService.listenAllTickets(setList), []);
  useEffect(() => {
    if (!sel) return undefined;
    return ticketService.listenTicket(sel.id, setMsgs);
  }, [sel]);

  // Load the linked session (order) and its astro/client names so the
  // admin sees the full consultation context inside the ticket view.
  useEffect(() => {
    setOrder(null); setOrderMeta({ astro: '', client: '' });
    if (!sel || !sel.orderRef) return;
    (async () => {
      try {
        const s = await sessionService.getSession(sel.orderRef);
        if (!s) return;
        const sessObj = { id: sel.orderRef, ...s };
        setOrder(sessObj);
        const [u, a] = await Promise.all([
          s.userId ? userService.getUser(s.userId) : null,
          s.astroId ? astrologerService.getAstrologer(s.astroId) : null,
        ]);
        setOrderMeta({
          astro: (a && (a.name || a.displayName)) || 'Astrologer',
          client: (u && (u.name || u.email)) || 'Customer',
        });
      } catch (_) { /* ignore */ }
    })();
  }, [sel && sel.id, sel && sel.orderRef]);

  async function processRefundForOrder() {
    if (!order) return;
    setRfBusy(true);
    try {
      await sessionService.requestRefund(
        order.id, user.uid, 'admin', rfReason || 'Customer request');
      const r = await sessionService.processRefund(order.id, user.uid);
      flash(r.refunded > 0 ? `Refunded ₹${r.refunded}`
        : 'Marked - nothing to refund');
      const fresh = await sessionService.getSession(order.id);
      if (fresh) setOrder({ ...order, ...fresh });
      setRfOpen(false); setRfReason('');
    } catch (e) { flash('Failed: ' + (e.message || 'error')); }
    setRfBusy(false);
  }
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
                {x.orderRef && (
                  <div className="mt-1 inline-block rounded-full
                    bg-bg-light px-2 py-0.5 text-[10px] font-mono
                    text-sub-text">
                    Order #{sessionRefNo(x.orderRef)}
                  </div>
                )}
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
                {sel.orderRef && (
                  <div className="mt-3 text-xs text-sub-text">
                    Order / Session ID:{' '}
                    <span className="font-mono">{sel.orderRef}</span>
                  </div>
                )}
              </div>

              {/* ORDER / CONSULTATION DETAILS PANEL */}
              {sel.orderRef && (
                <div className="border-b border-gray-200 bg-bg-light p-4">
                  <div className="mb-1 text-[10px] font-bold uppercase
                    tracking-wide text-sub-text">
                    Linked consultation
                  </div>
                  {!order ? (
                    <div className="text-xs text-sub-text">
                      Loading order details…
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start
                        justify-between gap-2">
                        <div>
                          <div className="text-base font-bold">
                            {TYPE_ICON[order.type] || '✨'}{' '}
                            {orderMeta.astro || 'Astrologer'}
                            {' '}↔{' '}
                            {orderMeta.client || 'Customer'}
                          </div>
                          <div className="text-xs text-sub-text">
                            {fmt(order.startTime || order.createdAt)}
                            {' · '}
                            {fmtDur(order.duration)}
                            {' · '}
                            <span className="font-mono">
                              #{sessionRefNo(order)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-sub-text">
                            Type:{' '}
                            <b className="capitalize">{order.type}</b>
                            {' · '}Status:{' '}
                            <b className="capitalize">{order.status}</b>
                            {order.refundRequest
                              && order.refundRequest.status && (
                              <>
                                {' · Refund: '}
                                <b className="capitalize">
                                  {order.refundRequest.status}
                                </b>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold">
                            ₹{order.cost || 0}
                          </div>
                          {Number(order.refundedAmount || 0) > 0 && (
                            <div className="text-[10px] uppercase
                              text-emerald-700">
                              Refunded ₹{order.refundedAmount}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(!order.refundRequest
                          || order.refundRequest.status !== 'processed')
                          && Number(order.cost || 0) > 0 && (
                          <button onClick={() => {
                            setRfOpen(true);
                            setRfReason(REFUND_REASONS[0]);
                          }}
                            className="rounded-full bg-danger px-3
                              py-1.5 text-xs font-bold text-white">
                            ↩ Process refund · ₹{order.cost}
                          </button>
                        )}
                        <a href={`/admin-sessions?id=${order.id}`}
                          className="rounded-full border border-gray-300
                            bg-white px-3 py-1.5 text-xs font-semibold">
                          Open full session →
                        </a>
                        {order.astroId && (
                          <a href={
                            `/admin-astro-profile/${order.astroId}`}
                            className="rounded-full border border-gray-300
                              bg-white px-3 py-1.5 text-xs font-semibold">
                            👁 Astrologer profile
                          </a>
                        )}
                        {order.userId && (
                          <a href={
                            `/admin-user-profile/${order.userId}`}
                            className="rounded-full border border-gray-300
                              bg-white px-3 py-1.5 text-xs font-semibold">
                            👁 Customer profile
                          </a>
                        )}
                      </div>
                      {order.refundRequest
                        && order.refundRequest.status === 'pending' && (
                        <p className="mt-2 text-xs text-amber-700">
                          ⚠ Refund pending: {order.refundRequest.reason}
                          {' '}(by {order.refundRequest.byRole || 'astro'})
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

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

      {/* Refund modal triggered from the order details panel */}
      {rfOpen && order && (
        <div className="fixed inset-0 z-50 flex items-center
          justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-card bg-white p-4">
            <h3 className="text-lg font-bold">Process refund</h3>
            <p className="mt-1 text-xs text-sub-text">
              {orderMeta.astro} ↔ {orderMeta.client} ·{' '}
              {fmt(order.startTime || order.createdAt)} ·{' '}
              {fmtDur(order.duration)} · #{sessionRefNo(order)}
            </p>
            <p className="mt-2 text-xs text-sub-text">
              The full session amount (₹{order.cost || 0}) will be
              credited to the customer wallet immediately.
            </p>
            <label className="mt-3 block text-sm font-semibold">
              Reason
              <select className="input mt-1" value={rfReason}
                onChange={(e) => setRfReason(e.target.value)}>
                {REFUND_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setRfOpen(false)} disabled={rfBusy}
                className="btn-ghost flex-1">Cancel</button>
              <button onClick={processRefundForOrder} disabled={rfBusy}
                className="flex-1 rounded-full bg-danger px-4 py-2
                  font-bold text-white disabled:opacity-60">
                {rfBusy ? 'Refunding…' : `Refund ₹${order.cost || 0}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
