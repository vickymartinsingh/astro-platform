import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  offerService, astrologerService, notificationService, db,
} from '@astro/shared';
import {
  collection, query, where, getDocs, orderBy, limit,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Admin offer manager (2026-06-07 spec). Lists every active offer
// across astrologers + lets admin apply one on behalf of any
// astrologer + lets admin disable a stuck offer via the per-row
// kill button. Push + email fire on admin-set so the astrologer
// learns about it immediately.

const SCOPES = [
  { id: 'live',  label: 'Live' },
  { id: 'call',  label: 'Call' },
  { id: 'chat',  label: 'Chat' },
  { id: 'video', label: 'Video' },
];

export default function AdminOffers() {
  const { loading, user } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [astros, setAstros] = useState([]);
  const [editing, setEditing] = useState(null);

  async function refresh() {
    try {
      // Pull all astrologers that currently carry an offer record.
      const snap = await getDocs(query(
        collection(db, 'astrologers'),
        where('offer.active', '==', true), limit(200)));
      const live = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRows(live);
    } catch (_) { setRows([]); }
    try {
      const all = await astrologerService.getApprovedAstrologers();
      setAstros(all || []);
    } catch (_) { /* lookup is best-effort */ }
  }
  useEffect(() => { if (!loading) refresh(); }, [loading]);

  async function notify(astroId, fields) {
    try {
      await notificationService.pushToUser(astroId, {
        title: 'Offer applied to your profile',
        body: fields.active === false
          ? 'Your offer has been disabled by support.'
          : `Admin set a ${fields.percentOff || 0}% off offer on `
            + 'your profile.',
        data: { route: '/astro-offer' },
      });
    } catch (_) { /* best effort */ }
    try {
      // Email through the relay using the standard helper. Falls
      // back silently if not wired.
      const { sendEmail } = await import('@astro/shared/services/emailService.js');
      await sendEmail({
        to: 'astrologer',
        subject: 'AstroSeer offer update',
        text: `An admin updated the offer on your profile. ` +
          `Open the Offers tab in the astrologer app to review.`,
        userId: astroId,
      }).catch(() => {});
    } catch (_) {}
  }

  async function disable(astroId) {
    if (!window.confirm('Disable this offer?')) return;
    await offerService.adminDisableOffer(astroId, user?.uid || '',
      'admin disabled');
    flash('Offer disabled');
    await notify(astroId, { active: false });
    refresh();
  }

  async function save(astroId, fields) {
    await offerService.adminSetOffer(astroId, fields, user?.uid || '');
    flash('Offer applied');
    await notify(astroId, fields);
    setEditing(null);
    refresh();
  }

  if (loading || rows === null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <header className="mb-3 flex flex-wrap items-end justify-between
        gap-2">
        <div>
          <h1 className="text-2xl font-bold">Astrologer offers</h1>
          <p className="mt-0.5 text-sm text-sub-text">
            See every astrologer running a discount. Apply or
            disable on their behalf - they receive a push + email
            notification automatically.
          </p>
        </div>
        <button onClick={() => setEditing({ astroId: '', isNew: true })}
          className="rounded-full bg-primary px-4 py-2 text-sm
            font-bold text-white">
          + Apply to an astrologer
        </button>
      </header>

      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="card text-sub-text">
            No active offers across the platform right now.
          </div>
        ) : rows.map((r) => {
          const off = r.offer || {};
          const scopes = SCOPES.filter((s) => off.scope?.[s.id])
            .map((s) => s.label).join(', ');
          return (
            <div key={r.id} className="surface flex flex-wrap
              items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-dark-text">
                  <Link href={`/admin-user-profile/${r.id}`}
                    className="hover:underline">
                    {r.name || '(unknown)'}
                  </Link>
                </div>
                <div className="text-[11px] text-sub-text">
                  {off.percentOff || 0}% off · {scopes || '(no scopes)'}
                  {off.expiresAt
                    ? ` · until ${new Date(off.expiresAt)
                      .toLocaleString('en-GB',
                        { day: '2-digit', month: 'short',
                          hour: '2-digit', minute: '2-digit' })}`
                    : ' · manual mode'}
                </div>
                <div className="text-[10px] text-sub-text">
                  Set by: <b>{off.setBy === 'admin' ? 'Admin'
                    : 'Astrologer'}</b>
                  {off.allowAstroToggleOff ? ' · astrologer can disable'
                    : ' · locked'}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setEditing({ astroId: r.id,
                  off: off })}
                  className="rounded-full border border-gray-200 px-3
                    py-1.5 text-[11px] font-bold text-sub-text
                    hover:bg-bg-light">
                  Edit
                </button>
                <button onClick={() => disable(r.id)}
                  className="rounded-full bg-rose-600 px-3 py-1.5
                    text-[11px] font-bold text-white hover:opacity-90">
                  Disable
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <OfferEditor editing={editing} astros={astros}
          onSave={(astroId, fields) => save(astroId, fields)}
          onClose={() => setEditing(null)} />
      )}
    </Layout>
  );
}

