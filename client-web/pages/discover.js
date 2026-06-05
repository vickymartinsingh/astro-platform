import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  FEATURE_GROUPS, FEATURES, featurePrice, featureById, featureStatus,
  walletService, kundliService, db,
} from '@astro/shared';
import {
  doc, getDoc, collection, addDoc, serverTimestamp,
} from 'firebase/firestore';
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
  const { user, profile, loading } = useOptionalClient();
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

  // BUY / WAITLIST: every tap on a feature CTA enters the SAME
  // visible flow - SuccessModal opens INSTANTLY in `pending` mode
  // (big spinner, distinct dark header) and holds for a 3-5s floor.
  // Then the modal flips to the appropriate terminal state:
  //   - live:        order placed, real order id from the relay
  //   - included:    free kundli (re-)generated, no double charge
  //   - coming_soon: waitlist row written to Firestore, "you're in"
  //
  // This makes the processing beat consistent across ALL 30 readings
  // so a customer never has to wonder "did my click do anything?".
  function buy(feature) {
    setError('');
    if (!user) {
      openLogin();
      return;
    }
    const status = featureStatus(feature, cfg);
    // Compute price up front. 'included' features force price=0 so
    // the customer is never double-charged for content that's
    // already inside the Free Vedic Kundli.
    const isIncluded = status === 'included';
    const price = isIncluded ? 0 : featurePrice(feature, cfg);
    // Only LIVE PAID features take a pre-flight balance check.
    // coming_soon never charges, included never charges, free
    // (price=0) features don't need a check.
    if (status === 'live' && price > 0) {
      const w = Number(wallet || 0);
      if (w < price) {
        setRecharge({ feature, need: price - w, price, walletAt: w });
        return;
      }
    }
    // Resolve which kind to ask the relay for. Coming-soon items
    // skip the relay entirely and write to /waitlist instead.
    const kind = isIncluded ? 'free' : (feature.kind || null);
    if (status === 'live' && !kind) {
      setError(`"${feature.title}" is misconfigured (no kind). Please `
        + 'report this on /support.');
      return;
    }

    // Open the modal in pending state RIGHT NOW so the user sees
    // the processing UI before any await fires. minDelay floor:
    // 3.5-5s so the pending beat is unmistakable even on a sub-second
    // relay response.
    setActiveId('');
    setDone({ feature, status, result: { pending: true } });
    const startMs = Date.now();
    const minDelayMs = 3500 + Math.floor(Math.random() * 1500);
    const settle = (fn) => {
      const elapsed = Date.now() - startMs;
      const wait = Math.max(0, minDelayMs - elapsed);
      setTimeout(fn, wait);
    };

    // Coming-soon path: write a /waitlist intent + settle to a
    // friendly "You are on the waitlist" success state. NEVER
    // charges, NEVER hits the relay.
    if (status === 'coming_soon') {
      (async () => {
        try {
          await addDoc(collection(db, 'waitlist'), {
            uid: user.uid, featureId: feature.id,
            featureTitle: feature.title,
            email: profile?.email || user.email || '',
            createdAt: serverTimestamp(),
          });
          settle(() => setDone({ feature, status,
            result: { pending: false, waitlisted: true } }));
        } catch (e) {
          settle(() => setDone({ feature, status,
            result: { pending: false,
              error: String((e && e.message) || e) } }));
        }
      })();
      return;
    }

    // Live + included path: fire the relay request in the background.
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
        settle(() => setDone({ feature, status,
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
          settle(() => setDone({ feature, status,
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

      {/* Filter row + search bar. Mobile-first: search comes FIRST so
          the user's thumb can reach it, then horizontal-scroll category
          chips below so all categories stay visible without wrapping
          to multiple rows on a narrow screen. */}
      <input className="input mb-2.5"
        placeholder="🔍 Search readings (palmistry, numerology…)"
        value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="mb-3 -mx-1 flex gap-1.5 overflow-x-auto px-1
        pb-1 [scrollbar-width:none] [-ms-overflow-style:none]
        [&amp;::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => setGroupFilter('all')}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-[11.5px]
            font-bold transition
            ${groupFilter === 'all'
              ? 'bg-[#7F2020] text-white shadow-sm'
              : 'bg-bg-light text-sub-text'}`}>
          All ({FEATURES.length})
        </button>
        {FEATURE_GROUPS.map(([g, label]) => {
          const count = FEATURES.filter((f) => f.group === g).length;
          return (
            <button key={g} type="button"
              onClick={() => setGroupFilter(g)}
              className={`shrink-0 rounded-full px-3.5 py-1.5
                text-[11.5px] font-bold transition
                ${groupFilter === g
                  ? 'bg-[#7F2020] text-white shadow-sm'
                  : 'bg-bg-light text-sub-text'}`}>
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Empty state when search/filter has no matches - so the user
          doesn't get a confusing blank grid. */}
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed
          border-gray-300 bg-white p-6 text-center text-sm
          text-sub-text">
          <div className="mb-1 text-2xl">🔍</div>
          <div className="font-bold text-dark-text">
            No readings match that
          </div>
          <div className="mt-1 text-xs">
            Try a different word, or pick "All" above.
          </div>
        </div>
      )}
      {filtered.length > 0 && (search || groupFilter !== 'all') && (
        <div className="mb-2 text-[11px] font-semibold text-sub-text">
          Showing {filtered.length} of {FEATURES.length} readings
        </div>
      )}
      {/* Tile grid - mobile-first dashboard. Each tile is a tap target
          at least 88px tall, with a Royal-palette gradient icon badge,
          a bold title, a one-line blurb, and a price chip. Two columns
          on phone, three on small tablet, four on desktop. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3
        md:grid-cols-4">
        {filtered.map((f) => {
          const status = featureStatus(f, cfg);
          const price = status === 'included' ? 0
            : featurePrice(f, cfg);
          const isFree = price <= 0;
          const comingSoon = status === 'coming_soon';
          const included = status === 'included';
          return (
            <button key={f.id} type="button"
              onClick={() => setActiveId(f.id)}
              className={`group relative flex flex-col items-start
                gap-1.5 overflow-hidden rounded-2xl border
                border-gray-200 bg-white p-3 text-left shadow-sm
                transition active:scale-[0.98] hover:border-[#7F2020]
                hover:shadow-md ${comingSoon ? 'opacity-75' : ''}`}>
              <span className={`grid h-12 w-12 place-items-center
                rounded-xl text-[22px] text-white shadow-sm
                ${comingSoon
                  ? 'bg-gradient-to-br from-gray-400 to-gray-500'
                  : 'bg-gradient-to-br from-[#7F2020] to-[#D4A12A]'}`}>
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
              {/* Status chip. Tiers the messaging so the customer
                  never confuses a coming-soon item with a paid one.
                  - coming_soon: "Coming soon" pill, no price shown
                  - included: "Included in Free Kundli", no charge
                  - live free: "Free" pill
                  - live paid: "₹N" pill */}
              <span className={`mt-auto rounded-full px-2 py-0.5
                text-[10.5px] font-bold ${
                  comingSoon ? 'bg-gray-100 text-gray-600'
                  : included ? 'bg-amber-100 text-amber-800'
                  : isFree ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-[#FBF7EE] text-[#7F2020]'}`}>
                {comingSoon ? 'Coming soon'
                  : included ? 'In Free Kundli'
                  : isFree ? 'Free' : `₹${price}`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Detail page - opens IN-APP (no new tab) so the customer
          stays in the wallet/auth context. */}
      {active && (
        <FeatureDetail f={active}
          price={featureStatus(active, cfg) === 'included' ? 0
            : featurePrice(active, cfg)}
          status={featureStatus(active, cfg)}
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
          status={done.status}
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

function FeatureDetail({ f, price, status, wallet, busy, onClose, onBuy }) {
  const w = Number(wallet || 0);
  const enough = price === 0 || w >= price;
  const comingSoon = status === 'coming_soon';
  const included = status === 'included';
  // CTA copy and tone change per status so the customer is never
  // misled by a generic "Generate report" button.
  const ctaLabel = comingSoon ? 'Notify me when this goes live'
    : included ? 'Generate your Free Vedic Kundli'
    : (price > 0 ? `Get this report for ₹${price}` : 'Generate report');
  return (
    <div className="fixed inset-0 z-[60] flex items-end
      justify-center bg-black/40 px-3 py-4 sm:items-center"
      role="dialog" aria-modal="true"
      style={{
        // Android 16's gesture nav reserves a chunk of the bottom
        // edge - inset the dialog by that amount so the CTA never
        // sits under the system bar. env(safe-area-inset-bottom) is
        // 0 on systems without one, so it has no effect on desktop.
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
      }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl
        bg-white shadow-xl">
        <div className={`p-5 text-white ${comingSoon
          ? 'bg-gradient-to-br from-gray-500 to-gray-600'
          : 'bg-gradient-to-br from-primary to-accent'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider
              opacity-80">{f.group}</span>
            <button type="button" onClick={onClose}
              className="rounded-full px-2 text-lg">×</button>
          </div>
          <h2 className="mt-1 text-xl font-bold">{f.title}</h2>
          <p className="mt-1 text-sm opacity-90">{f.blurb}</p>
          {/* Status badge under the title - so the customer knows
              EXACTLY what they're about to buy / get before they
              tap the CTA. */}
          <div className="mt-2 inline-flex items-center gap-1
            rounded-full bg-white/15 px-2.5 py-1 text-[10.5px]
            font-bold backdrop-blur-sm">
            {comingSoon ? 'Coming soon - no charge yet'
              : included ? 'Already included in your Free Vedic Kundli'
              : 'Live - generated by AstroSeer'}
          </div>
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
          {/* Status-specific guidance block. For 'included' we point
              the customer at the kundli section that already has
              this content; for 'coming_soon' we set expectations so
              they know it isn't a charge they missed. */}
          {included && f.includedSection && (
            <div className="mt-4 rounded-card bg-amber-50 px-3 py-2.5
              text-[12px] leading-snug text-amber-800">
              <b>This content lives inside your Free Vedic Kundli</b> on
              the page covering <i>{f.includedSection}</i>. Tap the
              button below to generate (or re-download) that PDF -
              no separate charge.
            </div>
          )}
          {comingSoon && (
            <div className="mt-4 rounded-card bg-gray-50 px-3 py-2.5
              text-[12px] leading-snug text-sub-text">
              Generating endpoint is not live yet. We will not charge
              you for this reading until it ships. Save your kundli
              profile and you will be the first to know.
            </div>
          )}
          {!comingSoon && (
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
                  &#8377;{w.toFixed(0)}
                </div>
              </div>
            </div>
          )}
          <button type="button" onClick={onBuy} disabled={busy}
            className={`mt-4 w-full rounded-full px-4 py-3 text-sm
              font-bold text-white disabled:opacity-50 ${comingSoon
              ? 'bg-gray-500 hover:bg-gray-600'
              : 'bg-primary hover:bg-primary/90'}`}>
            {busy ? 'Processing…' : ctaLabel}
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
      justify-center bg-black/50 px-4" role="dialog" aria-modal="true"
      style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
      }}>
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
// Three terminal states this modal renders, plus the pending state
// in between:
//   - pending: BIG spinner + dark navy header + "Processing your
//              order" - visually unmistakable so the customer knows
//              their click registered, never a flicker. Held for a
//              3.5-5s floor so it feels like real work.
//   - ready (cached): the PDF was already in the relay cache, show
//              the Download CTA + "saved to My Orders".
//   - placed (live/included, async): order id assigned, generation
//              running in background, SLA copy.
//   - waitlisted (coming_soon): we wrote the user to the waitlist,
//              they get a "We will email you when it goes live"
//              confirmation. Never charged.
//   - error: red header + reason + "wallet not charged".
function SuccessModal({ result, feature, status, onClose }) {
  const cached = !!(result && result.pdfUrl);
  const pending = !!(result && result.pending);
  const isError = !!(result && result.error);
  const waitlisted = !!(result && result.waitlisted);
  // Note: 'status' is accepted for future per-status copy hooks (e.g.
  // different SLA banner for 'included'), currently used implicitly
  // via the waitlisted/cached/error flags from `result`.
  void status;
  const SLA_BY_FEATURE = {
    kundli_basic: '30 minutes to 4 hours',
    kundli_lagna: '30 minutes to 4 hours',
    moon_nakshatra: '30 minutes to 4 hours',
    dasha_drilldown: '30 minutes to 4 hours',
    d9_navamsa: '30 minutes to 4 hours',
    d10_dasamsa: '30 minutes to 4 hours',
    divisional_all: '30 minutes to 4 hours',
    yogas_doshas: '30 minutes to 4 hours',
    panchang_birth: '30 minutes to 4 hours',
    '12_month_forecast': '2 to 6 hours',
    career_finance: '6 to 12 hours',
    lifetime_report: '12 to 24 hours',
  };
  const sla = SLA_BY_FEATURE[feature.id] || '30 minutes to 4 hours';

  // Header copy + colour depend on which state we are in.
  let headerLabel; let headerTitle; let headerGradient;
  if (isError) {
    headerLabel = 'Order could not be placed';
    headerTitle = `We could not place your ${feature.title} order`;
    headerGradient = 'linear-gradient(135deg, #C0392B 0%, #7F2020 100%)';
  } else if (pending) {
    headerLabel = 'Processing your order';
    headerTitle = `Placing your ${feature.title}...`;
    // Dark navy gradient - clearly distinct from the amber/maroon
    // success gradient so the user never confuses "processing"
    // with "placed".
    headerGradient = 'linear-gradient(135deg, #1F2A44 0%, '
      + '#0F1626 100%)';
  } else if (waitlisted) {
    headerLabel = 'You are on the waitlist';
    headerTitle = `${feature.title} - we will email you when it goes live`;
    headerGradient = 'linear-gradient(135deg, #5A6E32 0%, #3F4E22 100%)';
  } else if (cached) {
    headerLabel = 'Report ready';
    headerTitle = `${feature.title} is ready`;
    headerGradient = 'linear-gradient(135deg, #D4A12A 0%, #B45309 50%, '
      + '#7F2020 100%)';
  } else {
    headerLabel = 'Order placed';
    headerTitle = `Thank you, your ${feature.title} is on its way`;
    headerGradient = 'linear-gradient(135deg, #D4A12A 0%, #B45309 50%, '
      + '#7F2020 100%)';
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center
      justify-center bg-black/55 px-4" role="dialog" aria-modal="true"
      style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
      }}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl
        bg-white shadow-xl">
        <div className="relative px-5 py-5 text-white"
          style={{ background: headerGradient }}>
          <div className="text-[11px] font-bold uppercase
            tracking-wide opacity-90">{headerLabel}</div>
          {/* Pending header carries a BIG spinner next to the title
              so there is zero doubt that work is in progress. The
              spinner uses pure CSS so it animates even when JS is
              under load. */}
          {pending ? (
            <div className="mt-1 flex items-center gap-3">
              <Spinner />
              <div className="min-w-0 flex-1 text-base font-bold">
                {headerTitle}
              </div>
            </div>
          ) : (
            <div className="mt-0.5 text-base font-bold">
              {headerTitle}
            </div>
          )}
        </div>
        <div className="px-5 py-4">
          {pending && (
            <>
              <div className="rounded-card bg-bg-light px-3 py-3
                text-[12px] leading-snug text-sub-text">
                <b className="text-dark-text">Confirming with our
                system.</b> This usually takes a few seconds. Please
                do not close this window.
              </div>
              {/* Tiny progress steps so the customer sees the order
                  going through three beats - feels like real work
                  instead of an idle wait. */}
              <ProgressSteps />
            </>
          )}

          {waitlisted && (
            <div className="rounded-card bg-emerald-50 px-3 py-3
              text-[13px] leading-snug text-emerald-800">
              <b>You are on the waitlist for {feature.title}.</b>
              {' '}We will email you the moment it goes live. Until
              then your wallet is untouched. You can keep browsing
              the other readings.
            </div>
          )}

          {isError && (
            <div className="rounded-card bg-danger/10 p-3
              text-[12px] text-danger">
              <div className="font-bold">What went wrong</div>
              <div className="mt-1 break-all">{result.error}</div>
              <p className="mt-2 text-[11px]">
                Your wallet was not charged. Try again in a moment or
                contact support if the problem persists.
              </p>
            </div>
          )}

          {!pending && !waitlisted && !isError && cached && (
            <p className="text-[13px] text-dark-text">
              Your report is saved to <b>My Orders</b>. We have also
              emailed you a copy.
            </p>
          )}

          {!pending && !waitlisted && !isError && !cached && (
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
                You can close this window. We will email you the
                moment the PDF is ready, and the download link lives
                permanently in My Orders.
              </p>
              {result && result.orderId && (
                <div className="mt-3 rounded-card bg-bg-light px-3
                  py-2 text-[11px]">
                  <div className="text-sub-text">Order ID</div>
                  <div className="mt-0.5 font-mono break-all
                    text-dark-text">{result.orderId}</div>
                </div>
              )}
            </>
          )}

          {cached && !isError && !pending && (
            <a href={result.pdfUrl} target="_blank" rel="noreferrer"
              className="btn-primary mt-4 block text-center">
              Download PDF
            </a>
          )}

          {/* CTAs. Hide while pending so the customer cannot
              accidentally close the modal before the order id
              arrives. */}
          {!pending && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(waitlisted || (!isError && !cached)) && (
                <Link href="/orders" onClick={onClose}
                  className="rounded-full bg-primary px-3 py-2
                    text-center text-sm font-bold text-white">
                  {waitlisted ? 'See my orders' : 'Open My Orders'}
                </Link>
              )}
              <button type="button" onClick={onClose}
                className={`rounded-full border border-gray-300
                  bg-white px-3 py-2 text-sm font-bold text-dark-text
                  ${(isError || (cached && !waitlisted))
                    ? 'col-span-2' : ''}`}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Big spinner for the pending header. Two arc segments rotating in
// opposite directions for a more "live" feel than a single arc.
function Spinner() {
  return (
    <span className="relative inline-grid h-10 w-10 shrink-0
      place-items-center">
      <svg viewBox="0 0 50 50" className="h-10 w-10 animate-spin"
        style={{ animationDuration: '1.1s' }}>
        <circle cx="25" cy="25" r="20" fill="none"
          stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
        <path d="M45 25a20 20 0 0 0-20-20" fill="none"
          stroke="currentColor" strokeWidth="4"
          strokeLinecap="round" />
      </svg>
    </span>
  );
}

// Three-step progress strip rendered under the pending body. Each
// step has its own staggered fade animation so the eye sees motion
// even when the relay request hasn't returned yet.
function ProgressSteps() {
  const steps = ['Checking wallet', 'Confirming with our system',
    'Reserving order ID'];
  return (
    <ol className="mt-3 space-y-1.5">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2 text-[11px]
          font-semibold text-dark-text">
          <span className="grid h-5 w-5 shrink-0 place-items-center
            rounded-full bg-primary/10 text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full
              bg-primary"
              style={{ animationDelay: `${i * 280}ms` }} />
          </span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}
