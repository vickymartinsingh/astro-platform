import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { walletService, db } from '@astro/shared';
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

  async function pay() {
    setMsg(null);
    const amt = Number(amount) || 0;
    if (amt < MIN_RECHARGE) {
      setMsg({ ok: false, t: `Minimum recharge is ₹${MIN_RECHARGE}.` });
      return;
    }
    setBusy(true);
    const back = typeof router.query.return === 'string'
      ? router.query.return : null;
    try {
      const order = await walletService.payCall({
        action: 'create', amount: amt,
        name: profile?.name, email: profile?.email,
        phone: profile?.phone,
        returnUrl: typeof window !== 'undefined'
          ? `${window.location.origin}/wallet` : '',
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
              await walletService.payCall({
                action: 'verify',
                orderId: resp.razorpay_order_id,
                paymentId: resp.razorpay_payment_id,
                signature: resp.razorpay_signature,
                amount: amt,
              });
              setMsg({ ok: true,
                t: `Payment successful, ₹${amt} added`, back });
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
        // Remember the order so we can verify after returning.
        try {
          sessionStorage.setItem('cfPending',
            JSON.stringify({ orderId: order.orderId, amount: amt, back }));
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
    const { orderId, amount: amt, back } = JSON.parse(raw);
    (async () => {
      try {
        const r = await walletService.payCall({
          action: 'verify', orderId });
        if (r.success) {
          setMsg({ ok: true,
            t: `Payment successful, ₹${r.amount || amt} added`, back });
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

      <div className="hero-grad rounded-card p-6 text-center text-white">
        <div className="text-sm opacity-80">Wallet Balance</div>
        <div className="mt-1 text-4xl font-bold">₹{wallet}</div>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={() => setTab('add')}
          className={`flex-1 rounded-card py-2 font-semibold ${
            tab === 'add' ? 'bg-primary text-white' : 'bg-white'}`}>
          Add Money
        </button>
        <button onClick={() => setTab('history')}
          className={`flex-1 rounded-card py-2 font-semibold ${
            tab === 'history' ? 'bg-primary text-white' : 'bg-white'}`}>
          Transactions
        </button>
      </div>

      {tab === 'add' ? (
        <div className="card mt-3 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {QUICK.map((q) => (
              <button key={q} onClick={() => setAmount(q)}
                className={`rounded-card py-3 font-semibold ${
                  amount === q ? 'bg-primary text-white' : 'bg-bg-light'}`}>
                ₹{q}
              </button>
            ))}
          </div>
          <input className="input" type="number" min={MIN_RECHARGE}
            value={amount}
            onChange={(e) => setAmount(e.target.value === ''
              ? '' : Number(e.target.value))}
            placeholder="Custom amount" />
          <input className="input" value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            placeholder="Have a coupon? Enter code" />
          <div className="rounded-card border border-gray-200 p-3">
            <div className="mb-2 text-sm font-semibold">
              Redeem a gift card
            </div>
            <div className="flex gap-2">
              <input className="input flex-1 tracking-widest"
                maxLength={8} value={gift}
                onChange={(e) => setGift(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="8-CHAR CODE" />
              <button onClick={redeemGift} disabled={giftBusy}
                className="btn-primary !min-h-0 px-4">
                {giftBusy ? '...' : 'Redeem'}
              </button>
            </div>
          </div>
          {msg && (
            <div className={`rounded-card p-3 ${msg.ok
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
              : `Add ₹${Number(amount) || 0} to Wallet`}
          </button>
          <p className="text-center text-xs text-sub-text">
            🔒 Secure online payment{gwName ? ` via ${gwName}` : ''}
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
                <div key={t.id} className="card flex justify-between">
                  <div>
                    <div className="font-medium capitalize">{t.reason}</div>
                    <div className="text-xs text-sub-text">
                      {t.createdAt?.toDate
                        ? t.createdAt.toDate().toLocaleString() : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${t.amount >= 0
                      ? 'text-success' : 'text-danger'}`}>
                      {t.amount >= 0 ? '+' : ''}₹{Math.abs(t.amount)}
                    </div>
                    {t.reason === 'recharge' && t.referenceId && (
                      <a href={`/invoice/${t.referenceId}`}
                        className="text-xs text-primary underline">
                        Invoice
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
