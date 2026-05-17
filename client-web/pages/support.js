import { useEffect, useRef, useState } from 'react';
import { supportService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireClient } from '../lib/useAuth';

export default function Support() {
  const { user, profile, loading } = useRequireClient();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    if (!user) return undefined;
    supportService.ensureTicket(user.uid,
      { name: profile?.name, role: 'client' }).catch(() => {});
    return supportService.listenSupport(user.uid, setMsgs);
  }, [user, profile]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function send() {
    const v = text.trim();
    if (!v || !user) return;
    setText('');
    await supportService.sendSupport(user.uid, user.uid, v,
      { name: profile?.name, role: 'client' });
  }

  if (loading) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-1 text-xl font-bold">Help &amp; Support</h1>
      <p className="mb-3 text-sm text-sub-text">
        Chat with our support team. We usually reply within a few hours.
      </p>
      <div className="surface flex h-[65vh] flex-col p-0">
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {msgs.length === 0 && (
            <div className="text-sm text-sub-text">
              Send us a message and the support team will reply here.
            </div>
          )}
          {msgs.map((m) => {
            const mine = m.senderId === user.uid;
            return (
              <div key={m.id}
                className={`flex ${mine ? 'justify-end'
                  : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2
                  text-sm ${mine ? 'bg-primary text-white'
                    : 'bg-bg-light text-dark-text'}`}>
                  {!mine && (
                    <div className="mb-0.5 text-[11px] font-semibold
                      text-primary">Support</div>
                  )}
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
            placeholder="Type your message..." value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button onClick={send}
            className="btn-primary !min-h-0 px-5 py-2">Send</button>
        </div>
      </div>
    </Layout>
  );
}
