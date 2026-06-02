import { useEffect, useState } from 'react';
import { db } from '@astro/shared';
import {
  collection, query, where, onSnapshot,
} from 'firebase/firestore';

// Lists every call / video recording for ONE user (customer or astro).
// The recording index docs live in chats/ with isRecordingDoc=true.
// We filter by either userId or astroId so the same component works
// for both customer and astro profiles.
function fmtDt(ms) {
  if (!ms) return '–';
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m) return `${m}m ${r}s`;
  return `${s}s`;
}

export default function UserRecordingsPanel({ uid, kind = 'customer' }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return undefined;
    const field = kind === 'astrologer' ? 'astroId' : 'userId';
    const q = query(collection(db, 'chats'),
      where('isRecordingDoc', '==', true),
      where(field, '==', uid));
    const unsub = onSnapshot(q, (s) => {
      setRecs(s.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [uid, kind]);

  return (
    <div className="surface mt-4 p-3">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
        text-sub-text">
        Call recordings ({recs.length})
      </h2>
      {loading ? (
        <div className="text-sm text-sub-text">Loading...</div>
      ) : recs.length === 0 ? (
        <div className="text-sm text-sub-text">
          No call or video recordings for this {kind} yet.
        </div>
      ) : (
        <div className="space-y-2">
          {recs.map((r) => (
            <div key={r.id}
              className="rounded-card border border-gray-200 p-3">
              <div className="flex flex-wrap items-center
                justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold">
                      {r.sessionId || '–'}
                    </span>
                    <span className="rounded-full bg-bg-light
                      px-2 py-0.5 text-[10px] font-bold capitalize">
                      {r.type} · {r.kind || 'audio'}
                    </span>
                  </div>
                  <div className="text-[11px] text-sub-text">
                    {fmtDt(r.ts)} · {fmtDur(r.durationSec)}
                    {r.sizeKB ? ` · ${r.sizeKB} KB` : ''}
                  </div>
                </div>
                <a href={r.url} target="_blank" rel="noreferrer"
                  className="text-[11px] font-bold text-primary
                    hover:underline">
                  Download
                </a>
              </div>
              <div className="mt-2">
                {r.kind === 'video' ? (
                  <video src={r.url} controls
                    className="w-full max-w-md rounded bg-black" />
                ) : (
                  <audio src={r.url} controls className="w-full" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
