import { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { callService, liveService, adminService, db } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Admin can monitor any live stream exactly as a client sees it
// (video + comments) for quality control, and may post as the
// verified "Compliance Team".
export default function AdminLive() {
  const { loading } = useRequireAdmin();
  const [lives, setLives] = useState(null);
  const [sel, setSel] = useState(null); // astroUid being monitored
  const [info, setInfo] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [eng, setEng] = useState(null);
  const [savingEng, setSavingEng] = useState(false);
  const remoteRef = useRef(null);
  const cRef = useRef(null);
  const joinedRef = useRef(false);

  useEffect(() => liveService.listenLiveAstrologers(setLives), []);
  useEffect(() => {
    getDoc(doc(db, 'settings', 'features')).then((s) => {
      const d = s.exists() ? s.data() : {};
      setEng({
        live_views_per_min: Number(d.live_views_per_min) || 0,
        live_fake_enabled: d.live_fake_enabled === true,
        live_fake_every_sec: Number(d.live_fake_every_sec) || 12,
        live_fake_comments: Array.isArray(d.live_fake_comments)
          ? d.live_fake_comments.join('\n')
          : (d.live_fake_comments || ''),
      });
    }).catch(() => setEng({
      live_views_per_min: 0, live_fake_enabled: false,
      live_fake_every_sec: 12, live_fake_comments: '',
    }));
  }, []);

  async function saveEng() {
    if (!eng) return;
    setSavingEng(true);
    try {
      await adminService.updateSettings('features', {
        live_views_per_min: Number(eng.live_views_per_min) || 0,
        live_fake_enabled: !!eng.live_fake_enabled,
        live_fake_every_sec: Math.max(3,
          Number(eng.live_fake_every_sec) || 12),
        live_fake_comments: String(eng.live_fake_comments || '')
          .split('\n').map((x) => x.trim()).filter(Boolean),
      });
      flash('Live engagement settings saved');
    } catch (_) { flash('Could not save'); }
    finally { setSavingEng(false); }
  }

  useEffect(() => {
    const el = cRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments]);

  useEffect(() => {
    if (!sel) return undefined;
    const u1 = liveService.listenLive(sel, setInfo);
    const u2 = liveService.listenLiveComments(sel, setComments);
    return () => { u1 && u1(); u2 && u2(); };
  }, [sel]);

  useEffect(() => {
    if (!sel || joinedRef.current) return undefined;
    joinedRef.current = true;
    (async () => {
      try {
        const ch = liveService.liveChannel(sel);
        const id = `admin${Math.floor(Math.random() * 1e6)}`;
        const tok = await callService.fetchAgoraToken(ch, id)
          .catch(() => ({}));
        await callService.joinAgoraChannel(
          ch, id, tok.appId || callService.AGORA_APP_ID,
          tok.token || null);
        callService.subscribeToRemote((rU, mt) => {
          if (mt === 'video' && remoteRef.current) {
            rU.videoTrack?.play(remoteRef.current);
          }
          if (mt === 'audio') rU.audioTrack?.play();
        });
        liveService.announceJoin(sel, { team: true });
        liveService.bumpViewers(sel, 1);
      } catch (_) {}
    })();
    return () => {
      joinedRef.current = false;
      callService.leaveAgoraChannel().catch(() => {});
      liveService.bumpViewers(sel, -1).catch(() => {});
    };
  }, [sel]);

  async function sendTeam() {
    const v = text.trim();
    if (!v || !sel) return;
    setText('');
    await liveService.addLiveComment(sel, { team: true }, v);
  }

  if (loading) return <Layout><div className="card">Loading...</div></Layout>;

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Monitor Live Stream</h1>

      {eng && (
        <div className="surface mb-4 space-y-3 p-4">
          <div className="font-semibold">Live engagement</div>
          <p className="text-xs text-sub-text">
            Controls the customer &amp; astrologer view only. Admin
            monitoring always shows the real numbers.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Extra viewers per minute
              <input type="number" min="0" className="input mt-1"
                value={eng.live_views_per_min}
                onChange={(e) => setEng({ ...eng,
                  live_views_per_min: e.target.value })} />
            </label>
            <label className="text-sm">
              Filler comment every (sec)
              <input type="number" min="3" className="input mt-1"
                value={eng.live_fake_every_sec}
                onChange={(e) => setEng({ ...eng,
                  live_fake_every_sec: e.target.value })} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={eng.live_fake_enabled}
              onChange={(e) => setEng({ ...eng,
                live_fake_enabled: e.target.checked })} />
            Show filler comments when real ones are sparse
          </label>
          <label className="block text-sm">
            Filler comments (one per line)
            <textarea className="input mt-1" rows={5}
              placeholder="Leave blank to use the built-in set"
              value={eng.live_fake_comments}
              onChange={(e) => setEng({ ...eng,
                live_fake_comments: e.target.value })} />
          </label>
          <button onClick={saveEng} disabled={savingEng}
            className="btn-primary !min-h-0 px-5 py-2">
            {savingEng ? 'Saving...' : 'Save engagement settings'}
          </button>
        </div>
      )}

      {!sel ? (
        lives == null ? (
          <div className="card text-sub-text">Loading...</div>
        ) : lives.length === 0 ? (
          <div className="card text-sub-text">
            No astrologers are live right now.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {lives.map((l) => (
              <button key={l.id} onClick={() => setSel(l.astroUid)}
                className="card text-left">
                <div className="font-bold">{l.name}</div>
                <div className="text-xs text-sub-text">
                  {l.viewers || 0} watching - {l.likes || 0} likes
                </div>
                <div className="mt-1 text-xs font-semibold text-primary">
                  Monitor
                </div>
              </button>
            ))}
          </div>
        )
      ) : (
        <div>
          <button onClick={() => { setSel(null); }}
            className="mb-2 text-sm font-semibold text-primary">
            Back to live list
          </button>
          <div className="relative overflow-hidden rounded-2xl bg-black"
            style={{ height: '72vh' }}>
            <div ref={remoteRef} className="absolute inset-0" />
            <div className="absolute left-3 top-3 rounded-full
              bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
              MONITORING {info?.name || ''}
            </div>
            <div ref={cRef}
              className="absolute inset-x-0 bottom-14 max-h-[46%]
                overflow-y-auto px-3"
              style={{
                maskImage:
                  'linear-gradient(to top, #000 80%, transparent)',
                WebkitMaskImage:
                  'linear-gradient(to top, #000 80%, transparent)',
              }}>
              {comments.map((c) => (
                <div key={c.id} className="mb-1 text-sm text-white">
                  <span className="font-semibold">
                    {c.name}
                    {!c.team && c.uid && (
                      <span className="opacity-60">
                        {' '}({String(c.uid).slice(0, 6)})
                      </span>
                    )}:
                  </span>{' '}
                  <span className="opacity-90">{c.text}</span>
                </div>
              ))}
            </div>
            <div className="absolute inset-x-0 bottom-3 flex gap-2 px-3">
              <input
                className="h-10 flex-1 rounded-full bg-white/15 px-4
                  text-sm text-white placeholder-white/60 outline-none"
                placeholder="Post as Compliance Team..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendTeam()} />
              <button onClick={sendTeam}
                className="h-10 rounded-full bg-primary px-4 text-sm
                  font-semibold text-white">Send</button>
            </div>
          </div>
          <p className="mt-2 text-xs text-sub-text">
            You see exactly what a client sees. Quality monitoring only.
          </p>
        </div>
      )}
    </Layout>
  );
}
