import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { chatService } from '@astro/shared';
import Layout from '../../components/Layout';
import RateModal from '../../components/RateModal';
import { useRequireClient } from '../../lib/useAuth';
import { useSession } from '../../lib/useSession';
import { usePendingSession } from '../../lib/pendingSession';
import { playPing } from '../../lib/ping';

function GreenTick({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      style={{ display: 'inline-block', flexShrink: 0 }}>
      <path fill="#1FA855" d="M12 1.5l2.2 2.06 3-.36 1.2 2.78 2.78 1.2-.36
        3L23 12l-2.06 2.2.36 3-2.78 1.2-1.2 2.78-3-.36L12 22.5l-2.2-2.06-3
        .36-1.2-2.78-2.78-1.2.36-3L1 12l2.06-2.2-.36-3 2.78-1.2
        1.2-2.78 3 .36L12 1.5z" />
      <path fill="#fff" d="M10.6 14.4l-2.3-2.3-1.3 1.3 3.6 3.6
        6.4-6.4-1.3-1.3z" />
    </svg>
  );
}

function fmtTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate()
      : ts?.seconds ? new Date(ts.seconds * 1000)
      : ts instanceof Date ? ts : null;
    if (!d) return '';
    return d.toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit' }).toLowerCase();
  } catch (_) { return ''; }
}

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
  const [sheet, setSheet] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [busyImg, setBusyImg] = useState(false);
  const scrollRef = useRef(null);
  const lastCount = useRef(0);
  const fileRef = useRef(null);
  const camRef = useRef(null);

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

  function jumpToBottom(smooth = true) {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto' });
  }

  useEffect(() => {
    if (messages.length > lastCount.current) {
      const last = messages[messages.length - 1];
      if (lastCount.current > 0 && last && last.senderId !== user?.uid
          && last.senderId !== 'system') {
        playPing();
      }
      lastCount.current = messages.length;
    }
    if (atBottom) jumpToBottom();
  }, [messages, user, atBottom]);

  useEffect(() => {
    if (session?.status === 'ended') setShowRate(true);
  }, [session?.status]);

  const active = session?.status === 'active' || session?.status === 'accepted';
  const ratePerSec = session?.ratePerSecond || 0;
  const ratePerMin = Math.round(ratePerSec * 60);
  const lowBalance = active && wallet > 0 && wallet < ratePerSec * 60;
  const broke = active && wallet <= 0;
  const secsLeft = ratePerSec > 0
    ? Math.max(0, Math.floor(wallet / ratePerSec)) : 0;
  const clock = `${String(Math.floor(secsLeft / 60)).padStart(2, '0')}:` +
    `${String(secsLeft % 60).padStart(2, '0')}`;

  async function send() {
    if (!text.trim() || !active || broke) return;
    const v = text;
    setText('');
    setAtBottom(true);
    await chatService.sendMessage(chatId, user.uid, v);
  }

  async function pickImage(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    setSheet(false);
    if (!f || !active || broke) return;
    setBusyImg(true);
    const ok = await chatService.sendImageMessage(chatId, user.uid, f);
    setBusyImg(false);
    if (!ok) window.alert('Could not send the photo. Please try again.');
    else setAtBottom(true);
  }

  async function confirmEnd() {
    if (window.confirm('End this consultation now?')) end();
  }

  if (loading || !astro) {
    return <Layout nav={false}><div className="p-6">Loading…</div></Layout>;
  }

  const waiting = session && session.status === 'requesting';

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
              className="btn-brand flex-1 justify-center">
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
    <div className="relative flex h-screen flex-col bg-chat-canvas">
      {/* Header — Astrotalk style: back · avatar · name+tick+timer ·
          wallet · red End */}
      <div className="flex items-center gap-2.5 border-b border-black/10
                      bg-white px-3 py-2.5">
        <button onClick={minimise} aria-label="Back"
          className="-ml-1 p-1 text-2xl leading-none text-dark-text">
          ‹
        </button>
        <img src={astro.profileImage || '/avatar.png'}
          className="h-9 w-9 rounded-full object-cover" alt="" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 font-semibold
                          text-dark-text">
            <span className="truncate">{astro.name}</span>
            {astro.approved && <GreenTick />}
          </div>
          <div className="text-xs text-sub-text">
            {waiting ? 'Connecting…'
              : active && ratePerMin > 0 ? clock
              : active ? 'online'
              : 'Consultation ended'}
          </div>
        </div>
        <button onClick={() => router.push('/wallet')} aria-label="Wallet"
          className="p-1 text-dark-text">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="6" width="18" height="13" rx="2.5" />
            <path d="M3 10h18M16 14h2" />
          </svg>
        </button>
        <button onClick={confirmEnd}
          className="px-1 text-base font-semibold text-danger">
          End
        </button>
      </div>

      {waiting && (
        <div className="flex items-center gap-3 bg-brand-soft px-4 py-3">
          <span className="h-6 w-6 shrink-0 animate-spin rounded-full
                           border-2 border-brand border-t-transparent" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-dark-text">
              Please wait until {astro.name} accepts your chat
            </div>
            <div className="text-sub-text">
              Your details have been shared. Time left {mmss}
            </div>
          </div>
          <button onClick={minimise}
            className="shrink-0 rounded-full bg-brand px-3 py-2
                       text-xs font-semibold text-dark-text">
            Continue browsing
          </button>
          <button onClick={() => router.push('/astrologers')}
            className="shrink-0 rounded-full border border-gray-300
                       px-3 py-2 text-xs">Cancel</button>
        </div>
      )}

      {lowBalance && (
        <div className="bg-warning px-4 py-2 text-center text-sm text-white">
          ⚠ Low balance, only ~{secsLeft}s left ·{' '}
          <a href="/wallet" className="font-bold underline">Recharge now</a>
        </div>
      )}

      <div ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="smooth-scroll relative flex-1 overflow-y-auto
                   chat-doodle px-3 py-3">
        <div className="mb-3 flex justify-center">
          <span className="rounded-full bg-white/80 px-3 py-1 text-[11px]
                           font-medium text-sub-text shadow-sm">
            Today
          </span>
        </div>

        {messages.map((m) => {
          const mine = m.senderId === user.uid;
          const system = m.senderId === 'system';
          const divider = system && String(m.text || '').startsWith('•••');
          const t = fmtTime(m.createdAt);

          if (divider) {
            return (
              <div key={m.id} className="my-3 flex justify-center">
                <span className="rounded-full bg-white/70 px-3 py-1
                                 text-[11px] text-sub-text">
                  {String(m.text).replace(/•/g, '').trim()}
                </span>
              </div>
            );
          }
          if (system) {
            return (
              <div key={m.id} className="my-2 flex justify-center">
                <div className="max-w-[82%] whitespace-pre-line
                  rounded-2xl bg-chat-yellow px-3.5 py-2 text-center
                  text-[13px] text-dark-text shadow-sm">
                  {m.text}
                </div>
              </div>
            );
          }
          return (
            <div key={m.id}
              className={`mb-1.5 flex ${mine ? 'justify-end'
                : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-2xl px-3 py-2
                text-[14px] shadow-sm ${mine
                  ? 'rounded-br-md bg-chat-user'
                  : 'rounded-bl-md bg-chat-astro'}`}>
                {m.imageUrl ? (
                  <img src={m.imageUrl} alt="photo"
                    className="max-h-72 rounded-lg object-cover" />
                ) : (
                  <span className="whitespace-pre-line break-words
                                   text-dark-text">{m.text}</span>
                )}
                <div className={`mt-0.5 flex items-center justify-end gap-1
                  text-[10px] text-sub-text`}>
                  <span>{t}</span>
                  {mine && <span className="text-[#34B7F1]">✓✓</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!atBottom && (
        <button onClick={() => { setAtBottom(true); jumpToBottom(); }}
          aria-label="Scroll to latest"
          className="absolute bottom-24 right-4 z-10 flex h-10 w-10
            items-center justify-center rounded-full bg-white text-dark-text
            shadow-lg ring-1 ring-black/5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      )}

      {broke ? (
        <div className="bg-gray-100 p-3 text-center text-sm text-sub-text">
          Your balance ended, so you can&apos;t send new messages, but the
          astrologer can still reply here for up to 1 hour.{' '}
          <a href="/wallet" className="font-bold text-brand-dark">
            Recharge to continue
          </a>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-black/10
                        bg-white px-3 py-2.5">
          <button onClick={() => active && setSheet(true)}
            aria-label="Add photo" disabled={!active || busyImg}
            className="flex h-9 w-9 shrink-0 items-center justify-center
              rounded-full text-2xl leading-none text-sub-text
              disabled:opacity-40">
            {busyImg ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2
                               border-brand border-t-transparent" />
            ) : '+'}
          </button>
          <input
            className="h-11 flex-1 rounded-full border border-gray-200
              bg-gray-50 px-4 text-[15px] outline-none focus:border-brand"
            placeholder={active ? 'Message…'
              : 'Waiting for the astrologer to accept…'}
            value={text} disabled={!active}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button onClick={send} disabled={!active || !text.trim()}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center
              rounded-full bg-brand text-dark-text disabled:opacity-40">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4
              20-7z" /></svg>
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" hidden
        onChange={pickImage} />
      <input ref={camRef} type="file" accept="image/*" capture="environment"
        hidden onChange={pickImage} />

      {sheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end
                        bg-black/30" onClick={() => setSheet(false)}>
          <div className="m-2 animate-[slideUp_.18s_ease-out]"
            onClick={(e) => e.stopPropagation()}>
            <div className="overflow-hidden rounded-2xl bg-white/95
                            backdrop-blur">
              <div className="py-3 text-center text-sm font-semibold
                              text-sub-text">Choose Picture</div>
              <button onClick={() => camRef.current?.click()}
                className="block w-full border-t border-gray-200 py-4
                  text-center text-base text-brand-dark">
                From Camera
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="block w-full border-t border-gray-200 py-4
                  text-center text-base text-brand-dark">
                From Photos
              </button>
            </div>
            <button onClick={() => setSheet(false)}
              className="mt-2 block w-full rounded-2xl bg-white py-4
                text-center text-base font-semibold text-danger">
              Cancel
            </button>
          </div>
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
