import { useEffect, useRef, useState } from 'react';
import { ticketService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

function fmt(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis()
    : (typeof ts === 'number' ? ts : 0);
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminTickets() {
  const { loading } = useRequireAdmin();
  const [list, setList] = useState([]);
  const [term, setTerm] = useState('');
  const [sel, setSel] = useState(null);   // ticket object
  const [msgs, setMsgs] = useState([]);
  const [reply, setReply] = useState('');
  const endRef = useRef(null);

  useEffect(() => ticketService.listenAllTickets(setList), []);
  useEffect(() => {
    if (!sel) return undefined;
    return ticketService.listenTicket(sel.id, setMsgs);
  }, [sel]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const t = term.trim().toLowerCase();
  const shown = !t ? list : list.filter((x) =>
    [x.ticketNo, x.userId, x.name, x.subject, x.email, x.phone,
      x.userCode, x.category]
      .some((v) => String(v || '').toLowerCase().includes(t)));

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
      <h1 className="mb-1 text-xl font-bold">Support Tickets</h1>
      <p className="mb-3 text-sm text-sub-text">
        Look up any ticket by its number, or by the customer&apos;s
        name / email / phone / user code / UID.
      </p>
      <input className="input mb-3"
        placeholder="Search ticket no or customer..."
        value={term} onChange={(e) => setTerm(e.target.value)} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-1">
          {shown.length === 0 ? (
            <div className="card text-sm text-sub-text">
              No tickets.
            </div>
          ) : shown.map((x) => {
            const fin = ticketService.isFinalClosed(x);
            return (
              <button key={x.id} onClick={() => setSel(x)}
                className={`card w-full text-left ${
                  sel && sel.id === x.id ? 'ring-2 ring-primary' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{x.ticketNo}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs
                    font-semibold ${fin
                      ? 'bg-gray-100 text-gray-500'
                      : x.status === 'assigned'
                        ? 'bg-primary/15 text-primary'
                        : 'bg-warning/15 text-warning'}`}>
                    {fin ? 'Closed' : x.status}
                  </span>
                </div>
                <div className="truncate text-sm">{x.subject}</div>
                <div className="text-xs text-sub-text">
                  {x.name} - {x.team}
                </div>
                <div className="text-[11px] text-sub-text">
                  {fmt(x.updatedAt)}
                </div>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-2">
          {!sel ? (
            <div className="card text-sm text-sub-text">
              Select a ticket to view the conversation.
            </div>
          ) : (
            <div className="card p-0">
              <div className="border-b border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{sel.subject}</div>
                    <div className="text-xs text-sub-text">
                      {sel.ticketNo} - {sel.team} - {sel.category}
                    </div>
                    <div className="text-xs text-sub-text">
                      {sel.name} - UID {sel.userId}
                    </div>
                    {sel.orderRef && (
                      <div className="text-xs text-sub-text">
                        Order: {sel.orderRef}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-sub-text">
                      Opened {fmt(sel.createdAt)}
                      {sel.closedAt
                        ? ` - Closed ${fmt(sel.closedAt)}` : ''}
                    </div>
                  </div>
                  <button onClick={close}
                    className="shrink-0 rounded-full border border-danger
                      px-3 py-1.5 text-sm text-danger">
                    Close ticket
                  </button>
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
                          {admin ? 'Support' : (sel.name || 'Customer')}
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
              <div className="flex items-center gap-2 border-t
                border-gray-200 p-3">
                <input className="input flex-1 !rounded-full"
                  placeholder="Reply to customer..."
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()} />
                <button onClick={send}
                  className="btn-primary !min-h-0 px-5 py-2">
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
