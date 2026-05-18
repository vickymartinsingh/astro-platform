import { useEffect, useRef, useState } from 'react';
import { ticketService, sessionService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireClient } from '../lib/useAuth';

const { TICKET_CATEGORIES, SUPPORT_FAQS } = ticketService;

function fmt(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
function statusChip(t) {
  const f = ticketService.isFinalClosed(t);
  const s = f ? 'Closed'
    : t.status === 'closed' ? 'Closed (reopen within 24h)'
      : t.status === 'assigned' ? 'In progress'
        : t.status === 'reopened' ? 'Reopened' : 'Open';
  const c = f ? 'bg-gray-100 text-gray-500'
    : t.status === 'assigned' ? 'bg-primary/15 text-primary'
      : 'bg-warning/15 text-warning';
  return [s, c];
}

export default function Support() {
  const { user, profile, loading } = useRequireClient();
  const [view, setView] = useState('list');     // list | new | <id>
  const [tickets, setTickets] = useState([]);
  const [openFaq, setOpenFaq] = useState(-1);
  // new-ticket form
  const [f, setF] = useState({ category: 'order', subject: '',
    message: '', orderRef: '' });
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // ticket thread
  const [msgs, setMsgs] = useState([]);
  const [reply, setReply] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    if (!user) return undefined;
    return ticketService.listenMyTickets(user.uid, setTickets);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    sessionService.getUserSessions(user.uid)
      .then((l) => setOrders((l || []).slice(0, 15)))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user || view === 'list' || view === 'new') return undefined;
    return ticketService.listenTicket(view, setMsgs);
  }, [user, view]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const ticket = tickets.find((t) => t.id === view) || null;

  async function submitNew() {
    setErr('');
    if (!f.subject.trim() || !f.message.trim()) {
      setErr('Please add a subject and describe the issue.'); return;
    }
    if (f.category === 'order' && !f.orderRef) {
      setErr('Please select the related order.'); return;
    }
    setBusy(true);
    try {
      const r = await ticketService.createTicket(user.uid, {
        ...f, name: profile?.name, role: 'client' });
      setF({ category: 'order', subject: '', message: '',
        orderRef: '' });
      setView(r.id);
    } catch (e) {
      setErr(e.message || 'Could not create the ticket.');
    } finally { setBusy(false); }
  }

  async function send() {
    const v = reply.trim();
    if (!v || !ticket) return;
    setReply(''); setErr('');
    try {
      await ticketService.sendTicketMessage(ticket, user.uid, v, false);
    } catch (e) {
      setErr(e.message || 'Could not send.');
    }
  }

  // ---- TICKET THREAD ----
  if (ticket) {
    const finalClosed = ticketService.isFinalClosed(ticket);
    const [sLabel, sClass] = statusChip(ticket);
    return (
      <Layout>
        <button onClick={() => { setView('list'); setErr(''); }}
          className="mb-2 text-sm font-semibold text-primary">
          &lt; All tickets
        </button>
        <div className="surface mb-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-bold">{ticket.subject}</div>
              <div className="text-xs text-sub-text">
                {ticket.ticketNo} - {ticket.team}
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs
              font-semibold ${sClass}`}>{sLabel}</span>
          </div>
          <div className="mt-1 text-[11px] text-sub-text">
            Opened {fmt(ticket.createdAt)}
          </div>
        </div>

        <div className="surface flex h-[55vh] flex-col p-0">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.map((m) => {
              const mine = m.role !== 'admin';
              return (
                <div key={m.id}
                  className={`flex ${mine ? 'justify-end'
                    : 'justify-start'}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2
                    text-sm ${mine ? 'bg-primary text-white'
                      : 'bg-bg-light text-dark-text'}`}>
                    {!mine && (
                      <div className="mb-0.5 text-[11px] font-semibold
                        text-primary">Support</div>
                    )}
                    <div>{m.text}</div>
                    <div className={`mt-1 text-[10px] ${mine
                      ? 'text-white/70' : 'text-sub-text'}`}>
                      {fmt(m.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          {err && (
            <div className="px-4 pb-1 text-xs text-danger">{err}</div>
          )}
          {finalClosed ? (
            <div className="border-t border-gray-200 p-3 text-center
              text-sm text-sub-text">
              This ticket is closed.{' '}
              <button onClick={() => { setView('new');
                setF((p) => ({ ...p, category: ticket.category })); }}
                className="font-semibold text-primary">
                Open a new ticket
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-t
              border-gray-200 p-3">
              <input className="input flex-1 !rounded-full"
                placeholder={ticket.status === 'closed'
                  ? 'Reply to reopen this ticket...'
                  : 'Type your message...'}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button onClick={send}
                className="btn-primary !min-h-0 px-5 py-2">Send</button>
            </div>
          )}
        </div>
      </Layout>
    );
  }

  // ---- NEW TICKET ----
  if (view === 'new') {
    return (
      <Layout>
        <button onClick={() => { setView('list'); setErr(''); }}
          className="mb-2 text-sm font-semibold text-primary">
          &lt; Back
        </button>
        <h1 className="mb-3 text-xl font-bold">Raise a ticket</h1>
        <div className="surface space-y-3 p-4">
          <label className="block text-sm">
            What is it about?
            <select className="input mt-1" value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}>
              {TICKET_CATEGORIES.map(([k, lbl]) => (
                <option key={k} value={k}>{lbl}</option>
              ))}
            </select>
          </label>
          {f.category === 'order' && (
            <label className="block text-sm">
              Select the related order
              <select className="input mt-1" value={f.orderRef}
                onChange={(e) => setF({
                  ...f, orderRef: e.target.value })}>
                <option value="">Choose one...</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {(o.type || 'session')} - {fmt(o.createdAt)}
                    {o.cost ? ` - Rs ${o.cost}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <input className="input" placeholder="Subject"
            value={f.subject}
            onChange={(e) => setF({ ...f, subject: e.target.value })} />
          <textarea className="input" rows={4}
            placeholder="Describe your issue"
            value={f.message}
            onChange={(e) => setF({ ...f, message: e.target.value })} />
          {err && <div className="text-sm text-danger">{err}</div>}
          <button onClick={submitNew} disabled={busy}
            className="btn-primary w-full">
            {busy ? 'Submitting...' : 'Submit ticket'}
          </button>
          <p className="text-xs text-sub-text">
            You will get a ticket number and a notification. You can
            have separate tickets for different issues, but only one
            open ticket per issue type.
          </p>
        </div>
      </Layout>
    );
  }

  // ---- LIST + FAQ ----
  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Help &amp; Support</h1>
      <p className="mb-3 text-sm text-sub-text">
        Check the FAQs below, or raise a ticket and our team will help.
      </p>

      <button onClick={() => { setView('new'); setErr(''); }}
        className="btn-primary mb-4 w-full">
        + Raise a new ticket
      </button>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide
        text-sub-text">Your tickets</h2>
      <div className="space-y-2">
        {tickets.length === 0 ? (
          <div className="card text-sm text-sub-text">
            No tickets yet.
          </div>
        ) : tickets.map((t) => {
          const [sLabel, sClass] = statusChip(t);
          return (
            <button key={t.id} onClick={() => setView(t.id)}
              className="card flex w-full items-start justify-between
                gap-3 text-left">
              <div className="min-w-0">
                <div className="font-semibold">{t.subject}</div>
                <div className="text-xs text-sub-text">
                  {t.ticketNo} - {t.team}
                </div>
                <div className="mt-0.5 text-[11px] text-sub-text">
                  Updated {fmt(t.updatedAt)}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5
                text-xs font-semibold ${sClass}`}>{sLabel}</span>
            </button>
          );
        })}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase
        tracking-wide text-sub-text">FAQ</h2>
      <div className="space-y-2">
        {SUPPORT_FAQS.map(([q, a], i) => (
          <div key={q} className="card">
            <button
              onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
              className="flex w-full items-center justify-between
                text-left text-sm font-semibold">
              {q}<span className="text-sub-text">
                {openFaq === i ? '-' : '+'}</span>
            </button>
            {openFaq === i && (
              <p className="mt-2 text-sm text-sub-text">{a}</p>
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