function OfferEditor({ editing, astros, onSave, onClose }) {
  const cur = editing.off || {};
  const [astroId, setAstroId] = useState(editing.astroId || '');
  const [pct, setPct] = useState(cur.percentOff || 50);
  const [duration, setDuration] = useState(cur.durationId || '120');
  const [scope, setScope] = useState({ live: true, call: true,
    chat: true, video: true, ...(cur.scope || {}) });
  const [allowAstro, setAllowAstro] = useState(
    cur.allowAstroToggleOff !== false);
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
      bg-black/40 p-3" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-4
          shadow-xl">
        <h3 className="text-base font-bold">
          {editing.isNew ? 'Apply offer for astrologer'
            : 'Edit offer'}
        </h3>
        {editing.isNew && (
          <div className="mt-3">
            <label className="text-[10px] font-bold uppercase
              tracking-wider text-sub-text">Astrologer</label>
            <select className="input mt-1" value={astroId}
              onChange={(e) => setAstroId(e.target.value)}>
              <option value="">- pick one -</option>
              {(astros || []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mt-3">
          <label className="text-[10px] font-bold uppercase
            tracking-wider text-sub-text">Discount %</label>
          <input type="number" className="input mt-1" value={pct}
            onChange={(e) => setPct(e.target.value)} />
        </div>
        <div className="mt-3">
          <label className="text-[10px] font-bold uppercase
            tracking-wider text-sub-text">Duration</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {offerService.OFFER_DURATIONS.map((d) => (
              <button key={d.id} onClick={() => setDuration(d.id)}
                className={`rounded-full border px-3 py-1 text-xs
                  font-bold ${duration === d.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-200 text-sub-text'}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <label className="text-[10px] font-bold uppercase
            tracking-wider text-sub-text">Apply to</label>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            {SCOPES.map((s) => (
              <label key={s.id}
                className="flex items-center gap-2 rounded-card
                  border border-gray-200 p-2 text-sm">
                <input type="checkbox" checked={!!scope[s.id]}
                  onChange={(e) => setScope({ ...scope,
                    [s.id]: e.target.checked })} />
                {s.label}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowAstro}
              onChange={(e) => setAllowAstro(e.target.checked)} />
            Astrologer can turn this off themselves
          </label>
        </div>
        <div className="mt-3">
          <label className="text-[10px] font-bold uppercase
            tracking-wider text-sub-text">Internal note</label>
          <input className="input mt-1" value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for override (kept in admin log)" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-semibold
              text-sub-text hover:bg-bg-light">Cancel</button>
          <button onClick={() => {
            if (!astroId) return;
            onSave(astroId, {
              percentOff: Number(pct),
              scope, durationId: duration,
              allowAstroToggleOff: allowAstro,
              note,
            });
          }}
            disabled={!astroId}
            className="rounded-full bg-primary px-4 py-2 text-sm
              font-bold text-white disabled:opacity-50">
            Apply offer
          </button>
        </div>
      </div>
    </div>
  );
}
