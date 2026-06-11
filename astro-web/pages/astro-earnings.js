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
//   - wallet balance card with Request Payout button
//   - lifetime earnings + period buckets
//   - tab switcher: Summary | Sessions | Payouts
//   - sessions list with date, client, duration, amount
//   - payouts list with lifecycle chips (Initiated / Processing /
//     Completed / Rejected) + Mode + UTR + transfer datetime when
//     the admin has marked it Completed. Internal receipt is NEVER
//     surfaced; only a "Receipt on file" hint per spec.

// Royal palette constants
const C = {
  primary:    '#7F2020',
  gold:       '#D4A12A',
  highlight:  '#FFF8E7',
  primaryRgb: '127,32,32',
};

const STATUS_TONE = {
  initiated: 'bg-amber-100 text-amber-800',
  pending:   'bg-amber-100 text-amber-800',
  processing:'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  approved:  'bg-emerald-100 text-emerald-700',
  rejected:  'bg-rose-100 text-rose-700',
};

function fmt(ts) {
  if (!ts) return '-';
  const ms = ts.toMillis ? ts.toMillis()
    : ts.seconds ? ts.seconds * 1000 : 0;
  if (!ms) return '-';
  return new Date(ms).toLocaleString('en-GB',
    { day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit' });
}

function fmtDate(ts) {
  if (!ts) return '-';
  const ms = ts.toMillis ? ts.toMillis()
    : ts.seconds ? ts.seconds * 1000 : 0;
  if (!ms) return '-';
  return new Date(ms).toLocaleString('en-GB',
    { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDuration(secs) {
  if (!secs) return '-';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export default function AstroEarnings() {
  const { user, loading } = useRequireAstrologer();
  const [ended, setEnded] = useState([]);
  const [astro, setAstro] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [payouts, setPayouts] = useState([]);
  const [modal, setModal] = useState(false);
  const [tab, setTab] = useState('summary');

  async function refresh() {
    if (!user) return;
    setQuoteLoading(true);
    try {
      const [a, q, ps] = await Promise.all([
        astrologerService.getAstrologer(user.uid),
        payoutService.getInstantQuote(user.uid),
        payoutService.getPayouts(user.uid),
      ]);
      setAstro(a); setQuote(q); setPayouts(ps);
    } catch (_) { /* ignore */ } finally {
      setQuoteLoading(false);
    }
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

  if (loading) return <Layout><div className="card">Loading...</div></Layout>;

  const now = Date.now();
  const within = (ms) => ended.filter((s) =>
    s.createdAt?.toDate && now - s.createdAt.toDate().getTime() <= ms);
  const sum = (a) => a.reduce((x, s) =>
    x + Number(s.astrologerEarning || 0), 0).toFixed(0);

  const tabs = [
    { key: 'summary',  label: 'Summary' },
    { key: 'sessions', label: `Sessions (${ended.length})` },
    { key: 'payouts',  label: `Payouts (${payouts.length})` },
  ];

  const capPctDisplay = quote ? Math.round((quote.capPct || 0.7) * 100) : 70;

  return (
    <Layout>
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-dark-text">
          Earnings &amp; Payouts
        </h1>
        <p className="mt-0.5 text-sm text-sub-text">
          You can request up to {capPctDisplay}% of available earnings.
          Admin processes via NEFT / RTGS within 24 hours.
        </p>
      </header>

      {/* Wallet balance card */}
      <WalletCard
        quote={quote}
        quoteLoading={quoteLoading}
        onRequest={() => setModal(true)}
      />

      {/* Headline tiles */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Today',      within(DAY)],
          ['This Week',  within(7 * DAY)],
          ['This Month', within(30 * DAY)],
          ['All Time',   ended],
        ].map(([label, arr]) => (
          <div key={label} className="card text-center">
            <div className="text-xs uppercase tracking-wider text-sub-text">
              {label}
            </div>
            <div className="mt-1 text-lg font-bold"
              style={{ color: C.gold }}>
              Rs.{sum(arr)}
            </div>
          </div>
        ))}
      </div>

      {/* Tab switcher */}
      <div className="mt-5 flex gap-1 rounded-2xl bg-bg-light p-1">
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className="flex-1 rounded-xl py-2 text-xs font-bold
              transition-colors"
            style={tab === key
              ? { background: C.primary, color: '#fff' }
              : { color: '#6b6b6b' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Summary tab */}
      {tab === 'summary' && (
        <div className="mt-4 space-y-3">
          {/* Balance breakdown */}
          {quoteLoading ? (
            <div className="card animate-pulse space-y-2">
              <div className="h-3 w-1/3 rounded bg-gray-200" />
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {[1,2,3,4].map((i) => (
                  <div key={i} className="h-14 rounded-xl bg-gray-100" />
                ))}
              </div>
            </div>
          ) : quote ? (
            <div className="card">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider
                text-sub-text">Balance breakdown</h2>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="Lifetime earnings"
                  value={`Rs.${quote.earnings}`} />
                <Stat label="Locked in payouts"
                  value={`Rs.${quote.locked}`} />
                <Stat label="Available balance"
                  value={`Rs.${quote.available}`} highlight />
                <Stat label={`Instant max (${capPctDisplay}%)`}
                  value={`Rs.${quote.instantMax}`} highlight />
              </div>
              {quote.kycRequired && (
                <div className="mt-3 rounded-xl bg-rose-50 p-2 text-xs
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
          ) : null}

          <p className="text-xs text-sub-text">
            Switch to the Sessions tab to see individual session breakdowns,
            or the Payouts tab to track your withdrawal history.
          </p>
        </div>
      )}

      {/* Sessions tab */}
      {tab === 'sessions' && (
        <div className="mt-4 space-y-2">
          {ended.length === 0 ? (
            <div className="card text-sub-text text-sm">
              No sessions with earnings yet.
            </div>
          ) : ended.map((s) => (
            <SessionRow key={s.id} s={s} />
          ))}
        </div>
      )}

      {/* Payouts tab */}
      {tab === 'payouts' && (
        <div className="mt-4 space-y-2">
          {payouts.length === 0 ? (
            <div className="card text-sub-text text-sm">
              No payouts yet. Tap <b>Request Payout</b> above to start
              your first one.
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

// Wallet balance card at top of page
function WalletCard({ quote, quoteLoading, onRequest }) {
  if (quoteLoading) {
    return (
      <div className="rounded-2xl p-5 animate-pulse"
        style={{ background: C.highlight, border: `1px solid ${C.gold}40` }}>
        <div className="mb-2 h-3 w-28 rounded bg-amber-200" />
        <div className="mb-4 h-9 w-40 rounded bg-amber-200" />
        <div className="flex items-center gap-3">
          <div className="h-3 w-32 rounded bg-amber-200" />
          <div className="ml-auto h-9 w-32 rounded-full bg-amber-200" />
        </div>
        <p className="mt-3 text-xs" style={{ color: C.gold }}>
          Loading payout details...
        </p>
      </div>
    );
  }

  if (!quote) return null;

  const canRequest = quote.instantMax > 0 && !quote.kycRequired;
  const capPctDisplay = Math.round((quote.capPct || 0.7) * 100);

  return (
    <div className="rounded-2xl p-5"
      style={{ background: C.highlight, border: `1px solid ${C.gold}40` }}>
      <div className="text-xs font-bold uppercase tracking-widest"
        style={{ color: C.gold }}>
        Wallet Balance
      </div>
      <div className="mt-1 text-4xl font-black tracking-tight"
        style={{ color: C.primary }}>
        Rs.{quote.available}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-sub-text space-y-0.5">
          <div>
            Lifetime: <span className="font-semibold"
              style={{ color: C.gold }}>Rs.{quote.earnings}</span>
          </div>
          <div>
            Locked: <span className="font-semibold text-dark-text">
              Rs.{quote.locked}
            </span>
            {' '}&bull;{' '}
            Instant max:{' '}
            <span className="font-semibold" style={{ color: C.gold }}>
              Rs.{quote.instantMax}
            </span>
          </div>
        </div>
        <button
          onClick={onRequest}
          disabled={!canRequest}
          className="rounded-full px-6 py-2.5 text-sm font-bold
            text-white transition-opacity disabled:opacity-40"
          style={{ background: C.primary }}>
          Request Payout
        </button>
      </div>
      {quote.kycRequired && (
        <div className="mt-3 rounded-xl bg-rose-50 p-2 text-xs text-rose-800">
          <b>KYC approval required.</b>{' '}
          <Link href="/astro-profile" className="underline font-bold">
            Complete your KYC
          </Link>{' '}
          to enable payouts.
        </div>
      )}
      <p className="mt-2 text-[11px]" style={{ color: C.gold }}>
        You can request up to {capPctDisplay}% of available earnings.
      </p>
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className="rounded-xl p-2 text-center"
      style={highlight
        ? { background: C.highlight, border: `1px solid ${C.gold}40` }
        : { background: 'rgba(0,0,0,0.03)' }}>
      <div className="text-[10px] uppercase tracking-wider text-sub-text">
        {label}
      </div>
      <div className="mt-0.5 font-bold"
        style={{ color: highlight ? C.gold : undefined }}>
        {value}
      </div>
    </div>
  );
}

function SessionRow({ s }) {
  const dateStr = s.createdAt?.toDate
    ? fmtDate(s.createdAt)
    : '-';
  const timeStr = s.createdAt?.toDate
    ? s.createdAt.toDate().toLocaleTimeString('en-GB',
        { hour: '2-digit', minute: '2-digit' })
    : '';
  const clientName = s.userName || s.userDisplayName || s.userId
    ? (s.userName || s.userDisplayName || `User ...${String(s.userId || '').slice(-4)}`)
    : 'Client';
  const duration = fmtDuration(s.durationSeconds || s.duration);
  const earning = Number(s.astrologerEarning || 0);
  const gross   = Number(s.cost || 0);
  const comm    = Number(s.commissionPercent || 0);

  return (
    <div className="card text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold capitalize text-dark-text">
              {s.type || 'Session'}
            </span>
            <span className="rounded-full bg-bg-light px-2 py-0.5 text-[10px]
              font-bold uppercase text-sub-text">
              {duration}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-sub-text">
            {dateStr}{timeStr ? ` at ${timeStr}` : ''} &bull; {clientName}
          </div>
          <div className="mt-1 text-[11px] text-sub-text">
            Gross Rs.{gross} &bull; Commission {comm}%
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-black" style={{ color: C.gold }}>
            Rs.{earning}
          </div>
          <div className="text-[10px] text-sub-text">earned</div>
        </div>
      </div>
    </div>
  );
}

function PayoutRow({ p }) {
  const status = p.status || 'initiated';
  const displayStatus = status === 'pending' ? 'initiated'
    : status === 'approved' ? 'completed'
    : status;

  return (
    <div className="card text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] text-sub-text">
            {fmt(p.createdAt)} &bull; {p.type === 'instant'
              ? 'Instant payout' : 'Scheduled'}
          </div>
          <div className="mt-0.5 font-mono text-lg font-black"
            style={{ color: C.gold }}>
            Rs.{p.amount || 0}
          </div>
        </div>
        <StatusChip label={displayStatus} tone={STATUS_TONE[status]} />
      </div>

      {(p.mode || p.utr) && (
        <div className="mt-2 rounded-xl bg-bg-light/40 p-2 text-[12px]">
          <b>{p.mode || '-'}</b> &bull; UTR{' '}
          <span className="font-mono">{p.utr || '-'}</span>
          {p.completedAtIso && (
            <span className="ml-1 text-sub-text">
              &bull; {new Date(p.completedAtIso).toLocaleString('en-GB',
                  { day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}

      {p.bankSnap && p.bankSnap.accountNumber && (
        <div className="mt-2 text-[11px] text-sub-text">
          Sent to {p.bankSnap.accountHolder} &bull; {p.bankSnap.bankName}{' '}
          A/C ****{String(p.bankSnap.accountNumber).slice(-4)}
        </div>
      )}

      {p.narration && (
        <div className="mt-1 text-[11px] text-sub-text">{p.narration}</div>
      )}

      {displayStatus === 'rejected' && p.adminNote && (
        <div className="mt-2 rounded-xl bg-rose-50 p-2 text-[11px]
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
          Print PDF
        </button>
      </div>
    </div>
  );
}

function StatusChip({ label, tone }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold
      uppercase ${tone || 'bg-bg-light text-sub-text'}`}>
      {label}
    </span>
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
      .amount{font-size:32px;font-weight:700;color:${C.gold};margin:24px 0 8px}
      .status{display:inline-block;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;background:#FFF8E7;color:${C.primary}}
      @media print{body{margin:16px}}
    </style></head><body>
    <h1 style="color:${C.primary}">Payout statement</h1>
    <div class="meta">Reference ${p.id} . Issued ${new Date().toLocaleString('en-GB')}</div>
    <div class="amount">Rs.${p.amount || 0}</div>
    <div class="status">${p.status}</div>
    <div style="margin-top:24px">
      <div class="row"><span class="k">Type</span><span class="v">${p.type || 'scheduled'}</span></div>
      <div class="row"><span class="k">Requested</span><span class="v">${fmt(p.createdAt)}</span></div>
      <div class="row"><span class="k">Mode</span><span class="v">${p.mode || '-'}</span></div>
      <div class="row"><span class="k">UTR / Ref</span><span class="v">${p.utr || '-'}</span></div>
      <div class="row"><span class="k">Completed</span><span class="v">${p.completedAtIso ? new Date(p.completedAtIso).toLocaleString('en-GB') : '-'}</span></div>
      <div class="row"><span class="k">Account holder</span><span class="v">${b.accountHolder || '-'}</span></div>
      <div class="row"><span class="k">Bank</span><span class="v">${b.bankName || '-'}</span></div>
      <div class="row"><span class="k">A/C</span><span class="v">${b.accountNumber || '-'}</span></div>
      <div class="row"><span class="k">IFSC</span><span class="v">${b.ifsc || '-'}</span></div>
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
  const capPctDisplay = Math.round((quote.capPct || 0.7) * 100);

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
      bg-black/40 p-3 sm:items-center"
      onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}>

        {/* Modal header accent */}
        <div className="mb-4 flex items-center gap-2">
          <div className="h-1 w-8 rounded-full"
            style={{ background: C.primary }} />
          <h3 className="text-base font-bold text-dark-text">
            {step === 'amount' ? 'Request Instant Payout'
              : 'Confirm Transfer Details'}
          </h3>
        </div>

        {!bankReady ? (
          <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs
            text-rose-800">
            Add your bank details on your profile before requesting a
            payout. Required fields: account holder, bank name, account
            number, IFSC.
          </div>
        ) : step === 'amount' ? (
          <div className="space-y-3">
            <p className="text-[12px] text-sub-text">
              Maximum:{' '}
              <b style={{ color: C.gold }}>Rs.{quote.instantMax}</b>{' '}
              ({capPctDisplay}% of your Rs.{quote.available} available balance).
            </p>
            <input type="number" className="input text-2xl font-bold"
              value={amount} max={quote.instantMax}
              onChange={(e) => setAmount(e.target.value)} />
            {err && (
              <div className="rounded-xl bg-rose-50 p-2 text-xs
                text-rose-700">{err}</div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={onClose}
                className="rounded-full px-4 py-2 text-sm font-semibold
                  text-sub-text hover:bg-bg-light">
                Cancel
              </button>
              <button onClick={() => setStep('confirm')}
                disabled={!amount || Number(amount) <= 0
                  || Number(amount) > quote.instantMax}
                className="rounded-full px-4 py-2 text-sm font-bold
                  text-white disabled:opacity-50"
                style={{ background: C.primary }}>
                Continue
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-sub-text">
              The admin will transfer this amount to the bank account
              below via NEFT / RTGS within 24 hours. Bank details are{' '}
              <b>locked</b> on this request and cannot be changed after
              submission.
            </p>
            <div className="rounded-xl bg-bg-light/40 p-3 text-sm">
              <Row k="Amount" v={`Rs.${amount}`} bold />
              <Row k="Account holder" v={bank.accountHolder} />
              <Row k="Bank" v={bank.bankName} />
              <Row k="A/C number" v={bank.accountNumber} mono />
              <Row k="IFSC" v={bank.ifsc} mono />
              {bank.branch && <Row k="Branch" v={bank.branch} />}
              {bank.upi && <Row k="UPI (fallback)" v={bank.upi} mono />}
            </div>
            {err && (
              <div className="rounded-xl bg-rose-50 p-2 text-xs
                text-rose-700">{err}</div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setStep('amount')}
                className="rounded-full px-4 py-2 text-sm font-semibold
                  text-sub-text hover:bg-bg-light">
                Back
              </button>
              <button onClick={submit} disabled={busy}
                className="rounded-full px-4 py-2 text-sm font-bold
                  text-white disabled:opacity-50"
                style={{ background: C.primary }}>
                {busy ? 'Submitting...' : `Confirm Rs.${amount}`}
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
        ${mono ? 'font-mono' : ''} text-dark-text`}>
        {v}
      </span>
    </div>
  );
}
