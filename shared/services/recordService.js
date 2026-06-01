// Call / Video / Live recording for admin monitoring.
//
// Runs on EITHER side (customer or astrologer). Both end up writing
// to the same deterministic Storage path + the same indexed Firestore
// doc (id = `recording_${sessionId}`), so duplicate writes overwrite
// instead of cluttering the bucket. In practice the customer side is
// the reliable recorder because the AI auto-accept path never opens
// an astrologer browser - if we only recorded on the astro side, AI-
// accepted sessions had no recording at all.
//
// Implementation: mixes the local mic + every remote audio track via
// WebAudio into one stream. For video / live, also captures a video
// track. The finished clip uploads to Firebase Storage (media/ is
// writable by any signed-in user) and indexes as a doc in the chats
// collection (isRecordingDoc) so admin can list and play back with NO
// Firestore rules redeploy. Audio is always captured so admin can at
// least listen.
import {
  collection, addDoc, doc, setDoc, query, where, onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, getStorageLazy } from '../firebase.js';
import { getClient, getLocalTracks } from './callService.js';

let rec = null;
let chunks = [];
let ctx = null;
let dest = null;
let added = null;
let scan = null;
let meta = null;
let mediaStream = null;

function pickMime(wantVideo) {
  const C = (typeof window !== 'undefined' && window.MediaRecorder)
    ? window.MediaRecorder : null;
  if (!C) return '';
  const cands = wantVideo
    ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (let i = 0; i < cands.length; i += 1) {
    try { if (C.isTypeSupported(cands[i])) return cands[i]; } catch (_) {}
  }
  return '';
}

function reset() {
  if (scan) { clearInterval(scan); scan = null; }
  try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (_) {}
  rec = null; chunks = []; ctx = null; dest = null;
  added = null; mediaStream = null;
}

// Best-effort telemetry doc so we can see what happened on the
// customer's device without asking them to open DevTools. One doc
// per session, merged on each event. Safe to disable for prod scale -
// but right now it's the only window into the silent failure path.
async function tel(sessionId, payload) {
  if (!sessionId) return;
  try {
    await setDoc(doc(db, 'chats', `recording_${sessionId}`), {
      sessionId,
      telemetry: { [Date.now().toString()]: payload },
    }, { merge: true });
  } catch (_) { /* swallow */ }
}

