import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { chatService } from '@astro/shared';
import Layout from '../../components/Layout';
import RateModal from '../../components/RateModal';
import { useRequireClient } from '../../lib/useAuth';
import { useSession } from '../../lib/useSession';
import { usePendingSession } from '../../lib/pendingSession';
import { playPing } from '../../lib/ping';

export default function ChatScreen() {
  const router = useRouter();
  const { id: astroId } = router.query;
  const { user, profile, loading } = useRequireClient();
  const { astro, session, wallet, countdown, chatId, end } =
    useSession({ astroId, type: 'chat', uid: user?.uid,
      clientName: profile?.name });

  const { track } = usePendingSession();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [showRate, setShowRate] = useState(false);
  const scrollRef = useRef(null);
  const lastCount = useRef(0);

  function minimise() {
    if (session?.id) {
      track({ sessionId: session.id, astroId, astroName: astro?.name,
        type: 'chat' });
    }
    router.push('/dashboard');
  }
  const mmss = `${Math.floor(Math.max(0, countdown) / 60)}:` +
    `${String(Math.max(0, countdown) % 60).padStart(2, '0')}`;

  useEffect(() => {
    if (!chatId) return;
    return chatService.listenMessages(chatId, setMessages);
  }, [chatId]);

  useEffect(() => {
    // Ping on a genuinely new incoming (astrologer) message, like WA/Meta.
    if (messages.length > lastCount.current) {
      const last = messages[messages.length - 1];
      if (lastCount.current > 0 && last && last.senderId !== user?.uid
          && last.senderId !== 'system') {
        playPing();
      }
      lastCount.current = messages.length;
    }
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, user]);

  useEffect(() => {
    if (session?.status === 'ended') setShowRate(true);
  }, [session?.status]);

  const active = session?.status === 'active' || session?.status === 'accepted';
  const ratePerSec = session?.ratePerSecond || 0;
  const ratePerMin = Math.round(ratePerSec * 60);
  const lowBalance = active && wallet > 0 && wallet < ratePerSec * 60;
  const broke = active && wallet <= 0;
  // Minutes the client can still afford at this rate.
  const minsLeft = ratePerMin > 0
    ? Math.floor(wallet / ratePerMin) : 0;
  const secsLeft = ratePerSec > 0
    ? Math.max(0, Math.floor(wallet / ratePerSec)) : 0;
  const clock = `${String(Math.floor(secsLeft / 60)).padStart(2, '0')}:` +
    `${String(secsLeft % 60).padStart(2, '0')}`;

  async function send() {
    if (!text.trim() || !active || broke) return;
    const v = text;
    setText('');
    await chatService.sendMessage(chatId, user.uid, v);
  }

  async function confirmEnd() {
    if (window.confirm('End this consultation now?')) end();
  }

  if (loading || !astro) {
    return <Layout nav={false}><div className="p-6">Loading…</div></Layout>;
  }

  const waiting = session && session.status === 'requesting';

  // Terminal: astrologer could not take it.
  if (session && ['rejected', 'missed'].includes(session.status)) {
    return (
      <Overlay>
        <div className="w-full max-w-sm rounded-2xl bg-white p-6
                        text-center shadow-xl">
          <h2 className="text-lg font-bold">We are sorry</h2>
          <p className="mt-2 text-sm text-sub-text">
            {session.status === 'rejected'
              ? `${astro.name} could not take your request right now.`
              : `${astro.name} did not respond in time.`}{' '}
            You have not been charged. Please try another astrologer who is
            online.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => router.push('/astrologers')}
              className="btn-grad flex-1 justify-center">
              Choose another astrologer
            </button>
            <button onClick={() => router.push('/dashboard')}
              className="btn-ghost flex-1">Home</button>
          </div>
        </div>
      </Overlay>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg-gray">
      {/* Top billing bar (blueprint 10.5) */}
      <div className="flex items-center gap-3 bg-primary px-4 py-3 text-white">
        <img src={astro.profileImage || '/avatar.png'}
          className="h-9 w-9 rounded-full object-cover" alt="" />
        <div className="flex-1">
          <div className="font-semibold">{astro.name}</div>
          <div className="text-xs opacity-90">
            ₹{ratePerMin}/min · Balance ₹{wallet.toFixed(0)}
            {active && ratePerMin > 0 && (
              <> · {clock} left</>
            )}
          </div>
        </div>
        <button onClick={confirmEnd}
          className="rounded-card bg-white/20 px-3 py-2 text-sm">
          End
        </button>
      </div>

      {waiting && (
        <div className="flex items-center gap-3 bg-accent-blue px-4 py-3">
          <span className="h-6 w-6 shrink-0 animate-spin rounded-full
                           border-2 border-white border-t-primary" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-dark-text">
              Please wait until {astro.name} accepts your chat
            </div>
            <div className="text-sub-text">
              Your details have been shared. Time left {mmss}
            </div>
          </div>
          <button onClick={minimise}
            className="shrink-0 rounded-full bg-primary px-3 py-2
                       text-xs font-semibold text-white">
            Continue browsing
          </button>
          <button onClick={() => router.push('/astrologers')}
            className="shrink-0 rounded-full border border-gray-300
                       px-3 py-2 text-xs">Cancel</button>
        </div>
      )}

      {lowBalance && (
        <div className="bg-warning px-4 py-2 text-sm text-white">
          ⚠ Only ~10 seconds remaining, {' '}
          <a href="/wallet" className="font-bold underline">Recharge now</a>
        </div>
      )}

      <div ref={scrollRef}
        className="smooth-scroll flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((m) => {
          const mine = m.senderId === user.uid;
          const system = m.senderId === 'system';
          return (
            <div key={m.id}
              className={`flex ${mine ? 'justify-end'
                : system ? 'justify-center' : 'justify-start'}`}>
              <div className={`max-w-[75%] whitespace-pre-line rounded-card
                px-3 py-2 text-sm ${
                system ? 'bg-accent-blue text-sub-text'
                : mine ? 'bg-chat-user' : 'bg-chat-astro'}`}>
                {m.text}
              </div>
            </div>
          );
        })}
      </div>

      {broke ? (
        <div className="bg-gray-100 p-3 text-center text-sm text-sub-text">
          Your balance ended, so you can&apos;t send new messages, but the
          astrologer can still reply here for up to 1 hour.{' '}
          <a href="/wallet" className="font-bold text-primary">
            Recharge to continue
          </a>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-white p-3">
          <input
            className="input flex-1 !rounded-full"
            placeholder={active ? 'Type a message…'
              : 'Waiting for the astrologer to accept…'}
            value={text} disabled={!active}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button onClick={send} disabled={!active}
            className="btn-primary !rounded-full px-5">Send</button>
        </div>
      )}

      {showRate && (
        <RateModal uid={user.uid} astroId={astroId}
          sessionId={session?.id}
          onDone={() => router.replace('/dashboard')} />
      )}
    </div>
  );
}

function Overlay({ children }) {
  return (
    <Layout nav={false}>
      <div className="flex h-screen flex-col items-center justify-center
                      text-center">
        {children}
      </div>
    </Layout>
  );
}
