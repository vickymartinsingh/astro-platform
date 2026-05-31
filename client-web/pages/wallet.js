import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  walletService, db, sessionService, astrologerService, rupees,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';
import { useRazorpay } from '../lib/useRazorpay';

const QUICK = [10, 50, 100, 500, 1000];
const MIN_RECHARGE = 10;

export default function Wallet() {
  const { user, profile, loading } = useRequireClient();
  const router = useRouter();
  const [wallet, setWallet] = useState(0);
  const [amount, setAmount] = useState(100);
  const [coupon, setCoupon] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  // null = nothing applied, { valid, code, bonus, percent, message }
  // = result of the last Apply attempt (kept so the user sees a green
  // confirmation or a red error inline next to the field).
  const [couponInfo, setCouponInfo] = useState(null);
  const [gift, setGift] = useState('');
  const [giftBusy, setGiftBusy] = useState(false);
  const [tab, setTab] = useState('add');
  const [txns, setTxns] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gwName, setGwName] = useState('');
  useEffect(() => {
    getDoc(doc(db, 'settings', 'payments')).then((s) => {
      const id = (s.exists() && s.data().active) || '';
      const map = { razorpay: 'Razorpay', cashfree: 'Cashfree',
        payu: 'PayU', paytm: 'Paytm', phonepe: 'PhonePe',
        cashfree_sandbox: 'Cashfree' };
      setGwName(map[id] || (id ? id.charAt(0).toUpperCase()
        + id.slice(1) : ''));
    }).catch(() => {});
  }, []);
  const rzpReady = useRazorpay();

  useEffect(() => {
    if (user) return walletService.listenWallet(user.uid, setWallet);
  }, [user]);

  // Prefill the amount when sent here from the "recharge to connect"
  // prompt (e.g. /wallet?amt=120).
  useEffect(() => {
    const a = Number(router.query.amt);
    if (a && a >= MIN_RECHARGE) setAmount(a);
  }, [router.query.amt]);

  useEffect(() => {
    if (user && tab === 'history') {
      walletService.getTransactions(user.uid).then(setTxns);
    }
  }, [user, tab, wallet]);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve(); return;
      }
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  // Live-validate the coupon against the current amount. Re-runs
  // whenever the user changes the amount AFTER applying, so the
  // preview bonus (and the "this coupon doesn't qualify for this
  // amount" error) stays in sync without them having to tap Apply
  // again.
  async function applyCoupon() {
    setMsg(null);
    setCouponBusy(true);
    try {
      const info = await walletService.validateCoupon(coupon, amount);
      setCouponInfo(info);
    } catch (e) {
      setCouponInfo({ valid: false,
        message: e?.message || 'Could not validate coupon.' });
    } finally { setCouponBusy(false); }
  }
  // If the user changes the amount after applying, silently recompute
  // the bonus so the preview matches what they'll be charged.
  useEffect(() => {
    if (!couponInfo || !couponInfo.valid) return;
    (async () => {
      try {
        const info = await walletService.validateCoupon(
          couponInfo.code, amount);
        setCouponInfo(info);
      } catch (_) { /* ignore - keep previous preview */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);
  function clearCoupon() {
    setCoupon('');
    setCouponInfo(null);
  }

  async function pay() {
    setMsg(null);
    const amt = Number(amount) || 0;
    if (amt < MIN_RECHARGE) {
      setMsg({ ok: false, t: `Minimum recharge is ${rupees(MIN_RECHARGE)}.` });
      return;
    }
    setBusy(true);
    const back = typeof router.query.return === 'string'
      ? router.query.return : null;
    // Only forward a coupon that the server-side check accepted in
    // applyCoupon(); anything else is just a typed-but-not-applied
    // value and should be ignored.
    const couponCode = (couponInfo && couponInfo.valid)
      ? couponInfo.code : '';
    try {
      // Cashfree rejects any non-https return_url ("url should be
       // https"). Only forward the return URL when the page is on
       // HTTPS (production) or already https-loaded, otherwise omit it
       // so the gateway uses its own default redirect.
      const origin = typeof window !== 'undefined'
        ? window.location.origin : '';
      const safeReturnUrl = origin.startsWith('https://')
        ? `${origin}/wallet` : '';
      const order = await walletService.payCall({
        action: 'create', amount: amt, couponCode,
        name: profile?.name, email: profile?.email,
        phone: profile?.phone,
        returnUrl: safeReturnUrl,
      });

      if (order.gateway === 'razorpay') {
        if (!rzpReady) {
          setMsg({ ok: false, t: 'Payment not ready yet.' });
          setBusy(false); return;
        }
        const rzp = new window.Razorpay({
          key: order.keyId,
          amount: Math.round(amt * 100),
          currency: 'INR',
          name: 'AstroSeer',
          description: 'Wallet recharge',
          order_id: order.orderId,
          prefill: { name: profile?.name, email: profile?.email },
          theme: { color: '#6C2BD9' },
          handler: async (resp) => {
            try {
              const v = await walletService.payCall({
                action: 'verify',
                orderId: resp.razorpay_order_id,
                paymentId: resp.razorpay_payment_id,
                signature: resp.razorpay_signature,
                amount: amt,
                couponCode,
              });
              const bonus = Number(v && v.bonus) || 0;
              setMsg({ ok: true,
                t: bonus > 0
                  ? `Payment successful. ${rupees(amt)} added, `
                    + `+${rupees(bonus)} coupon bonus (${couponCode}).`
                  : `Payment successful, ${rupees(amt)} added`,
                back });
              clearCoupon();
            } catch {
              setMsg({ ok: false, t: 'Payment verification failed.' });
            }
          },
          modal: { ondismiss: () => setBusy(false) },
        });
        rzp.on('payment.failed', () =>
          setMsg({ ok: false, t: 'Payment failed. Please try again.' }));
        rzp.open();
      } else if (order.gateway === 'cashfree') {
        // Remember the order so we can verify after returning. Persist
        // the coupon code with it so the post-redirect verify call can
        // still credit the bonus even after a full page navigation.
        try {
          sessionStorage.setItem('cfPending',
            JSON.stringify({ orderId: order.orderId, amount: amt,
              couponCode, back }));
        } catch (_) {}
        await loadScript('https://sdk.cashfree.com/js/v3/cashfree.js');
        // eslint-disable-next-line no-undef
        const cf = window.Cashfree({ mode: 'production' });
        cf.checkout({
          paymentSessionId: order.paymentSessionId,
          redirectTarget: '_self',
        });
      } else {
        setMsg({ ok: false,
          t: 'This gateway is not wired yet. Use Razorpay or Cashfree.' });
      }
    } catch (e) {
      setMsg({ ok: false, t: e?.message || 'Could not start payment.' });
    } finally {
      setBusy(false);
    }
  }

  // After returning from Cashfree hosted checkout, verify + credit.
  useEffect(() => {
    let raw;
    try { raw = sessionStorage.getItem('cfPending'); } catch (_) {}
    if (!raw || !user) return;
    try { sessionStorage.removeItem('cfPending'); } catch (_) {}
    const { orderId, amount: amt, back, couponCode: storedCoupon }
      = JSON.parse(raw);
    (async () => {
      try {
        const r = await walletService.payCall({
          action: 'verify', orderId,
          couponCode: storedCoupon || '' });
        if (r.success) {
          const bonus = Number(r && r.bonus) || 0;
          setMsg({ ok: true,
            t: bonus > 0
              ? `Payment successful. ${rupees(r.amount || amt)} added, `
                + `+${rupees(bonus)} coupon bonus (${storedCoupon}).`
              : `Payment successful, ${rupees(r.amount || amt)} added`,
            back });
          clearCoupon();
        } else {
          setMsg({ ok: false,
            t: `Payment ${r.status || 'not completed'}.` });
        }
      } catch (e) {
        setMsg({ ok: false, t: e?.message || 'Verification failed.' });
      }
    })();
  }, [user]);

  async function redeemGift() {
    setMsg(null);
    const code = gift.trim().toUpperCase();
    if (code.length !== 8) {
      setMsg({ ok: false, t: 'Enter the 8-character gift card code.' });
      return;
    }
    setGiftBusy(true);
    try {
      const r = await walletService.redeemGiftCard(code);
      setGift('');
      setMsg({ ok: true, t: `Gift card redeemed, Rs ${r.amount} added.` });
    } catch (e) {
      setMsg({ ok: false, t: e?.message || 'Could not redeem this code.' });
    } finally { setGiftBusy(false); }
  }

  if (loading) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      {typeof router.query.return === 'string' && (
        <button
          onClick={() => router.push(router.query.return)}
          className="mb-3 flex w-full items-center justify-center gap-2
            rounded-card bg-bg-light py-2.5 text-sm font-semibold
            text-primary">
          &#8249; Back to your consultation (it stays connected)
        </button>
      )}

      {/* Compact balance + inline tab switcher. ~88 px tall total. */}
      <div className="hero-grad flex items-center justify-between
        rounded-2xl px-4 py-3 text-white">
        <div>
          <div className="text-[11px] uppercase tracking-wide opacity-80">
            Wallet balance
          </div>
          <div className="text-2xl font-bold leading-tight">
            {rupees(wallet)}
          </div>
        </div>
        <div className="flex gap-1 rounded-full bg-white/15 p-0.5">
          {[['add', 'Add'], ['history', 'History']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                tab === k ? 'bg-white text-primary' : 'text-white'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {tab === 'add' ? (
        <div className="mt-3 space-y-3">
          {/* Quick amounts + custom field combined into a single card */}
          <div className="card space-y-2 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide
              text-sub-text">Recharge amount</div>
            <div className="grid grid-cols-5 gap-1.5">
              {QUICK.map((q) => (
                <button key={q} onClick={() => setAmount(q)}
                  className={`rounded-full py-1.5 text-xs font-semibold ${
                    amount === q
                      ? 'bg-primary text-white'
                      : 'bg-bg-light text-dark-text'}`}>
                  {rupees(q)}
                </button>
              ))}
            </div>
            <input className="input !py-2 text-sm" type="number"
              min={MIN_RECHARGE} value={amount}
              onChange={(e) => setAmount(e.target.value === ''
                ? '' : Number(e.target.value))}
              placeholder={`Custom amount (min ${rupees(MIN_RECHARGE)})`} />
          </div>

          {/* Available offers - Swiggy/BigBasket-style list. Renders
              every active coupon the customer can use right now. Tap
              a card to auto-fill the code into the field below. */}
          <CouponsPanel
            amount={Number(amount) || 0}
            activeCode={couponInfo?.valid ? couponInfo.code : ''}
            onPick={(code, minAmt) => {
              setCoupon(code);
              if (minAmt > 0 && (Number(amount) || 0) < minAmt) {
                setAmount(minAmt);
              }
              setCouponInfo(null);
              // Auto-apply so the customer sees the bonus preview
              // without an extra tap.
              setTimeout(() => {
                walletService.validateCoupon(code,
                  Math.max(Number(amount) || 0, minAmt || 0))
                  .then((info) => setCouponInfo(info))
                  .catch(() => {});
              }, 0);
            }} />

          {/* Manual code entry (paste from outside) */}
          <div className="card space-y-1.5 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide
              text-sub-text">Have a code from outside?</div>
            <div className="flex gap-2">
              <input className="input !py-2 flex-1 tracking-wider
                text-sm uppercase"
                value={coupon}
                onChange={(e) => {
                  setCoupon(e.target.value.toUpperCase());
                  if (couponInfo) setCouponInfo(null);
                }}
                placeholder="Coupon code" />
              {couponInfo && couponInfo.valid ? (
                <button onClick={clearCoupon}
                  className="rounded-full border border-gray-300 px-3
                    text-xs font-semibold text-sub-text">
                  Remove
                </button>
              ) : (
                <button onClick={applyCoupon}
                  disabled={couponBusy || !coupon.trim()}
                  className="rounded-full bg-primary px-4 text-xs
                    font-bold text-white disabled:opacity-50">
                  {couponBusy ? '…' : 'Apply'}
                </button>
              )}
            </div>
            {couponInfo && (
              <div className={`rounded-md px-2 py-1 text-[11px] ${
                couponInfo.valid
                  ? 'bg-success/10 text-success'
                  : 'bg-danger/10 text-danger'}`}>
                {couponInfo.valid ? '✓ ' : '✗ '}{couponInfo.message}
              </div>
            )}
          </div>

          {/* Gift card - kept but tightened */}
          <div className="card space-y-1.5 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide
              text-sub-text">Redeem a gift card</div>
            <div className="flex gap-2">
              <input className="input !py-2 flex-1 tracking-wider
                text-sm uppercase"
                maxLength={8} value={gift}
                onChange={(e) => setGift(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="Gift card code (8 letters)" />
              <button onClick={redeemGift} disabled={giftBusy}
                className="rounded-full bg-primary px-4 text-xs
                  font-bold text-white disabled:opacity-50">
                {giftBusy ? '…' : 'Redeem'}
              </button>
            </div>
          </div>

          {msg && (
            <div className={`rounded-card p-3 text-sm ${msg.ok
              ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
              {msg.ok ? '✅ ' : ''}{msg.t}
              {msg.ok && msg.back && (
                <button onClick={() => router.push(msg.back)}
                  className="mt-2 block w-full rounded-card bg-primary
                    py-2 text-sm font-semibold text-white">
                  Back to your consultation
                </button>
              )}
            </div>
          )}
          <button onClick={pay} disabled={busy}
            className="btn-primary w-full">
            {busy ? 'Processing...'
              : (couponInfo && couponInfo.valid && couponInfo.bonus > 0
                ? `Pay ₹${Number(amount) || 0} → `
                  + `get ₹${(Number(amount) || 0) + couponInfo.bonus} `
                  + 'in wallet'
                : `Add ₹${Number(amount) || 0} to Wallet`)}
          </button>
          <p className="text-center text-[11px] text-sub-text">
            🔒 Secure payment{gwName ? ` via ${gwName}` : ''}
          </p>
        </div>
      ) : (
        <div className="mt-3">
          {txns == null ? (
            <SkeletonList count={4} />
          ) : txns.length === 0 ? (
            <div className="card text-sub-text">No transactions yet.</div>
          ) : (
            <div className="space-y-2">
              {txns.map((t) => (
                <TxnRow key={t.id} t={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}

// Available-offers panel. Swiggy / BigBasket-style horizontal card
// list of every active coupon the customer can use right now.
// Tapping a card applies the code into the manual-entry input below.
// Shows the headline 100%-cashback first-recharge offer prominently
// when the user is eligible; hides it the moment they have a
// successful payment on the wallet.
function CouponsPanel({ amount, activeCode, onPick }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    walletService.listAvailableCoupons()
      .then(setList).catch(() => setList([]));
  }, []);
  if (list == null) {
    return (
      <div className="card flex h-16 items-center justify-center
        p-3 text-xs text-sub-text">
        Loading offers...
      </div>
    );
  }
  if (list.length === 0) return null;
  return (
    <div className="card space-y-2 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide
          text-sub-text">Available offers</div>
        <div className="text-[10px] text-sub-text">
          Tap to apply
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {list.map((c) => {
          const min = Number(c.minAmount || 0);
          const cap = Number(c.maxDiscount || 0);
          const pct = Number(c.discountPercent || 0);
          const ineligible = min > 0 && amount > 0 && amount < min;
          const isActive = activeCode === c.code;
          return (
            <button key={c.id} type="button"
              onClick={() => onPick(c.code, min)}
              className={`relative flex w-60 shrink-0 flex-col gap-1
                rounded-xl border p-2.5 text-left transition ${
                isActive
                  ? 'border-primary bg-primary/5'
                  : ineligible
                    ? 'border-gray-200 bg-white opacity-70'
                    : 'border-gray-200 bg-white hover:border-primary'}`}>
              <div className="flex items-center gap-1.5">
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5
                  text-[10px] font-bold uppercase tracking-wide
                  text-amber-800">
                  {pct}%{cap ? ` UP TO ₹${cap}` : ''}
                </span>
                {c.firstRechargeOnly && (
                  <span className="rounded-md bg-emerald-100 px-1.5 py-0.5
                    text-[10px] font-bold uppercase tracking-wide
                    text-emerald-800">
                    First recharge
                  </span>
                )}
              </div>
              <div className="text-sm font-bold text-dark-text">
                {c.title || c.code}
              </div>
              {c.description && (
                <div className="line-clamp-2 text-[11px] leading-snug
                  text-sub-text">{c.description}</div>
              )}
              <div className="mt-0.5 flex items-center justify-between
                text-[10px]">
                <span className="font-mono text-sub-text">
                  Code {c.code}
                </span>
                <span className={`font-bold ${
                  isActive ? 'text-success' : 'text-primary'}`}>
                  {isActive ? '✓ Applied'
                    : ineligible ? `Min ₹${min}` : 'Tap to apply'}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Detailed transaction row. For SESSION debits / refunds / settlements
// it fetches the linked session + astrologer to show astrologer name,
// session type, duration, ref no, and a clickable link to that chat /
// call history. For RECHARGES it links to the invoice + shows the
// payment-gateway reference if any.
function fmtDur(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
const TYPE_ICON = { chat: '💬', call: '📞', video: '📹' };

function TxnRow({ t }) {
  const [sess, setSess] = useState(null);
  const [astro, setAstro] = useState(null);
  const reason = String(t.reason || '').toLowerCase();
  // Strictly match the reason strings that we KNOW are sessions or
  // session-derived (refund/settlement). The old fallback
  // "any txn with a referenceId" wrongly bucketed seeds (demo seed),
  // coupon bonuses, manual admin credits, etc. as "Session" with no
  // matching session doc, which then rendered as the bare title
  // "Session" with no astrologer name.
  const SESSION_REASONS = ['session', 'session-end', 'consultation',
    'refund', 'settlement'];
  const isSession = SESSION_REASONS.some((k) => reason.includes(k));

  useEffect(() => {
    if (!isSession || !t.referenceId) return;
    sessionService.getSession(t.referenceId).then(async (s) => {
      if (!s) return;
      setSess(s);
      if (s.astroId) {
        try {
          const a = await astrologerService.getAstrologer(s.astroId);
          setAstro(a);
        } catch (_) {}
      }
    }).catch(() => {});
  }, [isSession, t.referenceId]);

  const when = t.createdAt?.toDate
    ? t.createdAt.toDate().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) : '';
  const ref = isSession && t.referenceId
    ? `#${String(t.referenceId).slice(-6).toUpperCase()}` : null;
  const isCredit = t.amount >= 0;
  const sign = isCredit ? '+' : '';

  // Title + subtitle vary by what this transaction is.
  // Default: title-case the raw reason so unknown types still read as
  // human English (e.g. "demo seed" -> "Demo seed", "coupon bonus" ->
  // "Coupon bonus") instead of the bare backend identifier.
  let title = (t.reason || 'Transaction')
    .replace(/^./, (c) => c.toUpperCase());
  let sub = when;
  let href = null;
  if (reason === 'recharge') {
    title = 'Wallet recharge';
    sub = t.gateway ? `${when} · via ${t.gateway}` : when;
    href = t.referenceId ? `/invoice/${t.referenceId}` : null;
  } else if (reason.includes('coupon')) {
    title = 'Coupon bonus';
    if (t.couponCode) sub = `${when} · code ${t.couponCode}`;
  } else if (reason.includes('gift')) {
    title = 'Gift card credit';
  } else if (reason.includes('refund')) {
    title = 'Refund credited';
    sub = sess && astro
      ? `${TYPE_ICON[sess.type] || ''} ${astro.name || 'Astrologer'} · ${
        when}` : when;
    href = sess ? `/chat/${sess.astroId}?view=1` : null;
  } else if (isSession) {
    if (sess) {
      title = `${TYPE_ICON[sess.type] || ''} ${
        (sess.type || 'session').toUpperCase()} with ${
        astro?.name || 'Astrologer'}`;
      sub = `${when} · ${fmtDur(sess.duration)}${
        ref ? ` · Ref ${ref}` : ''}`;
      href = sess.type === 'chat'
        ? `/chat/${sess.astroId}?view=1`
        : `/call-history`;
    } else {
      title = 'Session';
      sub = ref ? `${when} · Ref ${ref}` : when;
    }
  }

  const Body = (
    <div className="card flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold capitalize text-dark-text">
          {title}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-sub-text">
          {sub}
        </div>
      </div>
      <div className="text-right">
        <div className={`text-base font-bold ${isCredit
          ? 'text-success' : 'text-danger'}`}>
          {sign}₹{Math.abs(t.amount)}
        </div>
        {href && (
          <div className="text-[10px] font-semibold text-primary
            underline">
            {reason === 'recharge' ? 'Invoice'
              : reason.includes('refund') ? 'View'
              : 'Open'}
          </div>
        )}
      </div>
    </div>
  );
  if (href) {
    return <Link href={href} className="block">{Body}</Link>;
  }
  return Body;
}
