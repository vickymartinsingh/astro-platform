import { useEffect, useRef, useState } from 'react';
import { supportService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

export default function AdminSupport() {
  const { loading } = useRequireAdmin();
  const [tickets, setTickets] = useState([]);
  const [sel, setSel] = useState(null);   // {userId,name,role}
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => supportService.listenAllTickets(setTickets), []);
  useEffect(() => {
    if (!sel) return undefined;
    return supportService.listenSupport(sel.userId, setMsgs);
  }, [sel]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function reply() {
    const v = text.trim();
    if (!v || !sel) return;
    setText('');
    await supportService.sendSupport(sel.userId, 'support', v,
      { name: sel.name, role: sel.role });
  }

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Support Inbox</h1>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="card max-h-[70vh] overflow-y-auto">
          <div className="mb-2 text-sm font-semibold">
            Tickets ({tickets.length})
          </div>
          {tickets.length === 0 && (
            <div className="text-sm text-sub-text">No tickets yet.</div>
          )}
          {tickets.map((t) => (
            <button key={t.id}
              onClick={() => setSel({ userId: t.userId, name: t.name,
                role: t.role })}
              className={`mb-1 block w-full rounded-card p-2 text-left
                text-sm ${sel && sel.userId === t.userId
                ? 'bg-bg-light' : 'hover:bg-bg-light'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{t.name || 'User'}</span>
                <span className={`badge ${t.status === 'open'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-success/15 text-success'}`}>
                  {t.status || 'open'}
                </span>
              </div>
              <div className="text-xs capitalize text-sub-text">
                {t.role || 'client'}
              </div>
              <div className="truncate text-xs text-sub-text">
                {t.lastMessage}
              </div>
            </button>
          ))}
        </div>

        <div className="card flex h-[70vh] flex-col p-0 lg:col-span-2">
          {!sel ? (
            <div className="flex flex-1 items-center justify-center
              text-sm text-sub-text">
              Select a ticket to reply
            </div>
          ) : (
            <>
              <div className="border-b border-gray-200 p-3 text-sm
                font-semibold">
                {sel.name} <span className="capitalize text-sub-text">
                  ({sel.role})</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {msgs.map((m) => {
                  const support = m.senderId === 'support';
                  return (
                    <div key={m.id}
                      className={`flex ${support ? 'justify-end'
                        : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2
                        text-sm ${support ? 'bg-primary text-white'
                          : 'bg-bg-light text-dark-text'}`}>
                        {m.text}
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
              <div className="flex items-center gap-2 border-t
                border-gray-200 p-3">
                <input className="input flex-1 !rounded-full"
                  placeholder="Reply as Support..." value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && reply()} />
                <button onClick={reply}
                  className="btn-primary !min-h-0 px-5 py-2">Send</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
