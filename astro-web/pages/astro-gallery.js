import { useEffect, useRef, useState } from 'react';
import { galleryService, storage } from '@astro/shared';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

// Astrologer-side gallery uploader (operator 2026-06-07: "photos
// uploaded by astrologers up to 5 photos and post admin approval
// it should show here"). Status badges on every tile so the
// astrologer can see what's live vs queued vs rejected.
// Customer profile sheet only reads gallery[] which is the approved
// array - pending uploads are NEVER surfaced there.

export default function AstroGallery() {
  const { user, loading } = useRequireAstrologer();
  const [data, setData] = useState({ approved: [], queue: [] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!user) return undefined;
    return galleryService.listenAstroGallery(user.uid, setData);
  }, [user]);

  const totalActive = data.approved.length
    + data.queue.filter((q) => q.status === 'pending').length;
  const slotsLeft = galleryService.MAX_GALLERY - totalActive;

  async function uploadFile(file) {
    if (!file) return;
    setBusy(true); setMsg('');
    try {
      // We use Firebase Storage (same path the profile-photo upload
      // uses). On Spark plan the bucket may not exist; if uploadBytes
      // throws the catch surfaces a clean message and the astrologer
      // can wait for admin to enable Storage or use the URL paste
      // fallback below.
      const r = ref(storage,
        `astro-gallery/${user.uid}/${Date.now()}.jpg`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await galleryService.submitForReview(user.uid, url);
      setMsg('Uploaded - waiting for admin review.');
    } catch (e) {
      setMsg(`Upload failed: ${e?.message || e}. You can paste an `
        + 'image URL below as a fallback.');
    } finally { setBusy(false); }
  }

  async function submitUrl() {
    const url = window.prompt('Paste the image URL:');
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) {
      setMsg('URL must start with http(s)://'); return;
    }
    setBusy(true); setMsg('');
    try {
      await galleryService.submitForReview(user.uid, url.trim());
      setMsg('Submitted for review.');
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally { setBusy(false); }
  }

  async function remove(url) {
    if (!window.confirm('Remove this photo from the queue?')) return;
    await galleryService.removePending(user.uid, url);
  }

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  return (
    <Layout>
      <header className="mb-3">
        <h1 className="text-2xl font-bold">Gallery</h1>
        <p className="mt-0.5 text-sm text-sub-text">
          Upload up to <b>{galleryService.MAX_GALLERY}</b> photos
          for your profile. Photos appear on your customer profile
          AFTER admin approval. {slotsLeft > 0
            ? `${slotsLeft} slot${slotsLeft === 1 ? '' : 's'} left.`
            : 'All slots used.'}
        </p>
      </header>

      <div className="surface mb-3 flex flex-wrap items-center gap-2 p-3">
        <button onClick={() => inputRef.current?.click()}
          disabled={busy || slotsLeft <= 0}
          className="rounded-full bg-primary px-4 py-2 text-xs
            font-bold text-white disabled:opacity-50">
          {busy ? 'Uploading…' : '+ Upload photo'}
        </button>
        <input ref={inputRef} type="file" accept="image/*" hidden
          onChange={(e) => uploadFile(e.target.files?.[0])} />
        <button onClick={submitUrl} disabled={busy || slotsLeft <= 0}
          className="rounded-full border border-gray-200 px-4 py-2
            text-xs font-bold text-sub-text disabled:opacity-50">
          Paste URL
        </button>
        {msg && (
          <span className="text-[11px] text-sub-text">{msg}</span>
        )}
      </div>

      {data.approved.length === 0 && data.queue.length === 0 && (
        <div className="card text-sub-text">
          No photos yet. Tap <b>+ Upload photo</b> to add one.
        </div>
      )}

      {/* Approved */}
      {data.approved.length > 0 && (
        <>
          <h2 className="mb-2 text-[10px] font-bold uppercase
            tracking-wider text-sub-text">
            Live on your profile ({data.approved.length})
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.approved.map((url) => (
              <div key={url}
                className="relative overflow-hidden rounded-2xl
                  border border-emerald-200">
                <img src={url} alt="approved"
                  style={{ aspectRatio: '3/4', objectFit: 'cover' }}
                  className="w-full" />
                <span className="absolute left-1 top-1 rounded-full
                  bg-emerald-500 px-2 py-0.5 text-[10px] font-bold
                  text-white">Approved</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Queue (pending + rejected) */}
      {data.queue.length > 0 && (
        <>
          <h2 className="mb-2 mt-4 text-[10px] font-bold uppercase
            tracking-wider text-sub-text">
            Under review / Rejected ({data.queue.length})
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.queue.map((q) => (
              <div key={q.url}
                className={`relative overflow-hidden rounded-2xl
                  border ${q.status === 'rejected'
                    ? 'border-rose-200' : 'border-amber-200'}`}>
                <img src={q.url} alt={q.status}
                  style={{ aspectRatio: '3/4', objectFit: 'cover' }}
                  className="w-full" />
                <span className={`absolute left-1 top-1 rounded-full
                  px-2 py-0.5 text-[10px] font-bold text-white
                  ${q.status === 'rejected'
                    ? 'bg-rose-500' : 'bg-amber-500'}`}>
                  {q.status === 'rejected' ? 'Rejected' : 'Pending'}
                </span>
                <button onClick={() => remove(q.url)}
                  className="absolute right-1 top-1 grid h-6 w-6
                    place-items-center rounded-full bg-black/50
                    text-white">
                  ✕
                </button>
                {q.rejectedReason && (
                  <div className="absolute inset-x-0 bottom-0
                    bg-rose-600/90 p-1.5 text-[10px] text-white">
                    {q.rejectedReason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Layout>
  );
}
