import { useEffect, useState } from 'react';
import Link from 'next/link';
import { engagementService, rupees } from '@astro/shared';
import Layout from '../components/Layout';
import { SkeletonList } from '../components/Skeleton';
import { useRequireClient } from '../lib/useAuth';

// Today's date as YYYY-MM-DD
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MAROON = '#7F2020';
const AMBER = '#D4A12A';

export default function Points() {
  const { user, loading } = useRequireClient();
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [redeemPts, setRedeemPts] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dcDone, setDcDone] = useState(false);   // today's challenge completed?
  const [dcAvail, setDcAvail] = useState(false);  // challenge exists today?

  useEffect(() => {
    if (!user) return;
    engagementService.getUserPoints(user.uid).then(setData).catch(() =>
      setData({ total: 0, redeemed: 0, history: [] }));
    engagementService.getEngagementConfig().then(({ pointsConfig }) =>
      setCfg(pointsConfig)).catch(() => {});
    // Check daily challenge
    const today = todayStr();
    engagementService.getTodayChallenge().then((ch) => {
      if (ch && (ch.questions || []).length > 0) {
        setDcAvail(true);
        return engagementService.getDailyChallengeProgress(user.uid, today);
      }
      return null;
    }).then((prog) => {
      if (prog && prog.completed) setDcDone(true);
    }).catch(() => {});
  }, [user]);

  const rate = (cfg && cfg.pointsToInr) || 10000;
  const minInr = (cfg && cfg.minRedemptionInr) || 100;
  const minPts = Math.ceil((minInr / 100) * rate);
  const available = data ? data.total - data.redeemed : 0;
  const inrValue = available > 0 ? Math.floor((available / rate) * 100) : 0;

  async function redeem() {
    setMsg(null);
    const pts = Number(redeemPts);
    if (!pts || pts <= 0) {
      setMsg({ ok: false, t: 'Enter a valid number of points.' });
      return;
    }
    if (pts > available) {
      setMsg({ ok: false, t: `You only have ${available} points available.` });
      return;
    }
    setBusy(true);
    try {
      const r = await engagementService.redeemPoints(user.uid, pts);
      if (r.success) {
        setMsg({ ok: true,
          t: `Redeemed ${r.pointsDeducted} points for ${rupees(r.walletCredited)} wallet credit.` });
        setRedeemPts('');
        engagementService.getUserPoints(user.uid).then(setData).catch(() => {});
      } else {
        setMsg({ ok: false, t: r.error || 'Redemption failed.' });
      }
    } catch (e) {
      setMsg({ ok: false, t: e?.message || 'Something went wrong.' });
    } finally { setBusy(false); }
  }

  if (loading || !data) return <Layout><SkeletonList /></Layout>;

  return (
    <Layout>
      <div className="rounded-2xl p-5 text-white"
        style={{ background: `linear-gradient(135deg, ${MAROON} 0%, #4a1212 100%)` }}>
        <div className="text-[11px] uppercase tracking-wide opacity-80">
          Your points balance
        </div>
        <div className="mt-1 text-3xl font-bold">
          {available.toLocaleString()} <span className="text-base font-normal opacity-70">pts</span>
        </div>
        <div className="mt-1 text-sm opacity-80">
          Worth {rupees(inrValue)} in wallet credit
        </div>
        <div className="mt-1 text-[10px] opacity-60">
          {rate.toLocaleString()} pts = {rupees(100)} &middot; Min redemption {rupees(minInr)}
        </div>
      </div>

      {/* Daily challenge banner */}
      {dcAvail && (
        <div className={`mt-4 flex items-center justify-between rounded-2xl
          border p-4 ${dcDone
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-amber-300 bg-amber-50'}`}>
          <div>
            <div className="text-sm font-bold"
              style={{ color: dcDone ? '#065f46' : MAROON }}>
              {dcDone ? '&#127942; Challenge done today!' : '&#9889; Daily Challenge'}
            </div>
            <div className="mt-0.5 text-[12px] text-gray-600">
              {dcDone
                ? 'You\'ve already earned today\'s bonus. Come back tomorrow!'
                : 'Answer today\'s questions and earn bonus points.'}
            </div>
          </div>
          {!dcDone && (
            <Link href="/daily-challenge"
              className="ml-4 shrink-0 rounded-full px-4 py-2 text-xs
                font-bold text-white shadow"
              style={{ backgroundColor: MAROON }}>
              Play now
            </Link>
          )}
        </div>
      )}

      <div className="mt-4 surface p-4 space-y-3">
        <div className="text-sm font-bold" style={{ color: MAROON }}>
          Redeem to wallet
        </div>
        <div className="flex gap-2">
          <input type="number" className="input flex-1 !py-2 text-sm"
            min={minPts} max={available}
            placeholder={`Min ${minPts} points`}
            value={redeemPts}
            onChange={(e) => setRedeemPts(e.target.value)} />
          <button onClick={redeem}
            disabled={busy || !Number(redeemPts)}
            className="rounded-full px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: MAROON }}>
            {busy ? 'Redeeming…' : 'Redeem'}
          </button>
        </div>
        {Number(redeemPts) > 0 && (
          <div className="text-xs text-sub-text">
            {Number(redeemPts).toLocaleString()} pts = {rupees(Math.floor((Number(redeemPts) / rate) * 100))} wallet credit
          </div>
        )}
        {msg && (
          <div className={`rounded-card p-2 text-xs ${msg.ok
            ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
            {msg.t}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Points history</h2>
        <Link href="/"
          className="text-sm font-semibold" style={{ color: MAROON }}>
          Earn more
        </Link>
      </div>
      {data.history.length === 0 ? (
        <div className="mt-2 surface p-4 text-sm text-sub-text">
          No points activity yet. Complete activities on the home page to earn points.
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {[...data.history].reverse().map((h, i) => (
            <div key={i} className="surface flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-dark-text">
                  {h.reason || (h.amount < 0 ? 'Redeemed' : 'Earned')}
                </div>
                <div className="text-[11px] text-sub-text">
                  {h.at ? new Date(h.at).toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  }) : ''}
                </div>
              </div>
              <div className={`text-base font-bold ${h.amount >= 0
                ? 'text-success' : 'text-danger'}`}>
                {h.amount >= 0 ? '+' : ''}{h.amount} pts
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
