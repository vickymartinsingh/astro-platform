import { useEffect, useState } from 'react';
import Link from 'next/link';
import { galleryService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Admin moderation queue (2026-06-07): every astrologer gallery
// photo waiting for review. Approve moves it into the visible
// gallery array on the astrologer doc; Reject keeps it queued
// with a reason chip the astrologer can read.

export default function AdminGalleryReview() {
  const { loading, user } = useRequireAdmin();
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState({});

  async function refresh() {
    try { setItems(await galleryService.listAllPending()); }
    catch (_) { setItems([]); }
  }
  useEffect(() => { if (!loading) refresh(); }, [loading]);

  async function approve(it) {
    setBusy((b) => ({ ...b, [it.url]: 'approving' }));
    try {
      await galleryService.approve(it.astroId, it.url, user?.uid || '');
      flash(`Approved · ${it.astroName}`);
      setItems((cur) => (cur || [])
        .filter((x) => x.url !== it.url));
    } catch (e) {
      flash(`Approve failed: ${e?.message || e}`, 'error');
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[it.url]; return c; });
    }
  }
  async function reject(it) {
    const reason = window.prompt('Rejection reason '
      + '(shown to astrologer):', 'Content does not match policy');
    if (reason == null) return;
    setBusy((b) => ({ ...b, [it.url]: 'rejecting' }));
    try {
      await galleryService.reject(it.astroId, it.url, reason,
        user?.uid || '');
      flash(`Rejected · ${it.astroName}`);
      setItems((cur) => (cur || [])
        .filter((x) => x.url !== it.url));
    } catch (e) {
      flash(`Reject failed: ${e?.message || e}`, 'error');
    } finally {
      setBusy((b) => { const c = { ...b }; delete c[it.url]; return c; });
    }
  }

  if (loading || items === null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <header className="mb-3 flex flex-wrap items-end justify-between
        gap-2">
        <div>
          <h1 className="text-2xl font-bold">Gallery review</h1>
          <p className="mt-0.5 text-sm text-sub-text">
            Astrologer-uploaded photos waiting for review. Approving
            adds the photo to the public profile. Rejecting holds it
            in the astrologer&apos;s queue with a reason - they can
            replace it.
          </p>
        </div>
        <button onClick={refresh}
          className="rounded-full border border-gray-200 px-3 py-1.5
            text-xs font-bold text-sub-text">
          Refresh
        </button>
      </header>

      {items.length === 0 ? (
        <div className="card text-center text-sub-text">
          Queue is empty. ✓
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={`${it.astroId}-${it.url}`}
              className="surface overflow-hidden">
              <div className="relative">
                <img src={it.url} alt={it.astroName}
                  style={{ aspectRatio: '3/4', objectFit: 'cover' }}
                  className="w-full" />
                <span className="absolute left-2 top-2 rounded-full
                  bg-amber-500 px-2 py-0.5 text-[10px] font-bold
                  text-white">Pending</span>
              </div>
              <div className="p-3">
                <div className="text-sm font-bold">
                  <Link href={`/admin-user-profile/${it.astroId}`}
                    className="hover:underline">
                    {it.astroName || '(unknown)'}
                  </Link>
                </div>
                <div className="text-[10px] text-sub-text">
                  Uploaded {it.uploadedAt
                    ? new Date(it.uploadedAt).toLocaleString('en-GB',
                        { day: '2-digit', month: 'short',
                          hour: '2-digit', minute: '2-digit' })
                    : '–'}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button onClick={() => approve(it)}
                    disabled={!!busy[it.url]}
                    className="rounded-full bg-emerald-600 px-3 py-1.5
                      text-[11px] font-bold text-white
                      disabled:opacity-50">
                    {busy[it.url] === 'approving' ? '…' : 'Approve'}
                  </button>
                  <button onClick={() => reject(it)}
                    disabled={!!busy[it.url]}
                    className="rounded-full bg-rose-600 px-3 py-1.5
                      text-[11px] font-bold text-white
                      disabled:opacity-50">
                    {busy[it.url] === 'rejecting' ? '…' : 'Reject'}
                  </button>
                  <a href={it.url} target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-gray-200
                      px-3 py-1.5 text-[11px] font-bold text-sub-text">
                    Open
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