// meta = { sessionId, type: 'call'|'video'|'live', astroId, userId }
export async function startRecording(m) {
  if (rec) return;
  meta = m || {};
  // Diagnostic logging: every silent failure path here is fixable
  // BUT only if we can see it. Logs always go to console AND to a
  // Firestore telemetry field on the session's recording doc so
  // admin can read it without device access.
  const sid = meta.sessionId;
  const log = (stage, extra) => {
    // eslint-disable-next-line no-console
    try { console.log('[recordService]', stage,
      extra || ''); } catch (_) {}
    tel(sid, { stage, extra: extra || null });
  };
  try {
    if (typeof window === 'undefined' || !window.MediaRecorder) {
      log('skip: no MediaRecorder support'); return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { log('skip: no AudioContext'); return; }
    ctx = new AC();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (_) {}
    }
    dest = ctx.createMediaStreamDestination();
    added = {};
    const connect = (mst) => {
      if (!mst || added[mst.id]) return;
      try {
        const src = ctx.createMediaStreamSource(new MediaStream([mst]));
        src.connect(dest);
        added[mst.id] = 1;
        log('wired track', { id: mst.id, kind: mst.kind });
      } catch (e) { log('wire failed', String(e && e.message)); }
    };
    const collect = () => {
      try {
        const lt = getLocalTracks();
        const la = lt && lt.audio && lt.audio.getMediaStreamTrack
          && lt.audio.getMediaStreamTrack();
        if (la) connect(la);
        const cl = getClient();
        const ru = (cl && cl.remoteUsers) || [];
        ru.forEach((u) => {
          const a = u.audioTrack && u.audioTrack.getMediaStreamTrack
            && u.audioTrack.getMediaStreamTrack();
          if (a) connect(a);
        });
      } catch (_) { /* ignore */ }
    };
    // Start the MediaRecorder IMMEDIATELY against the Web Audio mixer's
    // output stream. Critical: we used to await 3 seconds before
    // initialising the recorder, which meant any call shorter than
    // ~5 seconds finished hangUp BEFORE the recorder was even alive.
    // stopRecording then saw mediaRecorder=null and silently bailed
    // - which is exactly why production had 0 indexed recordings.
    //
    // dest.stream from createMediaStreamDestination is valid the
    // moment the AudioContext returns; new source nodes connected
    // later (when the remote astrologer audio arrives) feed into the
    // SAME stream so the recorder picks them up live. No wait needed.
    collect();
    scan = setInterval(collect, 1500);

    // Video / live still snapshot a single video track at this
    // moment - we wait a brief 600 ms for it to publish, but DO NOT
    // gate audio-only recordings on that wait.
    const wantVideo = meta.type === 'video' || meta.type === 'live';
    let videoMST = null;
    if (wantVideo) {
      await new Promise((r) => setTimeout(r, 600));
      try {
        const lt = getLocalTracks();
        const localV = lt && lt.video && lt.video.getMediaStreamTrack
          && lt.video.getMediaStreamTrack();
        if (meta.type === 'live' && localV) {
          videoMST = localV;
        } else {
          const cl = getClient();
          const ru = (cl && cl.remoteUsers) || [];
          for (let i = 0; i < ru.length; i += 1) {
            const v = ru[i].videoTrack
              && ru[i].videoTrack.getMediaStreamTrack
              && ru[i].videoTrack.getMediaStreamTrack();
            if (v) { videoMST = v; break; }
          }
          if (!videoMST && localV) videoMST = localV;
        }
      } catch (_) { /* audio-only fallback */ }
    }

    const audioMST = dest.stream.getAudioTracks()[0];
    const tracks = [];
    if (audioMST) tracks.push(audioMST);
    if (videoMST) tracks.push(videoMST);
    if (tracks.length === 0) {
      log('abort: zero tracks captured', { added: Object.keys(added) });
      reset(); return;
    }
    mediaStream = new MediaStream(tracks);
    const mime = pickMime(!!videoMST);
    log('starting recorder', { mime, audioTracks: tracks.length });
    rec = new window.MediaRecorder(
      mediaStream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    // 1-second timeslice so short calls still flush at least one
    // chunk before stop(); the 5-second slice meant a 4-second call
    // never produced ANY ondataavailable events and the resulting
    // blob was empty.
    rec.start(1000);
    log('recorder started OK');
  } catch (e) {
    log('startRecording threw', String((e && e.message) || e));
    reset();
  }
}

export async function stopRecording() {
  const sid = meta && meta.sessionId;
  const log = (s, e) => {
    // eslint-disable-next-line no-console
    try { console.log('[recordService] stop:', s, e || ''); } catch (_) {}
    tel(sid, { stopStage: s, extra: e || null });
  };
  if (!rec) { log('skip: not recording'); reset(); return; }
  const r = rec; rec = null;
  if (scan) { clearInterval(scan); scan = null; }
  const blob = await new Promise((res) => {
    try {
      r.onstop = () => res(new Blob(
        chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' }));
      r.stop();
    } catch (_) {
      res(new Blob(chunks, { type: 'audio/webm' }));
    }
  });
  const hasVideo = !!(mediaStream
    && mediaStream.getVideoTracks
    && mediaStream.getVideoTracks().length);
  const m = meta || {};
  reset();
  // Lowered threshold from 1024 to 200 so a very short call (e.g. a
  // 3-second hello-and-hang-up) still produces an indexed recording
  // for compliance review. Anything truly empty (mic perm denied,
  // codec mismatch) still gets dropped below the 200-byte floor.
  if (!blob || blob.size < 200) {
    log('drop: tiny/empty blob', { size: blob ? blob.size : 0 });
    return;
  }
  log('uploading', { size: blob.size, hasVideo, type: m.type });
  try {
    // DETERMINISTIC path + index doc, so customer+astro both writing
    // for the same session produce ONE file in Storage and ONE entry
    // in the admin recordings list. Last writer wins; either side
    // alone still works. Without this we accumulated stale duplicates
    // per call.
    if (!m.sessionId) { log('skip: no sessionId on meta'); return; }
    const path = `media/recordings/${m.type || 'session'}/`
      + `${m.sessionId}.webm`;
    const storage = await getStorageLazy();
    if (!storage) { log('skip: storage not available'); return; }
    const sref = ref(storage, path);
    await uploadBytes(sref, blob,
      { contentType: blob.type || 'audio/webm' });
    const url = await getDownloadURL(sref);
    // Index doc id = deterministic too, so two writers for the same
    // session don't create two index rows the admin has to clean up.
    await setDoc(doc(db, 'chats', `recording_${m.sessionId}`), {
      isRecordingDoc: true,
      sessionId: m.sessionId,
      type: m.type || 'session',
      astroId: m.astroId || '',
      userId: m.userId || '',
      kind: hasVideo ? 'video' : 'audio',
      url,
      sizeKB: Math.round(blob.size / 1024),
      ts: Date.now(),
      createdAt: serverTimestamp(),
    }, { merge: true });
    log('upload OK', { url: url.slice(0, 80),
      kB: Math.round(blob.size / 1024), path });
  } catch (e) {
    log('upload FAILED', String((e && e.message) || e));
  }
}

export function listenRecordings(cb) {
  return onSnapshot(
    query(collection(db, 'chats'),
      where('isRecordingDoc', '==', true)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))));
}
