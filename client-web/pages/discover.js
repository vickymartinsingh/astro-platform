import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  FEATURE_GROUPS, FEATURES, featurePrice, featureById,
  walletService, kundliService, db,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useOptionalClient } from '../lib/useAuth';
import { useAuthModal } from '../lib/authModal';

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
  // Discover is a public browse page (like Horoscope / Astrologers):
  // guests can read every feature card and tap into the detail panel.
  // The "Get this report" CTA inside a feature checks for auth at the
  // moment of purchase and pops the login modal then.
  const { user, loading } = useOptionalClient();
  const { openLogin } = useAuthModal();
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
    // Cached read (10 min TTL in localStorage) - drops 2 reads
    // per /discover mount.
    kundliService.readSettingsConfig().then(setCfg).catch(() => {});
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
  // OPTIMISTIC UI: SuccessModal opens INSTANTLY when customer
  // clicks Buy on a feature card. The relay request fires in the
  // background and the modal flips to the real Order ID (or an
  // error state) when the relay returns. No more "Processing..."
  // wait on the FeatureDetail card.
  function buy(feature) {
    setError('');
    // Guests can browse Discover; the moment they tap Get this
    // report we pop the login modal so they sign in first.
    if (!user) {
      openLogin();
      return;
    }
    const price = featurePrice(feature, cfg);
    if (price > 0) {
      const w = Number(wallet || 0);
      if (w < price) {
        setRecharge({ feature, need: price - w, price, walletAt: w });
        return;
      }
    }
    const KUNDLI_KIND_MAP = {
      kundli_basic: 'free',
      kundli_lagna: 'free',
      '12_month_forecast': 'forecast12',
      career_finance: 'careerFinance',
      lifetime_report: 'lifetime',
    };
    const kind = KUNDLI_KIND_MAP[feature.id];
    if (!kind) {
      setError(`"${feature.title}" is not yet wired up to the API. `
        + 'Our team is building it; please check back shortly.');
      return;
    }
    // Step 1: open the SuccessModal IMMEDIATELY in pending state
    // and close the FeatureDetail card. 1.5-2.8s minimum-display
    // floor so the pending beat always feels like real processing
    // instead of a flicker - even on a sub-second relay round trip.
    setActiveId('');
    setDone({ feature, result: { pending: true } });
    const startMs = Date.now();
    const minDelayMs = 3000 + Math.floor(Math.random() * 1000);
    const settle = (fn) => {
      const elapsed = Date.now() - startMs;
      const wait = Math.max(0, minDelayMs - elapsed);
      setTimeout(fn, wait);
    };
    // Step 2: fire the relay request in the background. No await.
    (async () => {
      try {
        const profiles = await kundliService
          .getKundliProfiles(user.uid).catch(() => []);
        const def = profiles.find((p) => p.isDefault) || profiles[0];
        if (!def) {
          settle(() => { setDone(null);
            setError('Save a kundli profile first under the Kundli '
              + 'tab.'); });
          return;
        }
        const result = await kundliService.requestReport({
          uid: user.uid, kundliProfileId: def.id, kind,
        });
        // Update the modal with the real result after the floor.
        settle(() => setDone({ feature,
          result: { ...result, pending: false } }));
      } catch (e) {
        const msg = e && e.message ? e.message : 'Could not process.';
        if (/insufficient/i.test(msg) || (e && e.code
          === 'insufficient_wallet')) {
          settle(() => { setDone(null);
            setRecharge({ feature, need: featurePrice(feature, cfg),
              price: featurePrice(feature, cfg),
              walletAt: Number(wallet || 0) }); });
        } else {
          settle(() => setDone({ feature,
            result: { pending: false, error: msg } }));
        }
      }
    })();
  }

  if (loading) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      {/* Hero header. Royal palette gradient + counter chips so the
          first-time customer sees at a glance: what this page is, how
          many features live here, and what each group covers. Mobile-
          first: scales down to a single column on small screens; the
          counter row wraps onto two lines instead of overflowing. */}
      <div className="mb-3 overflow-hidden rounded-2xl
        bg-gradient-to-br from-[#7F2020] to-[#D4A12A] p-4 text-white
        shadow-md">
        <div className="text-[11px] font-bold uppercase tracking-widest
          opacity-90">
          AstroSeer Library
        </div>
        <h1 className="mt-1 text-2xl font-bold leading-tight">
          Discover
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed opacity-95">
          Every Vedic reading we offer in one place. Tap any tile to see
          what is inside, the price, and to download a personal report.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-white/15 px-2.5 py-1
            text-[10.5px] font-bold backdrop-blur-sm">
            {FEATURES.length} readings
          </span>
          <span className="rounded-full bg-white/15 px-2.5 py-1
            text-[10.5px] font-bold backdrop-blur-sm">
            {FEATURE_GROUPS.length} categories
          </span>
          <span className="rounded-full bg-white/15 px-2.5 py-1
            text-[10.5px] font-bold backdrop-blur-sm">
            Instant PDF
          </span>
        </div>
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

      {/* Tile grid - mobile-first dashboard. Each tile is a tap target
          at least 88px tall, with a Royal-palette gradient icon badge,
          a bold title, a one-line blurb, and a price chip. Two columns
          on phone, three on small tablet, four on desktop. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3
        md:grid-cols-4">
        {filtered.map((f) => {
          const price = featurePrice(f, cfg);
          const isFree = price <= 0;
          return (
            <button key={f.id} type="button"
              onClick={() => setActiveId(f.id)}
              className="group relative flex flex-col items-start
                gap-1.5 overflow-hidden rounded-2xl border
                border-gray-200 bg-white p-3 text-left shadow-sm
                transition active:scale-[0.98] hover:border-[#7F2020]
                hover:shadow-md">
              {/* Royal palette icon badge: maroon -> amber gradient.
                  Bigger than the old 40px circle so it reads as a real
                  icon on mobile. */}
              <span className="grid h-12 w-12 place-items-center
                rounded-xl bg-gradient-to-br from-[#7F2020]
                to-[#D4A12A] text-[22px] text-white shadow-sm">
                {ICON[f.icon] || '·'}
              </span>
              <div className="text-[13px] font-bold leading-tight
                text-dark-text line-clamp-2">
                {f.title}
              </div>
              <div className="text-[11px] leading-snug text-sub-text
                line-clamp-2">
                {f.blurb}
              </div>
              {/* Price chip in the bottom-right - so the user sees what
                  it costs without opening the detail panel. */}
              <span className={`mt-auto rounded-full px-2 py-0.5
                text-[10.5px] font-bold
                ${isFree
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-[#FBF7EE] text-[#7F2020]'}`}>
                {isFree ? 'Free' : `₹${price}`}
              </span>
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

// Two states this modal can show:
//   - PDF already ready (cache hit on the relay): show the
//     Download CTA + "saved to My Orders".
//   - Order placed, generating in background (the common case
//     after our 2026-05-28 fire-and-forget rewrite): show the
//     expected delivery SLA and direct the customer to My Orders
//     to track + download once ready. Email also goes
//     automatically when ready.
function SuccessModal({ result, feature, onClose }) {
  const cached = !!(result && result.pdfUrl);
  const pending = !!(result && result.pending);
  const isError = !!(result && result.error);
  // Per-kind delivery SLA copy. Maps the catalogue's `sla` field
  // through, with sensible defaults for non-kundli features that
  // route through other AstroSeer endpoints.
  const SLA_BY_FEATURE = {
    kundli_basic: '30 minutes to 4 hours',
    kundli_lagna: '30 minutes to 4 hours',
    '12_month_forecast': '2 to 6 hours',
    career_finance: '6 to 12 hours',
    lifetime_report: '12 to 24 hours',
  };
  const sla = SLA_BY_FEATURE[feature.id] || '30 minutes to 4 hours';
  // Header copy depends on which state we are in:
  //   pending - relay still kicking off, optimistic copy.
  //   isError - relay returned an error, red header.
  //   cached  - cache hit, PDF available immediately.
  //   else    - order placed, async generation in flight.
  const headerLabel = isError ? 'Order could not be placed'
    : pending ? 'Placing order'
      : cached ? 'Report ready'
        : 'Order placed';
  const headerTitle = isError
    ? `We could not place your ${feature.title} order`
    : cached ? `${feature.title} is ready`
      : `Thank you, your ${feature.title} is on its way`;
  const headerGradient = isError
    ? 'linear-gradient(135deg, #C0392B 0%, #7F2020 100%)'
    : 'linear-gradient(135deg, #D4A12A 0%, #B45309 50%, #7F2020 100%)';
  return (
    <div className="fixed inset-0 z-[70] flex items-center
      justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl
        bg-white shadow-xl">
        {/* Gradient header */}
        <div className="px-5 py-4 text-white"
          style={{ background: headerGradient }}>
          <div className="text-[11px] font-bold uppercase
            tracking-wide opacity-90">{headerLabel}</div>
          <div className="mt-0.5 text-base font-bold">{headerTitle}</div>
        </div>
        <div className="px-5 py-4">
          {isError && (
            <div className="rounded-card bg-danger/10 p-3
              text-[12px] text-danger">
              <div className="font-bold">What went wrong</div>
              <div className="mt-1 break-all">{result.error}</div>
              <p className="mt-2 text-[11px]">
                Your wallet was not charged. Try again in a moment
                or contact support if the problem persists.
              </p>
            </div>
          )}
          {!isError && cached && (
            <p className="text-[13px] text-dark-text">
              Your report is saved to <b>My Orders</b>. We have also
              emailed you a copy.
            </p>
          )}
          {!isError && !cached && (
            <>
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0
                  place-items-center rounded-full bg-primary/10
                  text-primary">
                  <svg viewBox="0 0 24 24" className="h-5 w-5"
                    fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </span>
                <div>
                  <div className="text-[10px] font-bold uppercase
                    tracking-wide text-sub-text">
                    Expected delivery
                  </div>
                  <div className="text-sm font-bold text-dark-text">
                    {sla}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[12px] leading-snug
                text-sub-text">
                {pending
                  ? 'Confirming with our system... your order will '
                    + 'be ready shortly. You can close this window '
                    + 'now and check My Orders at any time.'
                  : 'You can close this window. We will email you '
                    + 'the moment the PDF is ready, and the '
                    + 'download link lives permanently in '}
                {!pending && <b>My Orders</b>}{!pending && '.'}
              </p>
              {result && result.orderId ? (
                <div className="mt-3 rounded-card bg-bg-light px-3
                  py-2 text-[11px]">
                  <div className="text-sub-text">Order ID</div>
                  <div className="mt-0.5 font-mono break-all
                    text-dark-text">{result.orderId}</div>
                </div>
              ) : pending && (
                <div className="mt-3 rounded-card bg-bg-light px-3
                  py-2 text-[11px] text-sub-text">
                  Order ID will appear here once the system
                  confirms your purchase.
                </div>
              )}
            </>
          )}
          {cached && !isError && (
            <a href={result.pdfUrl} target="_blank" rel="noreferrer"
              className="btn-primary mt-4 block text-center">
              Download PDF
            </a>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {!isError && (
              <Link href="/orders" onClick={onClose}
                className="rounded-full bg-primary px-3 py-2
                  text-center text-sm font-bold text-white">
                Open My Orders
              </Link>
            )}
            <button type="button" onClick={onClose}
              className={`rounded-full border border-gray-300
                bg-white px-3 py-2 text-sm font-bold text-dark-text
                ${isError ? 'col-span-2' : ''}`}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
