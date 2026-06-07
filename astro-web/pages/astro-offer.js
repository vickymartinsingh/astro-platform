import { useEffect, useState } from 'react';
import { offerService, astrologerService } from '@astro/shared';
import { useRequireAstrologer } from '../lib/useAuth';
import Layout from '../components/Layout';

// Operator 2026-06-07: astrologer-side offer toggle. Once activated
// the offer LOCKS - the astrologer cannot turn it off; only admin
// can release via a ticket. Default duration 120 mins.

const SCOPES = [
  { id: 'live',  label: 'Live consultation' },
  { id: 'call',  label: 'Audio call' },
  { id: 'chat',  label: 'Chat' },
  { id: 'video', label: 'Video call' },
];

export default function AstroOffer() {
  const { user, loading } = useRequireAstrologer();
  const [offer, setOffer] = useState(null);
  const [pct, setPct] = useState(50);
  const [scope, setScope] = useState({ live: true, call: true,
    chat: true, video: true });
  const [duration, setDuration] = useState('120');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!user) return undefined;
    return offerService.listenAstroOffer(user.uid, setOffer);
  }, [user]);

  const active = offerService.isOfferActive(offer);
  const lockedForAstro = active && !offer?.allowAstroToggleOff;

  async function activate() {
    setBusy(true); setMsg('');
    try {
      await offerService.activateOffer(user.uid, {
        percentOff: Number(pct), scope, durationId: duration,
      });
      setMsg('Offer activated. Customers will see the discounted '
        + 'rate immediately.');
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally { setBusy(false); }
  }

  async function tryToggleOff() {
    setBusy(true); setMsg('');
    try {
      await offerService.astroToggleOff(user.uid);
      setMsg('Offer disabled.');
    } catch (e) {
      setMsg(e.code === 'locked'
        ? 'Offer is locked. Raise a support ticket and the admin '
          + 'will release it.'
        : String(e?.message || e));
    } finally { setBusy(false); }
  }

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  return (
    <Layout>
      <header className="mb-3">
        <h1 className="text-2xl font-bold">Run an offer</h1>
        <p className="mt-0.5 text-sm text-sub-text">
          Reduce your rate for a set duration to attract more
          customers. <b>Once activated, you can&apos;t turn it off
          yourself</b> - the offer runs for its full duration, or
          until an admin releases it after a support ticket.
        </p>
      </header>

      {active && (
        <div className="surface mb-3 border border-emerald-200
          bg-emerald-50/60 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider
            text-emerald-700">Offer active</div>
          <div className="mt-1 text-xl font-bold text-dark-text">
            {offer.percentOff}% off
          </div>
          <div className="text-[12px] text-sub-text">
            Applies to:{' '}
            {SCOPES.filter((s) => offer.scope?.[s.id])
              .map((s) => s.label).join(', ')}
          </div>
          <div className="text-[11px] text-sub-text">
            {offer.expiresAt && offer.expiresAt > 0
              ? `Expires ${new Date(offer.expiresAt).toLocaleString('en-GB')}`
              : 'Runs until you turn it off (manual mode)'}
          </div>
          <div className="mt-2 text-[11px] text-sub-text">
            Set by: <b>{offer.setBy === 'admin' ? 'Admin'
              : 'You'}</b>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={tryToggleOff} disabled={busy}
              className="rounded-full border border-rose-200 px-4 py-2
                text-xs font-bold text-rose-700 disabled:opacity-50">
              {lockedForAstro
                ? 'Turn off (locked - admin required)'
                : 'Turn off'}
            </button>
            <a href="/astro-support"
              className="rounded-full border border-gray-200 px-4 py-2
                text-xs font-bold text-sub-text">
              Raise a ticket
            </a>
          </div>
          {msg && (
            <div className="mt-2 text-[11px] text-sub-text">{msg}</div>
          )}
        </div>
      )}

      {!active && (
        <div className="surface space-y-4 p-4">
          <Field label="Discount percent">
            <div className="flex flex-wrap gap-1.5">
              {[10, 20, 30, 40, 50, 60, 70].map((p) => (
                <button key={p} onClick={() => setPct(p)}
                  className={`rounded-full border px-3 py-1 text-xs
                    font-bold ${pct === p
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 text-sub-text'}`}>
                  {p}%
                </button>
              ))}
            </div>
          </Field>
          <Field label="Duration"
            hint="Default 2 hours. Once activated this cannot be changed.">
            <div className="flex flex-wrap gap-1.5">
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
          </Field>
          <Field label="Apply to">
            <div className="grid grid-cols-2 gap-2">
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
          </Field>
          {msg && (
            <div className="rounded-card bg-rose-50 p-2 text-xs
              text-rose-700">{msg}</div>
          )}
          <button onClick={activate} disabled={busy}
            className="w-full rounded-full bg-primary py-3 text-sm
              font-bold text-white disabled:opacity-50">
            {busy ? 'Activating…' : `Activate ${pct}% off`}
          </button>
          <p className="text-[10.5px] text-sub-text">
            Customers will see the discounted rate immediately on
            your live, profile, and call screens. Existing bookings
            are not affected.
          </p>
        </div>
      )}
    </Layout>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider
        text-sub-text">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-sub-text">{hint}</div>
      )}
    </div>
  );
}
