import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  sessionService, astrologerService, payoutService,
} from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const DAY = 864e5;

// Earnings + payouts page (Phase B + D delivery 2026-06-06).
//
// The astrologer sees:
//   - lifetime earnings + period buckets
//   - instant quote (70 percent cap, KYC flag) with a Request Payout
//     button that opens a confirmation modal showing locked bank
//     details (account holder / bank / IFSC / branch / UPI)
//   - payouts list with lifecycle chips (Initiated / Processing /
//     Completed / Rejected) + Mode + UTR + transfer datetime when
//     the admin has marked it Completed. Internal receipt is NEVER
//     surfaced; only a "Receipt on file" hint per spec.

const STATUS_TONE = {
  initiated: 'bg-amber-100 text-amber-800',
  pending:   'bg-amber-100 text-amber-800', // legacy alias
  processing:'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  approved:  'bg-emerald-100 text-emerald-700', // legacy alias
  rejected:  'bg-rose-100 text-rose-700',
};

function fmt(ts) {
  if (!ts) return '–';
  const ms = ts.toMillis ? ts.toMillis()
    : ts.seconds ? ts.seconds * 1000 : 0;
  if (!ms) return '–';
  return new Date(ms).toLocaleString('en-GB',
    { day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit' });
}

export default function AstroEarnings() {
  const { user, loading } = useRequireAstrologer();
  const [ended, setEnded] = useState([]);
  const [astro, setAstro] = useState(null);
  const [quote, setQuote] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [modal, setModal] = useState(false);
  const [tab, setTab] = useState('summary');

  async function refresh() {
    if (!user) return;
    try {
      const [a, q, ps] = await Promise.all([
        astrologerService.getAstrologer(user.uid),
        payoutService.getInstantQuote(user.uid),
        payoutService.getPayouts(user.uid),
      ]);
      setAstro(a); setQuote(q); setPayouts(ps);
    } catch (_) { /* ignore */ }
  }

  useEffect(() => {
    if (!user) return;
    sessionService.collectAstrologerEarnings(user.uid)
      .catch(() => {})
      .finally(() => {
        sessionService.getAstrologerSessions(user.uid).then((l) =>
          setEnded(l.filter((s) => s.status === 'ended')))
          .catch(() => setEnded([]));
        refresh();
      });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Layout><div className="card">Loading…</div></Layout>;

  const now = Date.now();
  const within = (ms) => ended.filter((s) =>
    s.createdAt?.toDate && now - s.createdAt.toDate().getTime() <= ms);
  const sum = (a) => a.reduce((x, s) =>
    x + Number(s.astrologerEarning || 0), 0).toFixed(0);

  return (
    <Layout>
      <header className="mb-3">
        <h1 className="text-2xl font-bold text-dark-text">
          Earnings & payouts
        </h1>
        <p className="mt-0.5 text-sm text-sub-text">
          Request a payout any time (70 percent of available
          balance). The admin processes via NEFT / RTGS within 24h.
        </p>
      </header>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Today', within(DAY)], ['This Week', within(7 * DAY)],
          ['This Month', within(30 * DAY)], ['All Time', ended]]
          .map(([label, arr]) => (
          <div key={label} className="card text-center">
            <div className="text-xs uppercase tracking-wider
              text-sub-text">{label}</div>
            <div className="mt-1 text-lg font-bold text-dark-text">
              ₹{sum(arr)}
            </div>
          </div>
        ))}
      </div>

      {/* Instant payout card */}
      {quote && (
        <div className="surface mt-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider
                text-sub-text">Instant payout</h2>
              <p className="mt-0.5 text-[11px] text-sub-text">
                You can withdraw up to{' '}
                <b>{Math.round(quote.capPct * 100)} percent</b> of
                your available balance instantly. Transfer happens
                within 24 hours via NEFT or RTGS.
              </p>
            </div>
            <button onClick={() => setModal(true)}
              disabled={quote.instantMax <= 0 || quote.kycRequired}
              className="rounded-full bg-primary px-5 py-2 text-sm
                font-bold text-white disabled:opacity-50">
              Request payout
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Lifetime earnings"
              value={`₹${quote.earnings}`} />
            <Stat label="Locked in payouts"
              value={`₹${quote.locked}`} />
            <Stat label="Available balance"
              value={`₹${quote.available}`} highlight />
            <Stat label="Instant max (70%)"
              value={`₹${quote.instantMax}`} highlight />
          </div>
          {quote.kycRequired && (
            <div className="mt-3 rounded-card bg-rose-50 p-2 text-xs
              text-rose-800">
              <b>KYC approval required.</b>{' '}
              <Link href="/astro-profile"
                className="underline font-bold">
                Complete your KYC
              </Link>{' '}
              before requesting a payout.
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="mt-4 flex flex-wrap gap-2">
        {[['summary', 'Session breakdown'],
          ['payouts', `Payouts (${payouts.length})`]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold
              ${tab === k ? 'bg-primary text-white'
                : 'bg-bg-light text-sub-text hover:bg-gray-200'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="mt-3 space-y-2">
          {ended.length === 0 ? (
            <div className="card text-sub-text">No earnings yet.</div>
          ) : ended.map((s) => (
            <div key={s.id} className="card text-sm">
              <div className="flex justify-between">
                <span className="capitalize font-semibold">{s.type}</span>
                <span className="text-[11px] text-sub-text">
                  {s.createdAt?.toDate
                    ? s.createdAt.toDate().toLocaleString('en-GB',
                        { day: '2-digit', month: 'short',
                          hour: '2-digit', minute: '2-digit' })
                    : ''}
                </span>
              </div>
              <div className="mt-1 text-sub-text text-[12px]">
                Gross ₹{s.cost || 0} · Commission
                {' '}{s.commissionPercent || 0}% · Earned
                {' '}<b>₹{s.astrologerEarning || 0}</b>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'payouts' && (
        <div className="mt-3 space-y-2">
          {payouts.length === 0 ? (
            <div className="card text-sub-text">
              No payouts yet. Tap <b>Request payout</b> above to
              start your first one.
            </div>
          ) : payouts.map((p) => (
            <PayoutRow key={p.id} p={p} />
          ))}
        </div>
      )}

      {modal && (
        <RequestModal astroId={user.uid} astro={astro} quote={quote}
          onClose={() => setModal(false)}
          onDone={() => { setModal(false); refresh(); }} />
      )}
    </Layout>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`rounded-2xl p-2 text-center ${highlight
      ? 'bg-primary/5 ring-1 ring-primary/30' : 'bg-bg-light/40'}`}>
      <div className="text-[10px] uppercase tracking-wider text-sub-text">
        {label}
      </div>
      <div className={`mt-0.5 font-bold ${highlight
        ? 'text-primary' : 'text-dark-text'}`}>{value}</div>
    </div>
  );
}

function PayoutRow({ p }) {
  const status = p.status || 'initiated';
  return (
    <div className="card text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] text-sub-text">
            {fmt(p.createdAt)} · {p.type === 'instant'
              ? 'Instant (70% rule)' : 'Scheduled'}
          </div>
          <div className="font-mono text-lg font-bold text-dark-text">
            ₹{p.amount || 0}
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px]
          font-bold uppercase ${STATUS_TONE[status]
            || 'bg-bg-light text-sub-text'}`}>
          {status === 'pending' ? 'initiated'
            : status === 'approved' ? 'completed'
            : status}
        </span>
      </div>
      {(p.mode || p.utr) && (
        <div className="mt-2 rounded-card bg-bg-light/40 p-2 text-[12px]">
          <b>{p.mode || '–'}</b>{' '}· UTR{' '}
          <span className="font-mono">{p.utr || '–'}</span>
          {p.completedAtIso && (
            <span className="ml-1 text-sub-text">
              · {new Date(p.completedAtIso).toLocaleString('en-GB',
                  { day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}
      {p.bankSnap && p.bankSnap.accountNumber && (
        <div className="mt-2 text-[11px] text-sub-text">
          Sent to {p.bankSnap.accountHolder} · {p.bankSnap.bankName}{' '}
          A/C ****{String(p.bankSnap.accountNumber).slice(-4)}
        </div>
      )}
      {p.narration && (
        <div className="mt-1 text-[11px] text-sub-text">
          {p.narration}
        </div>
      )}
      {status === 'rejected' && p.adminNote && (
        <div className="mt-2 rounded-card bg-rose-50 p-2 text-[11px]
          text-rose-700">
          Reason: {p.adminNote}
        </div>
      )}
      {p._hasReceipt && (
        <div className="mt-1 text-[10px] text-sub-text">
          Receipt on file (internal)
        </div>
      )}
      <div className="mt-2 text-right">
        <button onClick={() => printPayout(p)}
          className="rounded-full border border-gray-200 px-3 py-1
            text-[10px] font-bold text-sub-text hover:bg-bg-light">
          ⎙ PDF
        </button>
      </div>
    </div>
  );
}

function printPayout(p) {
  const win = window.open('', '_blank', 'width=700,height=900');
  if (!win) return;
  const b = p.bankSnap || {};
  win.document.write(`<!doctype html><html><head><title>Payout ${p.id}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1c1e;margin:32px}
      h1{font-size:22px;margin:0 0 4px}
      .meta{color:#666;font-size:12px;margin-bottom:18px}
      .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px}
      .row .k{color:#666}
      .row .v{font-weight:600}
      .amount{font-size:32px;font-weight:700;color:#7F2020;margin:24px 0 8px}
      .status{display:inline-block;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase}
      @media print{body{margin:16px}}
    </style></head><body>
    <h1>Payout statement</h1>
    <div class="meta">Reference ${p.id} · Issued ${new Date().toLocaleString('en-GB')}</div>
    <div class="amount">₹${p.amount || 0}</div>
    <div class="status">${p.status}</div>
    <div style="margin-top:24px">
      <div class="row"><span class="k">Type</span><span class="v">${p.type || 'scheduled'}</span></div>
      <div class="row"><span class="k">Requested</span><span class="v">${fmt(p.createdAt)}</span></div>
      <div class="row"><span class="k">Mode</span><span class="v">${p.mode || '–'}</span></div>
      <div class="row"><span class="k">UTR / Ref</span><span class="v">${p.utr || '–'}</span></div>
      <div class="row"><span class="k">Completed</span><span class="v">${p.completedAtIso ? new Date(p.completedAtIso).toLocaleString('en-GB') : '–'}</span></div>
      <div class="row"><span class="k">Account holder</span><span class="v">${b.accountHolder || '–'}</span></div>
      <div class="row"><span class="k">Bank</span><span class="v">${b.bankName || '–'}</span></div>
      <div class="row"><span class="k">A/C</span><span class="v">${b.accountNumber || '–'}</span></div>
      <div class="row"><span class="k">IFSC</span><span class="v">${b.ifsc || '–'}</span></div>
      ${b.branch ? `<div class="row"><span class="k">Branch</span><span class="v">${b.branch}</span></div>` : ''}
      ${p.narration ? `<div class="row"><span class="k">Narration</span><span class="v">${p.narration}</span></div>` : ''}
      ${p.adminNote ? `<div class="row"><span class="k">Note</span><span class="v">${p.adminNote}</span></div>` : ''}
    </div>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
    </body></html>`);
  win.document.close();
}

function RequestModal({ astroId, astro, quote, onClose, onDone }) {
  const [amount, setAmount] = useState(quote.instantMax || '');
  const [step, setStep] = useState('amount'); // amount | confirm
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bank = (astro && astro.bank) || {};
  const bankReady = bank.accountHolder && bank.bankName
    && bank.accountNumber && bank.ifsc;

  async function submit() {
    setBusy(true); setErr('');
    try {
      await payoutService.requestInstantPayout(astroId, Number(amount),
        'Instant payout request');
      onDone && onDone();
    } catch (e) {
      setErr(String((e && e.message) || e));
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center
      bg-black/40 p-3 sm:items-center" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4
        shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-dark-text">
          {step === 'amount' ? 'Request instant payout'
            : 'Confirm transfer details'}
        </h3>

        {!bankReady ? (
          <div className="mt-3 rounded-card bg-rose-50 p-3 text-xs
            text-rose-800">
            Add your bank details on your profile before requesting a
            payout. Required fields: account holder, bank name,
            account number, IFSC.
          </div>
        ) : step === 'amount' ? (
          <div className="mt-3 space-y-3">
            <p className="text-[12px] text-sub-text">
              Maximum: <b>₹{quote.instantMax}</b> (70 percent of
              your ₹{quote.available} available balance).
            </p>
            <input type="number" className="input text-2xl font-bold"
              value={amount} max={quote.instantMax}
              onChange={(e) => setAmount(e.target.value)} />
            {err && (
              <div className="rounded-card bg-rose-50 p-2 text-xs
                text-rose-700">{err}</div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={onClose}
                className="rounded-full px-4 py-2 text-sm font-semibold
                  text-sub-text hover:bg-bg-light">Cancel</button>
              <button onClick={() => setStep('confirm')}
                disabled={!amount || Number(amount) <= 0
                  || Number(amount) > quote.instantMax}
                className="rounded-full bg-primary px-4 py-2 text-sm
                  font-bold text-white disabled:opacity-50">
                Continue
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-[12px] text-sub-text">
              The admin will transfer this amount to the bank account
              below via NEFT / RTGS within 24 hours. Bank details
              are <b>locked</b> on this request - they cannot be
              changed after submission.
            </p>
            <div className="rounded-card bg-bg-light/40 p-3 text-sm">
              <Row k="Amount" v={`₹${amount}`} bold />
              <Row k="Account holder" v={bank.accountHolder} />
              <Row k="Bank" v={bank.bankName} />
              <Row k="A/C number" v={bank.accountNumber} mono />
              <Row k="IFSC" v={bank.ifsc} mono />
              {bank.branch && <Row k="Branch" v={bank.branch} />}
              {bank.upi && <Row k="UPI (fallback)" v={bank.upi} mono />}
            </div>
            {err && (
              <div className="rounded-card bg-rose-50 p-2 text-xs
                text-rose-700">{err}</div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setStep('amount')}
                className="rounded-full px-4 py-2 text-sm font-semibold
                  text-sub-text hover:bg-bg-light">Back</button>
              <button onClick={submit} disabled={busy}
                className="rounded-full bg-primary px-4 py-2 text-sm
                  font-bold text-white disabled:opacity-50">
                {busy ? 'Submitting…'
                  : `Confirm ₹${amount}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, bold, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-[10px] uppercase tracking-wider text-sub-text">
        {k}
      </span>
      <span className={`${bold ? 'text-base font-bold' : 'text-sm'}
        ${mono ? 'font-mono' : ''} text-dark-text`}>{v}</span>
    </div>
  );
}
