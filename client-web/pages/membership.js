import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { membershipService } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import { useOptionalClient } from '../lib/useAuth';
import { useAuthModal } from '../lib/authModal';
import { confirmModal } from '../components/ConfirmModal';

// /membership
//
// Customer-facing membership page. Shows all available tiers as cards,
// the user's current plan (if any), and an FAQ accordion. Guests can
// browse freely; subscribe CTA opens the auth modal when not signed in.
// Subscribing deducts from the wallet atomically via membershipService.

export default function Membership() {
  const { user, profile, loading: authLoading } = useOptionalClient();
  const { openLogin } = useAuthModal();
  const router = useRouter();

  const [cfg, setCfg] = useState(null);
  const [membership, setMembership] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, t }
  const [faqOpen, setFaqOpen] = useState({}); // { [index]: true }

  // Load config (tiers + FAQ + enabled flag).
  useEffect(() => {
    membershipService.getMembershipConfig()
      .then(setCfg)
      .catch(() => setCfg({ enabled: false, tiers: [], faq: [] }));
  }, []);

  // Load user membership when signed in.
  useEffect(() => {
    if (!user) { setMembership(null); return; }
    membershipService.getUserMembership(user.uid)
      .then(setMembership)
      .catch(() => setMembership(null));
  }, [user]);

  // Reload membership after a successful subscribe/cancel.
  async function refreshMembership() {
    if (!user) return;
    try {
      const m = await membershipService.getUserMembership(user.uid);
      setMembership(m);
    } catch (_) {}
  }

  async function handleSubscribe(tier) {
    if (!user) {
      openLogin(() => {
        // After login, the page re-renders and user can tap again.
      });
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      const res = await membershipService.subscribeMembership(
        user.uid, tier.id);
      if (res.success) {
        setMsg({ ok: true,
          t: `You are now on the ${tier.name} plan!` });
        await refreshMembership();
      } else {
        // If insufficient balance, offer to recharge.
        if (res.error && res.error.toLowerCase().includes('insufficient')) {
          setMsg({ ok: false,
            t: `${res.error} Top up your wallet to subscribe.`,
            showWallet: true });
        } else {
          setMsg({ ok: false, t: res.error || 'Could not subscribe.' });
        }
      }
    } catch (e) {
      setMsg({ ok: false, t: e?.message || 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!user) return;
    const ok = await confirmModal({
      title: 'Cancel membership?',
      message: 'You will be moved to the free Basic plan. '
        + 'Any remaining benefits will be lost.',
      yes: 'Cancel membership', no: 'Keep plan', danger: true,
    });
    if (!ok) return;
    setMsg(null);
    setBusy(true);
    try {
      await membershipService.cancelMembership(user.uid);
      setMsg({ ok: true, t: 'Membership cancelled. You are on the Basic plan.' });
      await refreshMembership();
    } catch (e) {
      setMsg({ ok: false, t: e?.message || 'Could not cancel.' });
    } finally {
      setBusy(false);
    }
  }

  // Loading state.
  if (authLoading || !cfg) {
    return <Layout><SkeletonList /></Layout>;
  }

  // Membership disabled by admin.
  if (!cfg.enabled) {
    return (
      <Layout>
        <div className="card p-6 text-center">
          <div className="text-lg font-bold text-dark-text">
            Membership is currently unavailable
          </div>
          <p className="mt-2 text-sm text-sub-text">
            Please check back later.
          </p>
        </div>
      </Layout>
    );
  }

  const tiers = (cfg.tiers || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const faq = cfg.faq || [];
  const currentTierId = membership?.tierId || 'basic';
  const currentTier = tiers.find((t) => t.id === currentTierId) || null;
  const currentOrder = currentTier ? (currentTier.order || 0) : -1;

  // Format expiry date.
  function fmtDate(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }

  // CTA label logic.
  function ctaLabel(tier) {
    if (currentTierId === tier.id) return 'Current plan';
    const tierOrder = tier.order || 0;
    if (tierOrder > currentOrder) return 'Upgrade';
    if (tierOrder < currentOrder) return 'Downgrade';
    return 'Subscribe';
  }

  return (
    <Layout>
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-dark-text"
          style={{ color: '#7F2020' }}>
          AstroSeer Membership
        </h1>
        <p className="mt-1 text-sm text-sub-text">
          Unlock premium benefits
        </p>
      </div>

      {/* Flash message */}
      {msg && (
        <div className={`mt-3 rounded-card p-3 text-sm ${msg.ok
          ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
          {msg.ok ? '✅ ' : ''}{msg.t}
          {msg.showWallet && (
            <button onClick={() => router.push('/wallet')}
              className="mt-2 block w-full rounded-card bg-primary
                py-2 text-sm font-semibold text-white">
              Go to Wallet
            </button>
          )}
        </div>
      )}

      {/* Current Plan Banner (logged in + has a paid membership) */}
      {user && membership && currentTier && currentTierId !== 'basic' && (
        <div className="card mt-3 p-4" style={{
          borderTop: `3px solid ${currentTier.color || '#D4A12A'}`,
        }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{currentTier.icon || '⭐'}</span>
              <div>
                <div className="text-base font-bold text-dark-text">
                  {currentTier.name} Plan
                </div>
                {membership.expiresAt && (
                  <div className="text-[11px] text-sub-text">
                    Expires {fmtDate(membership.expiresAt)}
                  </div>
                )}
              </div>
            </div>
            <button onClick={handleCancel} disabled={busy}
              className="rounded-full border border-danger px-3 py-1
                text-xs font-bold text-danger hover:bg-danger/5
                disabled:opacity-50">
              Cancel
            </button>
          </div>
          {/* Call minutes usage */}
          {(currentTier.benefits?.callMinutes || 0) > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px]
                text-sub-text">
                <span>Call minutes used</span>
                <span className="font-bold text-dark-text">
                  {membership.callMinutesUsed || 0}
                  {' / '}
                  {currentTier.benefits.callMinutes} min
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full
                bg-gray-100">
                <div className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, ((membership.callMinutesUsed || 0)
                      / currentTier.benefits.callMinutes) * 100)}%`,
                    backgroundColor: currentTier.color || '#D4A12A',
                  }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tier Cards */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiers.map((tier) => {
          const isActive = currentTierId === tier.id;
          const isFree = !tier.price || tier.price === 0;
          const label = ctaLabel(tier);
          const b = tier.benefits || {};

          return (
            <div key={tier.id}
              className={`card relative overflow-hidden p-0 transition ${
                isActive
                  ? 'ring-2 ring-offset-1'
                  : ''}`}
              style={{
                borderTop: `4px solid ${tier.color || '#7F2020'}`,
                ...(isActive
                  ? { '--tw-ring-color': tier.color || '#D4A12A' }
                  : {}),
              }}>
              {/* Active badge */}
              {isActive && (
                <div className="absolute right-2 top-2 rounded-full px-2
                  py-0.5 text-[10px] font-bold text-white"
                  style={{ backgroundColor: tier.color || '#D4A12A' }}>
                  Active
                </div>
              )}

              <div className="px-4 pb-4 pt-4">
                {/* Icon + Name */}
                <div className="text-center">
                  <span className="text-3xl">{tier.icon || '⭐'}</span>
                  <h3 className="mt-1 text-lg font-bold text-dark-text">
                    {tier.name}
                  </h3>
                  <div className="mt-0.5 text-base font-bold"
                    style={{ color: tier.color || '#7F2020' }}>
                    {isFree ? 'Free' : `Rs ${tier.price}/month`}
                  </div>
                </div>

                {/* Benefits checklist */}
                <ul className="mt-3 space-y-1.5">
                  {b.callMinutes > 0 && (
                    <BenefitItem text={`${b.callMinutes} free call minutes/month`} />
                  )}
                  {b.callRateCap > 0 && (
                    <BenefitItem text={`Call rate capped at Rs ${b.callRateCap}/min`} />
                  )}
                  {b.discountPercent > 0 && (
                    <BenefitItem text={`${b.discountPercent}% discount on services`} />
                  )}
                  {b.freeReports && b.freeReports.length > 0 && (
                    <BenefitItem text={`${b.freeReports.length} free report${
                      b.freeReports.length > 1 ? 's' : ''}/month`} />
                  )}
                  {b.prioritySupport && (
                    <BenefitItem text="Priority support" />
                  )}
                  {Array.isArray(b.customBenefits) && b.customBenefits.map(
                    (cb, i) => (
                      <BenefitItem key={i}
                        text={cb.label || cb.description || cb} />
                    ),
                  )}
                  {/* If no benefits at all, show a basic line */}
                  {!b.callMinutes && !b.discountPercent
                    && !(b.freeReports && b.freeReports.length)
                    && !b.prioritySupport
                    && !(b.customBenefits && b.customBenefits.length) && (
                    <BenefitItem text="Access to all free features" />
                  )}
                </ul>

                {/* CTA Button */}
                <button
                  onClick={() => {
                    if (isActive) return;
                    handleSubscribe(tier);
                  }}
                  disabled={busy || isActive}
                  className={`mt-4 w-full rounded-full py-2.5 text-sm
                    font-bold transition disabled:opacity-50 ${
                    isActive
                      ? 'border border-gray-300 bg-white text-sub-text cursor-default'
                      : 'text-white'}`}
                  style={!isActive ? {
                    backgroundColor: tier.color || '#7F2020',
                  } : undefined}>
                  {busy && !isActive ? 'Processing...' : label}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* FAQ Section */}
      {faq.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-bold text-dark-text"
            style={{ color: '#7F2020' }}>
            Frequently Asked Questions
          </h2>
          <div className="mt-3 space-y-2">
            {faq.map((item, idx) => (
              <div key={idx} className="card overflow-hidden p-0">
                <button
                  onClick={() => setFaqOpen((prev) => ({
                    ...prev, [idx]: !prev[idx],
                  }))}
                  className="flex w-full items-center justify-between
                    px-4 py-3 text-left hover:bg-bg-light">
                  <span className="text-sm font-semibold text-dark-text">
                    {item.q}
                  </span>
                  <span className={`ml-2 shrink-0 text-sub-text
                    transition-transform ${
                    faqOpen[idx] ? 'rotate-90' : ''}`}>
                    ›
                  </span>
                </button>
                {faqOpen[idx] && (
                  <div className="border-t border-gray-100 bg-bg-light/40
                    px-4 py-3 text-sm text-sub-text">
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom spacer for mobile bottom nav */}
      <div className="h-4" />
    </Layout>
  );
}

// Checkmark benefit list item.
function BenefitItem({ text }) {
  return (
    <li className="flex items-start gap-2 text-[13px] text-dark-text">
      <span className="mt-0.5 shrink-0 text-xs" style={{ color: '#D4A12A' }}>
        &#10003;
      </span>
      <span>{text}</span>
    </li>
  );
}
