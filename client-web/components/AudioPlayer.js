import { useEffect, useRef, useState } from 'react';

// WhatsApp-style compact audio player.
// 32 px tall, single row: [▶/⏸] [────●─── 00:42 / 02:18]
//
// Loads metadata only (no eager download) so a long list of recordings
// doesn't blow up the browser. Streams the file from Firebase Storage
// when the customer hits play.
function fmt(secs) {
  if (!Number.isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AudioPlayer({ src }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setPos(0);
    setDur(0);
  }, [src]);

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (playing) { el.pause(); return; }
    el.play().catch(() => { /* autoplay blocked etc - swallow */ });
  }

  function seek(e) {
    const el = ref.current;
    if (!el || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const ratio = Math.max(0, Math.min(1, x / Math.max(1, rect.width)));
    try { el.currentTime = ratio * dur; setPos(ratio * dur); }
    catch (_) { /* ignore */ }
  }

  const pct = dur > 0 ? Math.min(100, Math.max(0, (pos / dur) * 100)) : 0;
  const remaining = playing ? Math.max(0, dur - pos) : dur;

  return (
    <div className="flex items-center gap-2 rounded-full bg-bg-light
      px-2 py-1">
      <button type="button" onClick={toggle} aria-label={
        playing ? 'Pause recording' : 'Play recording'}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full
          bg-primary text-white">
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"
            aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"
            aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1 select-none cursor-pointer"
        onClick={seek} onTouchStart={seek}>
        <div className="relative h-1 w-full rounded-full bg-gray-300">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${pct}%` }} />
          <div className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2
            rounded-full bg-primary shadow"
            style={{ left: `calc(${pct}% - 5px)` }} />
        </div>
      </div>
      <span className="shrink-0 text-[10px] font-mono tabular-nums
        text-sub-text">
        {fmt(playing ? pos : 0)} / {fmt(dur || remaining)}
      </span>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPos(0); }}
      />
    </div>
  );
}
