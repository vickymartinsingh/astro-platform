import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  FEATURE_GROUPS, FEATURES, featurePrice, featureById,
  walletService, kundliService, db,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireClient } from '../lib/useAuth';

// Discover page - every AstroSeer-API-backed reading rendered as a
// monochrome icon card. Click → detail panel with the sections,
// price and a "Get this report" button. Before charging we run a
// pre-flight wallet check; insufficient balance pops a recharge
// modal with an inline "Add to wallet" CTA + a "Later" dismiss.

const ICON = {
  om: 'ॐ', star: '✶', moon: '☾', sun: '☀',
  clock: '◷', rings: '⚭', briefcase: '▢',
  grid: '⊞', compass: '⌖', thunder: '⚡',
  calendar: '▦', dragon: '⌬', face: '⏥', hand: '✋',
  gem: '◈', card: '⌥', numerology: '#',
  phone: '☎', letter: 'A', baby: '✿', book: '☷',
  mantra: 'ॐ', beads: '◌',
};

export default function Discover() {
  const { user, loading } = useRequireClient();
  const router = useRouter();
  const [activeId, setActiveId] = useState(
    typeof router.query.f === 'string' ? router.query.f : '');
  const [groupFilter, setGroupFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [cfg, setCfg] = useState({});
  const [wallet, setWallet] = useState(null);
  const [busy, setBusy] = useState(false);
  // null | { feature, need } - drives the insufficient-balance modal
  const [recharge, setRecharge] = useState(null);
  // null | { feature, result } - drives the success modal
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // settings/config supplies admin price overrides for every
    // feature; we read once and merge through featurePrice().
    getDoc(doc(db, 'settings', 'config')).then((s) =>
      setCfg(s.exists() ? s.data() : {})).catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) return;
    return walletService.listenWallet(user.uid, setWallet);
  }, [user]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return FEATURES.filter((f) => {
      if (groupFilter !== 'all' && f.group !== groupFilter) return false;
      if (!term) return true;
      return f.title.toLowerCase().includes(term)
        || f.blurb.toLowerCase().includes(term);
    });
  }, [search, groupFilter]);

  const active = activeId ? featureById(activeId) : null;

  // BUY: pre-flight balance check FIRST. Never start an AstroSeer
  // round-trip if the customer can't afford it - pop the recharge
  // modal instead. (Previously the relay would generate, then 402
  // back; this wasted time + AstroSeer credits.)
  async function buy(feature) {
    setError('');
    const price = featurePrice(feature, cfg);
    if (price > 0) {
      const w = Number(wallet || 0);
      if (w < price) {
        setRecharge({ feature, need: price - w, price, walletAt: w });
        return;
      }
    }
    setBusy(true);
    try {
      // For kundli-shaped reports we route through kundliService - // it already handles the default kundli profile resolution,
      // server-side wallet deduct, PDF generation and inline order
      // record. Features that aren't yet wired up surface a friendly
      // "coming soon" message so we never silently 404.
      const KUNDLI_KIND_MAP = {
        kundli_basic: 'free',
        kundli_lagna: 'free',
        '12_month_forecast': 'forecast12',
        career_finance: 'careerFinance',
        lifetime_report: 'lifetime',
      };
      const kind = KUNDLI_KIND_MAP[feature.id];
      if (kind) {
        // Use the customer's default kundli profile (if any).
        const profiles = await kundliService
          .getKundliProfiles(user.uid).catch(() => []);
        const def = profiles.find((p) => p.isDefault) || profiles[0];
        if (!def) {
          setError('Save a kundli profile first under the Kundli tab.');
          return;
        }
        const result = await kundliService.requestReport({
          uid: user.uid, kundliProfileId: def.id, kind,
        });
        setDone({ feature, result });
      } else {
        // Catalogue item the relay doesn't expose yet - show a
        // friendly "coming soon" instead of a stack trace.
        setError(`"${feature.title}" is not yet wired up to the API. `
          + 'Our team is building it; please check back shortly.');
      }
    } catch (e) {
      const msg = e && e.message ? e.message : 'Could not process.';
      // Defensive: server-side 402 still falls through here even
      // after the pre-flight if the wallet was just spent in
      // another tab. Re-pop the recharge modal in that case.
      if (/insufficient/i.test(msg)) {
        setRecharge({ feature, need: featurePrice(feature, cfg),
          price: featurePrice(feature, cfg),
          walletAt: Number(wallet || 0) });
      } else {
        setError(msg);
      }
    } finally { setBusy(false); }
  }

  if (loading) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <div className="mb-3 flex flex-wrap items-end justify-between
        gap-2">
        <div>
          <h1 className="text-2xl font-bold">Discover</h1>
          <p className="text-xs text-sub-text">
            Every Vedic reading we offer - tap a card to see what it
            includes and the price.
          </p>
        </div>
        <Link href="/wallet"
          className="rounded-full bg-[#FFD63A] px-4 py-1.5 text-xs
            font-bold text-dark-text">
          Wallet ₹{Number(wallet || 0).toFixed(0)}
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setGroupFilter('all')}
          className={`rounded-full px-3 py-1 text-[11px] font-bold
            ${groupFilter === 'all'
              ? 'bg-primary text-white'
              : 'bg-bg-light text-sub-text'}`}>
          All
        </button>
        {FEATURE_GROUPS.map(([g, label]) => (
          <button key={g} type="button"
            onClick={() => setGroupFilter(g)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold
              ${groupFilter === g
                ? 'bg-primary text-white'
                : 'bg-bg-light text-sub-text'}`}>
            {label}
          </button>
        ))}
      </div>
      <input className="input mb-3"
        placeholder="Search readings (e.g. palmistry, numerology)…"
        value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3
        md:grid-cols-4">
        {filtered.map((f) => {
          const price = featurePrice(f, cfg);
          return (
            <button key={f.id} type="button"
              onClick={() => setActiveId(f.id)}
              className="group flex flex-col items-start gap-1
                rounded-card border border-gray-200 bg-white p-3
                text-left transition hover:border-primary
                hover:shadow-md">
              <span className="grid h-10 w-10 place-items-center
                rounded-full bg-bg-light text-xl text-primary
                group-hover:bg-primary group-hover:text-white">
                {ICON[f.icon] || '·'}
              </span>
              <div className="mt-1 text-[12px] font-bold
                text-dark-text">
                {f.title}
              </div>
              <div className="text-[10px] text-sub-text line-clamp-2">
                {f.blurb}
              </div>
              <div className="mt-auto text-[10.5px] font-bold
                text-primary">
                {price > 0 ? `₹${price}` : 'Free'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail page - opens IN-APP (no new tab) so the customer
          stays in the wallet/auth context. */}
      {active && (
        <FeatureDetail f={active}
          price={featurePrice(active, cfg)}
          wallet={wallet}
          busy={busy}
          onClose={() => setActiveId('')}
          onBuy={() => buy(active)} />
      )}
      {recharge && (
        <InsufficientBalanceModal
          feature={recharge.feature}
          need={recharge.need}
          price={recharge.price}
          walletAt={recharge.walletAt}
          onLater={() => setRecharge(null)}
          onAdd={() => {
            setRecharge(null);
            router.push(`/wallet?return=/discover?f=${
              recharge.feature.id}&amount=${recharge.need}`);
          }} />
      )}
      {done && (
        <SuccessModal result={done.result} feature={done.feature}
          onClose={() => { setDone(null); setActiveId(''); }} />
      )}
      {error && (
        <div className="card mt-3 bg-danger/10 text-sm text-danger">
          {error}
        </div>
      )}
    </Layout>
  );
}

function FeatureDetail({ f, price, wallet, busy, onClose, onBuy }) {
  const w = Number(wallet || 0);
  const enough = price === 0 || w >= price;
  return (
    <div className="fixed inset-0 z-[60] flex items-end
      justify-center bg-black/40 px-3 py-4 sm:items-center"
      role="dialog" aria-modal="true">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl
        bg-white shadow-xl">
        <div className="bg-gradient-to-br from-primary to-accent
          p-5 text-white">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider
              opacity-80">{f.group}</span>
            <button type="button" onClick={onClose}
              className="rounded-full px-2 text-lg">×</button>
          </div>
          <h2 className="mt-1 text-xl font-bold">{f.title}</h2>
          <p className="mt-1 text-sm opacity-90">{f.blurb}</p>
        </div>
        <div className="p-5">
          <div className="text-[11px] font-bold uppercase
            tracking-wider text-sub-text">What you get</div>
          <ul className="mt-2 space-y-1.5 text-[13px] text-dark-text">
            {f.sections.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-primary">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center
            justify-between gap-2 rounded-card bg-bg-light p-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide
                text-sub-text">Price</div>
              <div className="text-2xl font-bold text-primary">
                {price > 0 ? `₹${price}` : 'Free'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide
                text-sub-text">Wallet</div>
              <div className={`text-lg font-bold ${enough
                ? 'text-success' : 'text-danger'}`}>
                ₹{w.toFixed(0)}
              </div>
            </div>
          </div>
          <button type="button" onClick={onBuy} disabled={busy}
            className="btn-primary mt-4 w-full disabled:opacity-50">
            {busy ? 'Processing…'
              : price > 0 ? `Get this report for ₹${price}`
                : 'Generate report'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Insufficient-balance modal. Comes up the INSTANT we know the
// wallet can't cover the price - never after the relay round-trip.
// Inline "Add to wallet" CTA so the customer doesn't have to hunt
// for the wallet page, and an explicit "Later" so they can dismiss
// without feeling pressured.
function InsufficientBalanceModal({
  feature, need, price, walletAt, onLater, onAdd,
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center
      justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5
        shadow-xl">
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center
            rounded-full bg-warning/15 text-warning">!</span>
          <h3 className="text-base font-bold text-dark-text">
            Wallet balance is low
          </h3>
        </div>
        <p className="text-[13px] text-dark-text">
          <b>{feature.title}</b> costs <b>₹{price}</b>. Your wallet
          has <b>₹{walletAt}</b>. Add at least <b>₹{need}</b> to
          continue.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2">
          <button type="button" onClick={onAdd}
            className="btn-primary w-full">
            Add ₹{need} to wallet
          </button>
          <button type="button" onClick={onLater}
            className="rounded-full border border-gray-300 px-4
              py-2 text-sm font-bold text-sub-text">
            I&apos;ll do this later
          </button>
        </div>
      </div>
    </div>
  );
}

function SuccessModal({ result, feature, onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center
      justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5
        shadow-xl">
        <div className="mb-2 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center
            rounded-full bg-success/15 text-success">✓</span>
          <h3 className="text-base font-bold text-dark-text">
            {feature.title} is ready
          </h3>
        </div>
        <p className="text-[13px] text-dark-text">
          Your report is saved to <b>My Orders</b>. We&apos;ve also
          emailed you a copy if SMTP is configured.
        </p>
        {result && result.pdfUrl && (
          <a href={result.pdfUrl} target="_blank" rel="noreferrer"
            className="btn-primary mt-4 block text-center">
            Download PDF
          </a>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Link href="/orders" onClick={onClose}
            className="rounded-full border border-primary bg-white
              px-3 py-2 text-center text-sm font-bold text-primary">
            Open My Orders
          </Link>
          <button type="button" onClick={onClose}
            className="rounded-full bg-bg-light px-3 py-2
              text-sm font-bold text-sub-text">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
