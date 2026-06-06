import { useEffect, useMemo, useState } from 'react';
import {
  kundliService, REPORT_TYPES, rupees,
} from '@astro/shared';
import { flash } from '../lib/flash';

// Admin-side report-generation panel. Lives on /admin-user-profile.
//
// Operator picks one of the customer's kundli profiles + a report
// type from the catalogue, decides whether the wallet should be
// debited (the default for paid reports) or whether it's a
// complimentary delivery (no charge), and submits. The relay's
// existing /api/kundli action=report path runs the normal flow
// (price lookup, dispatch to AstroSeer, write the order doc) so the
// customer sees this order in /orders exactly like one they bought
// themselves.
//
// Layout is tile-based so every report type can be compared at a
// glance with its price + TAT. Free reports never offer the
// complimentary toggle (there's nothing to skip).

export default function UserGenerateReportTab({ uid, user, onCreated }) {
  const [profiles, setProfiles] = useState(null);
  const [picked, setPicked] = useState(null);  // kundli profile id
  const [kind, setKind] = useState(null);      // report type id
  const [complimentary, setComplimentary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!uid) return;
    kundliService.getKundliProfiles(uid)
      .then((list) => {
        const sorted = (list || []).slice().sort((a, b) =>
          (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
        setProfiles(sorted);
        if (sorted[0]) setPicked(sorted[0].id);
      })
      .catch(() => setProfiles([]));
  }, [uid]);

  const r = useMemo(() => REPORT_TYPES.find((x) => x.id === kind),
    [kind]);
  const isFree = r && Number(r.defaultPrice || 0) === 0;
  const wallet = Number(user?.wallet || 0);
  const willCharge = r && !isFree && !complimentary;
  const insufficient = willCharge
    && wallet < Number(r.defaultPrice || 0);

  async function submit() {
    if (!picked) { flash('Pick a kundli profile first.', 'error'); return; }
    if (!kind) { flash('Pick a report type.', 'error'); return; }
    if (insufficient) {
      const ok = window.confirm(
        `Wallet has only ${'₹'}${wallet} but this report costs `
        + `${'₹'}${r.defaultPrice}. Continue anyway? `
        + '(Customer wallet will go to 0 and the relay may refund.)');
      if (!ok) return;
    }
    if (willCharge) {
      const ok = window.confirm(
        `Generate "${r.name}" for ${user?.name || 'this customer'}`
          + ` and debit ${'₹'}${r.defaultPrice} from their wallet?`);
      if (!ok) return;
    } else if (complimentary && !isFree) {
      const ok = window.confirm(
        `Generate "${r.name}" as a COMPLIMENTARY delivery `
          + '(no wallet movement)?');
      if (!ok) return;
    }
    setBusy(true); setResult(null);
    try {
      const res = await kundliService.requestReport({
        uid,
        kundliProfileId: picked,
        kind,
        complimentary,
      });
      if (res && res.orderId) {
        setResult({ ok: true, orderId: res.orderId,
          status: res.status || 'generating' });
        if (onCreated) onCreated(res);
      } else if (res && res.error) {
        flash(res.error, 'error');
      } else {
        flash('Report request returned no order id.', 'error');
      }
    } catch (e) {
      flash((e && e.message) || 'Request failed', 'error');
    } finally { setBusy(false); }
  }

  return (
    <div className="surface mt-4 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between
        gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide
            text-sub-text">Generate report (on behalf)</h2>
          <p className="mt-0.5 text-[11px] text-sub-text">
            Trigger any kundli report for this customer. Wallet
            debit or complimentary, your call. PDF appears in their
            Orders + the AstroSeer activity feed exactly like a
            customer-initiated purchase.
          </p>
        </div>
      </div>

      {profiles && profiles.length === 0 && (
        <div className="rounded-card bg-amber-50 p-3 text-xs
          text-amber-800">
          This customer has no kundli profile saved yet. Ask them to
          create one from the app, or open Edit profile and fill DOB
          + birth time + birth place first.
        </div>
      )}

      {/* Profile picker */}
      {profiles && profiles.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-bold uppercase
            tracking-wider text-sub-text">Chart to use</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {profiles.map((p) => (
              <button key={p.id} onClick={() => setPicked(p.id)}
                className={`rounded-2xl border px-3 py-1.5 text-xs
                  font-semibold transition ${picked === p.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-200 text-sub-text '
                      + 'hover:bg-bg-light'}`}>
                {p.name || '(unnamed)'}
                {p.dob && (
                  <span className="ml-1 opacity-70">
                    · {p.dob}
                  </span>
                )}
                {p.isDefault && (
                  <span className="ml-1 rounded-full bg-primary/15
                    px-1.5 py-0.5 text-[9px] font-bold text-primary">
                    default
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Report tile grid */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_TYPES.map((rt) => {
          const price = Number(rt.defaultPrice || 0);
          const free = price === 0;
          const sel = kind === rt.id;
          return (
            <button key={rt.id}
              onClick={() => {
                setKind(rt.id);
                if (free) setComplimentary(false);
              }}
              className={`group rounded-2xl border p-3 text-left
                transition ${sel
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-gray-200 hover:border-primary/40 '
                    + 'hover:bg-bg-light/40'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-bold text-dark-text">
                  {rt.shortName || rt.name}
                </div>
                <div className={`shrink-0 rounded-full px-2 py-0.5
                  text-[10px] font-bold ${free
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-primary/10 text-primary'}`}>
                  {free ? 'Free' : rupees(price)}
                </div>
              </div>
              <div className="mt-1 text-[11px] text-sub-text
                line-clamp-2">
                {rt.summary}
              </div>
              {rt.sla && (
                <div className="mt-1 text-[10px] font-semibold
                  uppercase tracking-wider text-sub-text">
                  TAT · {rt.sla}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Charge mode + submit */}
      {kind && (
        <div className="mt-4 rounded-2xl border border-gray-200
          bg-bg-light/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label="Customer wallet" value={rupees(wallet)} />
            <Info label="Report price"
              value={isFree ? 'Free' : rupees(r.defaultPrice)} />
          </div>
          {!isFree && (
            <label className="mt-3 flex items-start gap-2 rounded-card
              bg-white p-2">
              <input type="checkbox" className="mt-0.5"
                checked={complimentary}
                onChange={(e) => setComplimentary(e.target.checked)} />
              <span className="text-xs text-dark-text">
                Mark as <b>complimentary</b> - no wallet debit. The
                customer will see the order labelled "complimentary"
                in their statement.
              </span>
            </label>
          )}
          {insufficient && (
            <div className="mt-2 rounded-card bg-rose-50 p-2 text-xs
              text-rose-700">
              Wallet has {rupees(wallet)} but this report costs{' '}
              {rupees(r.defaultPrice)}. Top up the wallet first OR
              tick complimentary.
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center
            justify-between gap-2">
            <div className="text-[11px] text-sub-text">
              {willCharge
                ? `Will debit ${rupees(r.defaultPrice)} from `
                  + `${user?.name || 'customer'}'s wallet.`
                : isFree
                  ? 'No wallet movement - this report is free.'
                  : 'Complimentary: no wallet movement.'}
            </div>
            <button onClick={submit} disabled={busy || !picked}
              className="rounded-full bg-primary px-4 py-2 text-sm
                font-bold text-white disabled:opacity-50">
              {busy ? 'Submitting...' : 'Generate report'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-card bg-emerald-50 p-3 text-sm
          text-emerald-800">
          <b>✓ Submitted.</b> Order{' '}
          <span className="font-mono">{result.orderId}</span> is{' '}
          <b>{result.status}</b>. The customer will see it in their
          Orders tab; PDF arrives once AstroSeer finishes.
        </div>
      )}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-card bg-white p-2">
      <div className="text-[9px] font-bold uppercase tracking-wider
        text-sub-text">{label}</div>
      <div className="mt-0.5 text-sm font-bold text-dark-text">
        {value}
      </div>
    </div>
  );
}
