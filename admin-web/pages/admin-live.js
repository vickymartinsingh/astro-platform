import { useEffect, useRef, useState } from 'react';
import {
  collection, doc, getDoc, getDocs, query, where,
  onSnapshot,
} from 'firebase/firestore';
import { callService, liveService, adminService, db } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Admin can monitor any live stream exactly as a client sees it
// (video + comments) for quality control, and may post as the
// verified "Compliance Team".
//
// Three tabs: Live Now | History | Recordings
// Live Now  - existing stream monitor + engagement settings + DP upload
// History   - past live sessions from listenLiveHistory
// Recordings - chats docs that have a recordingUrl field set

function fmtDt(ms) {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${rem}s`;
  return `${s}s`;
}

// Per-card blocked users panel (Live Now tab only).
function BlockedPanel({ astroUid }) {
  const [blocked, setBlocked] = useState([]);
  const [busy, setBusy] = useState({});

  useEffect(() => {
    if (!astroUid) return undefined;
    return liveService.listenBlockedUsers(astroUid, setBlocked);
  }, [astroUid]);

  async function forceUnblock(userId) {
    setBusy((b) => ({ ...b, [userId]: true }));
    try {
      await liveService.unblockUserFromLive(astroUid, userId);
      flash('User unblocked');
    } catch (_) { flash('Could not unblock'); }
    finally { setBusy((b) => ({ ...b, [userId]: false })); }
  }

  if (blocked.length === 0) {
    return (
      <div className="mt-3 border-t border-gray-200 pt-3">
        <div className="text-xs font-semibold" style={{ color: '#7F2020' }}>
          Blocked Users
        </div>
        <div className="mt-1 text-xs text-sub-text">None blocked.</div>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <div className="mb-2 text-xs font-semibold" style={{ color: '#7F2020' }}>
        Blocked Users ({blocked.length})
      </div>
      <div className="space-y-1">
        {blocked.map((u) => (
          <div key={u.id}
            className="flex items-center justify-between rounded-card px-3 py-1.5"
            style={{ background: '#FFF8E7' }}>
            <div>
              <span className="text-xs font-semibold">{u.userName || u.userId}</span>
              <span className="ml-1.5 text-[10px] text-sub-text">
                {String(u.userId || '').slice(0, 10)}
              </span>
            </div>
            <button
              disabled={busy[u.id || u.userId]}
              onClick={() => forceUnblock(u.id || u.userId)}
              className="rounded-card border px-2 py-0.5 text-[11px] font-semibold"
              style={{ borderColor: '#D4A12A', color: '#7F2020' }}>
              {busy[u.id || u.userId] ? 'Working...' : 'Force Unblock'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminLive() {
  const { loading } = useRequireAdmin();
  const [tab, setTab] = useState('live');       // live | history | recordings

  // Live Now state
  const [lives, setLives] = useState(null);
  const [sel, setSel] = useState(null);         // astroUid being monitored
  const [info, setInfo] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [eng, setEng] = useState(null);
  const [savingEng, setSavingEng] = useState(false);
  const [dp, setDp] = useState('');
  const [dpBusy, setDpBusy] = useState(false);
  const remoteRef = useRef(null);
  const cRef = useRef(null);
  const joinedRef = useRef(false);

  // History state
  const [hist, setHist] = useState([]);

  // Recordings state
  const [recs, setRecs] = useState([]);
  const [recsLoading, setRecsLoading] = useState(false);

  // ----------------------------------------------------------------
  // Live Now effects
  // ----------------------------------------------------------------
  useEffect(() => liveService.listenLiveAstrologers(setLives), []);
  useEffect(() => liveService.watchComplianceDp(setDp), []);
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

  // ----------------------------------------------------------------
  // History effect
  // ----------------------------------------------------------------
  useEffect(() => {
    if (tab !== 'history') return undefined;
    return liveService.listenLiveHistory(null, setHist);
  }, [tab]);

  // ----------------------------------------------------------------
  // Recordings effect - query chats for docs with recordingUrl set
  // ----------------------------------------------------------------
  useEffect(() => {
    if (tab !== 'recordings') return;
    setRecsLoading(true);
    getDocs(
      query(collection(db, 'chats'), where('recordingUrl', '!=', ''))
    ).then((snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.ts || b.createdAt || 0) - (a.ts || a.createdAt || 0));
      setRecs(rows);
    }).catch(() => setRecs([]))
      .finally(() => setRecsLoading(false));
  }, [tab]);

  // ----------------------------------------------------------------
  // Live engagement save
  // ----------------------------------------------------------------
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

  // ----------------------------------------------------------------
  // Compliance Team DP helpers
  // ----------------------------------------------------------------
  function fileToDataUrl(file, maxW) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('read failed'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => rej(new Error('bad image'));
        img.onload = () => {
          const sc = Math.min(1, maxW / (img.width || maxW));
          const w = Math.max(1, Math.round((img.width || maxW) * sc));
          const h = Math.max(1, Math.round((img.height || maxW) * sc));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          res(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function uploadDp(file) {
    if (!file) return;
    setDpBusy(true);
    try {
      const url = await fileToDataUrl(file, 256);
      if (url.length > 700000) {
        flash('Image too large - pick a smaller one'); return;
      }
      // eslint-disable-next-line no-alert, no-restricted-globals
      if (!confirm('Set this as the Compliance Team display picture? '
        + 'It will show on every Compliance Team message in live.')) {
        return;
      }
      await adminService.updateSettings('config',
        { compliance_dp: url });
      setDp(url);
      flash('Compliance Team DP updated');
    } catch (_) { flash('Could not upload'); }
    finally { setDpBusy(false); }
  }
  async function removeDp() {
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm('Remove the Compliance Team display picture?')) return;
    setDpBusy(true);
    try {
      await adminService.updateSettings('config', { compliance_dp: '' });
      setDp('');
      flash('Compliance Team DP removed');
    } finally { setDpBusy(false); }
  }

  // ----------------------------------------------------------------
  // Stream monitor effects
  // ----------------------------------------------------------------
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

  // Tab button style helper
  const tabCls = (k) => [
    'rounded-card px-5 py-2 text-sm font-semibold transition-colors',
    tab === k
      ? 'text-white'
      : 'border text-sub-text bg-white',
  ].join(' ');
  const tabStyle = (k) => tab === k
    ? { background: '#7F2020', borderColor: '#7F2020' }
    : { borderColor: '#D4A12A' };

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Monitor Live Stream</h1>

      {/* Three-tab header */}
      <div className="mb-4 flex gap-2">
        {[['live', 'Live Now'], ['history', 'History'], ['recordings', 'Recordings']].map(
          ([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={tabCls(k)} style={tabStyle(k)}>
              {label}
            </button>
          )
        )}
      </div>

      {/* ============================================================
          TAB: LIVE NOW
          ============================================================ */}
      {tab === 'live' && (
        <>
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

          <div className="surface mb-4 p-4">
            <div className="mb-1 font-semibold">
              Compliance Team display picture
            </div>
            <p className="mb-3 text-xs text-sub-text">
              Shown on every &quot;Compliance Team&quot; message / join in
              live (client, astrologer &amp; admin views).
            </p>
            <div className="flex items-center gap-4">
              {dp ? (
                <img src={dp} alt="Compliance Team"
                  className="h-16 w-16 rounded-full object-cover
                    ring-2 ring-success" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center
                  rounded-full bg-bg-light text-2xl text-sub-text">*</span>
              )}
              <div className="flex flex-wrap gap-2">
                <label className="cursor-pointer rounded-card bg-primary
                  px-4 py-2 text-sm font-semibold text-white">
                  {dpBusy ? 'Working...' : (dp ? 'Choose / change'
                    : 'Choose and upload')}
                  <input type="file" accept="image/*" hidden
                    onChange={(e) => uploadDp(e.target.files?.[0])} />
                </label>
                {dp && (
                  <button onClick={removeDp} disabled={dpBusy}
                    className="rounded-card border border-danger px-4 py-2
                      text-sm font-semibold text-danger">
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

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
                  <div key={l.id}
                    className="card"
                    style={{ borderTop: '3px solid #D4A12A' }}>
                    <div className="font-bold">{l.name}</div>
                    <div className="text-xs text-sub-text">
                      {l.viewers || 0} watching - {l.likes || 0} likes
                    </div>
                    <button
                      onClick={() => setSel(l.astroUid)}
                      className="mt-2 text-sm font-semibold"
                      style={{ color: '#7F2020' }}>
                      Monitor
                    </button>
                    {/* Blocked users panel per card */}
                    <BlockedPanel astroUid={l.astroUid} />
                  </div>
                ))}
              </div>
            )
          ) : (
            <div>
              <button onClick={() => { setSel(null); }}
                className="mb-2 text-sm font-semibold"
                style={{ color: '#7F2020' }}>
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
                        {!c.team && c.userCode && (
                          <span className="opacity-60">
                            {' '}({c.userCode})
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
                    className="h-10 rounded-full px-4 text-sm
                      font-semibold text-white"
                    style={{ background: '#7F2020' }}>Send</button>
                </div>
              </div>
              <p className="mt-2 text-xs text-sub-text">
                You see exactly what a client sees. Quality monitoring only.
              </p>
            </div>
          )}
        </>
      )}

      {/* ============================================================
          TAB: HISTORY
          ============================================================ */}
      {tab === 'history' && (
        hist.length === 0 ? (
          <div className="card text-sub-text">No live sessions yet.</div>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase
                tracking-wider text-sub-text">
                <tr>
                  <th className="p-3">Astrologer</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Started</th>
                  <th className="p-3">Duration</th>
                  <th className="p-3">Viewers</th>
                  <th className="p-3">Likes</th>
                </tr>
              </thead>
              <tbody>
                {hist.map((h) => (
                  <tr key={h.id} className="border-t border-gray-200">
                    <td className="p-3">
                      <div className="font-semibold">{h.name}</div>
                      <div className="text-[11px] text-sub-text">
                        {String(h.astroUid || '').slice(0, 10)}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5
                        text-[11px] font-semibold ${
                        h.status === 'cancelled'
                          ? 'bg-danger/15 text-danger'
                          : 'bg-success/15 text-success'}`}>
                        {h.status === 'cancelled' ? 'Cancelled' : 'Ended'}
                      </span>
                    </td>
                    <td className="p-3 text-xs">
                      {fmtDt(h.startedAtMs || h.ts)}
                    </td>
                    <td className="p-3 text-xs">
                      {fmtDur(h.durationSec)}
                    </td>
                    <td className="p-3">{h.viewers || 0}</td>
                    <td className="p-3">{h.likes || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ============================================================
          TAB: RECORDINGS
          Queries chats collection for docs with recordingUrl set.
          ============================================================ */}
      {tab === 'recordings' && (
        recsLoading ? (
          <div className="card text-sub-text">Loading recordings...</div>
        ) : recs.length === 0 ? (
          <div className="card text-sub-text">No recordings found.</div>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead
                className="text-left text-[11px] uppercase tracking-wider"
                style={{ color: '#7F2020' }}>
                <tr style={{ background: '#FFF8E7' }}>
                  <th className="p-3">Date</th>
                  <th className="p-3">Astrologer ID</th>
                  <th className="p-3">User ID</th>
                  <th className="p-3">Duration</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Play</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((r) => (
                  <tr key={r.id}
                    className="border-t border-gray-200 align-middle hover:bg-amber-50/40">
                    <td className="p-3 text-xs">
                      {fmtDt(r.ts || r.createdAt)}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {r.astroId
                        ? <span title={r.astroId}>{String(r.astroId).slice(0, 14)}</span>
                        : <span className="text-sub-text">-</span>}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {r.userId
                        ? <span title={r.userId}>{String(r.userId).slice(0, 14)}</span>
                        : <span className="text-sub-text">-</span>}
                    </td>
                    <td className="p-3 text-xs">
                      {r.durationSec ? fmtDur(r.durationSec) : '-'}
                    </td>
                    <td className="p-3">
                      <span className="rounded-full px-2 py-0.5 text-[11px]
                        font-semibold capitalize"
                        style={{ background: '#FFF8E7', color: '#7F2020',
                          border: '1px solid #D4A12A' }}>
                        {r.type || 'live'}
                      </span>
                    </td>
                    <td className="p-3">
                      <a
                        href={r.recordingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-card px-3 py-1 text-xs font-semibold text-white"
                        style={{ background: '#7F2020' }}>
                        Play
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </Layout>
  );
}
