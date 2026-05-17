import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { walletService } from '@astro/shared';
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
  const [tab, setTab] = useState('add');
  const [txns, setTxns] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
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

  async function pay() {
    setMsg(null);
    if (!rzpReady) { setMsg({ ok: false, t: 'Payment not ready yet.' }); return; }
    if (amount < MIN_RECHARGE) {
      setMsg({ ok: false, t: `Minimum recharge is ₹${MIN_RECHARGE}.` });
      return;
    }
    setBusy(true);
    try {
      const order = await walletService.createRechargeOrder(amount, coupon);
      const rzp = new window.Razorpay({
        key: order.keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: Math.round(order.amount * 100),
        currency: 'INR',
        name: 'AstroConnect',
        description: 'Wallet recharge',
        order_id: order.orderId,
        prefill: { name: profile?.name, email: profile?.email },
        theme: { color: '#6C2BD9' },
        handler: async (resp) => {
          try {
            await walletService.verifyRecharge({
              orderId: resp.razorpay_order_id,
              paymentId: resp.razorpay_payment_id,
              signature: resp.razorpay_signature,
              amount,
            });
            setMsg({ ok: true, t: `Payment successful, ₹${amount} added`,
              back: typeof router.query.return === 'string'
                ? router.query.return : null });
          } catch {
            setMsg({ ok: false, t: 'Payment verification failed.' });
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on('payment.failed', () =>
        setMsg({ ok: false, t: 'Payment failed. Please try again.' }));
      rzp.open();
    } catch (e) {
      setMsg({ ok: false, t: e?.message || 'Could not start payment.' });
    } finally {
      setBusy(false);
    }
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

      <div className="rounded-card bg-gradient-to-br from-primary
                      to-[#8B5CF6] p-6 text-center text-white">
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
            onChange={(e) => setAmount(Number(e.target.value))}
            placeholder="Custom amount" />
          <input className="input" value={coupon}
            onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            placeholder="Have a coupon? Enter code" />
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
            {busy ? 'Processing...' : `Add ₹${amount} to Wallet`}
          </button>
          <p className="text-center text-xs text-sub-text">
            🔒 Secured by Razorpay
          </p>
          <p className="text-center text-xs text-sub-text">
            Test card 4111 1111 1111 1111 · any future expiry · CVV 123 · OTP 1234
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
