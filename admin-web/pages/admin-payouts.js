import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  payoutService, astrologerService, rupees, db,
} from '@astro/shared';
import {
  collection, onSnapshot, query, orderBy, limit,
} from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Payout Management - blueprint Phase A / B / D rewrite (2026-06-06).
//
// Operator: "Currently this is like this one of the worst in the admin
// so do it as I said above" - referring to the spec for payment
// scheduling, instant request, lifecycle workflow with mode + UTR +
// receipt, KYC, audit, restore.
//
// Layout:
//  - Top: summary tiles (Initiated / Processing / Completed / Rejected
//    totals + counts, KYC pending count, Schedule chip).
//  - Tabs filter by lifecycle status. "Schedule" tab is the global
//    payout-schedule configurator (Phase A).
//  - Each row carries the astrologer's name + code + bank snap +
//    KYC chip + Process / Complete / Reject buttons that open
//    focused modals.
//  - Mobile-first: row card stacks under md; table at md+.

const TABS = [
  { id: 'initiated',  label: 'Initiated',  tone: 'bg-amber-100 text-amber-800' },
  { id: 'processing', label: 'Processing', tone: 'bg-sky-100 text-sky-700' },
  { id: 'completed',  label: 'Completed',  tone: 'bg-emerald-100 text-emerald-700' },
  { id: 'rejected',   label: 'Rejected',   tone: 'bg-rose-100 text-rose-700' },
  { id: 'schedule',   label: 'Schedule',   tone: 'bg-violet-100 text-violet-700' },
];

function fmt(ts) {
  if (!ts) return '–';
  const ms = ts.toMillis ? ts.toMillis()
    : ts.seconds ? ts.seconds * 1000 : 0;
  if (!ms) return '–';
  return new Date(ms).toLocaleString('en-GB',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AdminPayouts() {
  const { loading, user } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [astros, setAstros] = useState({});
  const [tab, setTab] = useState('initiated');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | {kind, payout}

  // Live subscribe to payouts so the page repaints when astro app
  // creates a new request or another admin processes one.
  useEffect(() => {
    if (loading) return undefined;
    const unsub = onSnapshot(query(collection(db, 'payouts'),
      orderBy('createdAt', 'desc'), limit(500)),
      (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setRows([]));
    return () => unsub();
  }, [loading]);

  // Lazy-load every astrologer that appears in the payouts feed so we
  // can render their name + code + KYC chip without a per-row read.
  useEffect(() => {
    if (!rows) return;
    const ids = [...new Set(rows.map((r) => r.astroId).filter(Boolean))];
    ids.forEach((id) => {
      if (astros[id] !== undefined) return;
      setAstros((cur) => ({ ...cur, [id]: null }));
      astrologerService.getAstrologer(id).then((a) => {
        setAstros((cur) => ({ ...cur, [id]: a || {} }));
      }).catch(() => setAstros((cur) => ({ ...cur, [id]: {} })));
    });
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Treat the legacy 'pending' status as 'initiated' so older payouts
  // from the previous version of this page still surface in the
  // first tab.
  function normaliseStatus(s) {
    if (s === 'pending') return 'initiated';
    if (s === 'approved') return 'completed';
    return s || 'initiated';
  }

  const enriched = useMemo(() => (rows || []).map((r) => ({
    ...r,
    _status: normaliseStatus(r.status),
    _astro: astros[r.astroId] || null,
  })), [rows, astros]);

  const totals = useMemo(() => {
    const t = { initiated: { n: 0, sum: 0 }, processing: { n: 0, sum: 0 },
      completed: { n: 0, sum: 0 }, rejected: { n: 0, sum: 0 } };
    enriched.forEach((r) => {
      const k = r._status;
      if (!t[k]) return;
      t[k].n += 1; t[k].sum += Number(r.amount || 0);
    });
    return t;
  }, [enriched]);

  const filtered = useMemo(() => {
    if (tab === 'schedule') return [];
    const term = search.trim().toLowerCase();
    return enriched.filter((r) => {
      if (r._status !== tab) return false;
      if (!term) return true;
      const a = r._astro || {};
      return [r.id, r.amount, r.utr, r.mode, r.bankSnap?.accountHolder,
        r.bankSnap?.bankName, r.bankSnap?.ifsc, r.bankSnap?.upi,
        a.name, a.email, a.userCode]
        .filter(Boolean).map((x) => String(x).toLowerCase())
        .some((x) => x.includes(term));
    });
  }, [enriched, tab, search]);

  if (loading || rows == null) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <header className="mb-3">
        <h1 className="text-2xl font-bold text-dark-text">
          Payout management
        </h1>
        <p className="mt-0.5 text-sm text-sub-text">
          Initiated by the astrologer (Instant payout - 70 percent
          cap) or by the admin (scheduled run). Move each request
          through Processing - Completed / Rejected with Mode + UTR
          + receipt. Astrologers see status + Mode + UTR; the
          receipt stays internal.
        </p>
      </header>

      {/* Summary tiles */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TABS.filter((t) => t.id !== 'schedule').map((t) => (
          <Tile key={t.id} tone={t.tone} active={tab === t.id}
            label={t.label}
            value={rupees(totals[t.id]?.sum || 0)}
            sub={`${totals[t.id]?.n || 0} requests`}
            onClick={() => setTab(t.id)} />
        ))}
      </div>

      {/* Tab strip */}
      <div className="surface mb-3 flex flex-wrap items-center gap-2 p-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold
              transition ${tab === t.id
                ? 'bg-primary text-white'
                : 'bg-bg-light text-sub-text hover:bg-gray-200'}`}>
            {t.label}
            {t.id !== 'schedule' && (
              <span className="ml-1 opacity-70">
                {totals[t.id]?.n || 0}
              </span>
            )}
          </button>
        ))}
        {tab !== 'schedule' && (
          <input className="input ml-auto max-w-xs"
            placeholder="Search astrologer, UTR, IFSC, mode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)} />
        )}
      </div>

      {tab === 'schedule' ? (
        <ScheduleEditor />
      ) : filtered.length === 0 ? (
        <div className="card text-sub-text">
          No <b>{tab}</b> payouts.
          {tab === 'initiated'
            && ' When an astrologer taps "Request Payout" in their'
              + ' app the request lands here.'}
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((r) => (
              <RowCard key={r.id} r={r}
                onAct={(kind) => setModal({ kind, payout: r })} />
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-card border
            border-gray-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-light text-left text-[11px]
                uppercase tracking-wider text-sub-text">
                <tr>
                  <th className="p-3">Requested</th>
                  <th className="p-3">Astrologer</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3">Bank snapshot</th>
                  <th className="p-3">Mode + UTR</th>
                  <th className="p-3">KYC</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <Row key={r.id} r={r}
                    onAct={(kind) => setModal({ kind, payout: r })} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modal && (
        <ActionModal modal={modal}
          onClose={() => setModal(null)}
          adminUid={user?.uid || ''}
          onDone={() => { setModal(null); flash('Updated.', 'success'); }}
        />
      )}
    </Layout>
  );
}

// ---- Tile -----------------------------------------------------------
function Tile({ tone, label, value, sub, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`text-left rounded-2xl border-2 p-3 transition
        ${active ? 'border-primary bg-primary/5'
          : 'border-transparent bg-white hover:bg-bg-light/40'}`}>
      <div className={`inline-flex rounded-full px-2 py-0.5 text-[10px]
        font-bold uppercase tracking-wider ${tone}`}>{label}</div>
      <div className="mt-2 text-xl font-bold text-dark-text">{value}</div>
      <div className="text-[11px] text-sub-text">{sub}</div>
    </button>
  );
}

// ---- Row (desktop) --------------------------------------------------
function Row({ r, onAct }) {
  const a = r._astro || {};
  const b = r.bankSnap || {};
  const kycOk = a && a.kyc && a.kyc.status === 'approved';
  return (
    <tr className="border-t border-gray-100 align-top hover:bg-bg-light/40">
      <td className="p-3 text-xs">
        {fmt(r.createdAt)}
        <div className="text-[10px] text-sub-text">
          {r.type === 'instant' ? 'Instant (70% rule)' : 'Scheduled'}
        </div>
      </td>
      <td className="p-3">
        {a ? (
          <>
            <div className="font-bold text-dark-text">
              <Link href={`/admin-user-profile/${r.astroId}`}
                className="hover:underline">{a.name || '(unknown)'}</Link>
            </div>
            <div className="text-[11px] text-sub-text">
              {a.email}{a.userCode && (
                <span className="ml-1 rounded bg-gray-100 px-1
                  font-mono text-[9px]">{a.userCode}</span>
              )}
            </div>
          </>
        ) : <span className="text-[11px] text-sub-text">resolving…</span>}
      </td>
      <td className="p-3 text-right">
        <div className="font-mono text-lg font-bold text-dark-text">
          {rupees(r.amount || 0)}
        </div>
      </td>
      <td className="p-3 text-[11px]">
        {b.accountHolder ? (
          <div className="space-y-0.5">
            <div className="font-bold text-dark-text">{b.accountHolder}</div>
            <div className="text-sub-text">{b.bankName}</div>
            <div className="font-mono text-[10px] text-sub-text">
              A/C {b.accountNumber} · IFSC {b.ifsc}
            </div>
            {b.branch && <div className="text-[10px] text-sub-text">{b.branch}</div>}
          </div>
        ) : r.bankDetails ? (
          <span className="font-mono text-[10px] text-sub-text">
            {r.bankDetails}
          </span>
        ) : <span className="text-sub-text">–</span>}
      </td>
      <td className="p-3 text-[11px]">
        {r.mode || r.utr ? (
          <div>
            <div className="font-bold">{r.mode || '–'}</div>
            <div className="font-mono text-[10px]">{r.utr || '–'}</div>
            {r.completedAtIso && (
              <div className="text-[10px] text-sub-text">
                {new Date(r.completedAtIso).toLocaleString('en-GB')}
              </div>
            )}
          </div>
        ) : '–'}
      </td>
      <td className="p-3">
        <span className={`rounded-full px-2 py-0.5 text-[10px]
          font-bold uppercase ${kycOk
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-rose-100 text-rose-700'}`}>
          {kycOk ? 'KYC ok' : 'KYC pending'}
        </span>
      </td>
      <td className="p-3 text-right text-[11px]">
        <RowActions r={r} onAct={onAct} />
      </td>
    </tr>
  );
}

// ---- Row card (mobile) ---------------------------------------------
function RowCard({ r, onAct }) {
  const a = r._astro || {};
  const b = r.bankSnap || {};
  const kycOk = a && a.kyc && a.kyc.status === 'approved';
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-sub-text">{fmt(r.createdAt)}</div>
          <div className="text-base font-bold text-dark-text">
            {a ? (
              <Link href={`/admin-user-profile/${r.astroId}`}
                className="hover:underline">{a.name || '(unknown)'}</Link>
            ) : 'resolving…'}
          </div>
          <div className="text-[11px] text-sub-text">
            {a?.email}
            {a?.userCode && (
              <span className="ml-1 rounded bg-gray-100 px-1
                font-mono text-[9px]">{a.userCode}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-bold text-dark-text">
            {rupees(r.amount || 0)}
          </div>
          <div className="text-[9px] uppercase tracking-wider
            text-sub-text">
            {r.type === 'instant' ? 'Instant' : 'Scheduled'}
          </div>
        </div>
      </div>
      {(b.accountHolder || r.bankDetails) && (
        <div className="mt-2 rounded-card bg-bg-light/40 p-2 text-[11px]">
          {b.accountHolder ? (
            <>
              <div className="font-bold">{b.accountHolder}</div>
              <div className="text-sub-text">{b.bankName}</div>
              <div className="font-mono text-[10px]">
                A/C {b.accountNumber} · IFSC {b.ifsc}
              </div>
              {b.upi && <div className="text-[10px]">UPI {b.upi}</div>}
            </>
          ) : (
            <div className="font-mono text-[10px]">{r.bankDetails}</div>
          )}
        </div>
      )}
      {(r.mode || r.utr) && (
        <div className="mt-2 text-[11px]">
          <b>{r.mode}</b> · UTR <span className="font-mono">{r.utr}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px]
          font-bold uppercase ${kycOk
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-rose-100 text-rose-700'}`}>
          {kycOk ? 'KYC ok' : 'KYC pending'}
        </span>
        <div className="ml-auto"><RowActions r={r} onAct={onAct} /></div>
      </div>
    </div>
  );
}

function RowActions({ r, onAct }) {
  if (r._status === 'initiated') {
    return (
      <div className="inline-flex flex-wrap gap-1">
        <Btn label="Process" tone="primary"
          onClick={() => onAct('process')} />
        <Btn label="Reject" tone="rose" onClick={() => onAct('reject')} />
      </div>
    );
  }
  if (r._status === 'processing') {
    return (
      <div className="inline-flex flex-wrap gap-1">
        <Btn label="Mark complete" tone="emerald"
          onClick={() => onAct('complete')} />
        <Btn label="Reject" tone="rose" onClick={() => onAct('reject')} />
      </div>
    );
  }
  if (r._status === 'completed') {
    return <Btn label="Receipt" tone="ghost"
      onClick={() => onAct('view-receipt')} />;
  }
  return <span className="text-[10px] text-sub-text">
    {r.adminNote || '–'}</span>;
}
function Btn({ label, tone, onClick }) {
  const tones = {
    primary: 'bg-primary text-white hover:opacity-90',
    emerald: 'bg-emerald-600 text-white hover:bg-emerald-700',
    rose:    'border border-rose-200 text-rose-700 hover:bg-rose-50',
    ghost:   'border border-gray-200 text-sub-text hover:bg-bg-light',
  };
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1 text-[11px] font-bold
        ${tones[tone] || tones.ghost}`}>{label}</button>
  );
}

// ---- Action modal --------------------------------------------------
function ActionModal({ modal, onClose, adminUid, onDone }) {
  const { kind, payout } = modal;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('NEFT');
  const [utr, setUtr] = useState('');
  const [datetime, setDt] = useState(
    new Date().toISOString().slice(0, 16));
  const [receiptUrl, setReceipt] = useState('');
  const [narration, setNarration] = useState('');
  const [reason, setReason] = useState('');

  async function run() {
    setBusy(true); setErr('');
    try {
      if (kind === 'process') {
        await payoutService.markProcessing(payout.id, adminUid);
      } else if (kind === 'complete') {
        await payoutService.completePayout(payout.id, {
          mode, utr, datetime, receiptUrl, narration, by: adminUid });
      } else if (kind === 'reject') {
        await payoutService.rejectPayout(payout.id, reason, adminUid);
      }
      onDone && onDone();
    } catch (e) {
      setErr(String((e && e.message) || e));
    } finally { setBusy(false); }
  }

  const titles = {
    process: 'Move to Processing',
    complete: 'Mark as Completed',
    reject: 'Reject payout',
    'view-receipt': 'Receipt',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
      bg-black/40 p-3" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4
        shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2">
          <h3 className="text-base font-bold text-dark-text">
            {titles[kind] || 'Payout action'}
          </h3>
          <p className="mt-0.5 text-[11px] text-sub-text">
            {rupees(payout.amount)} to{' '}
            {payout.bankSnap?.accountHolder || 'astrologer'}
          </p>
        </div>

        {kind === 'process' && (
          <p className="text-sm text-sub-text">
            Astrologer will see status change from <b>Initiated</b>{' '}
            to <b>Processing</b>. Once you mark the bank transfer
            done, come back and click <b>Mark complete</b> with the
            UTR.
          </p>
        )}

        {kind === 'complete' && (
          <div className="space-y-3">
            <Field label="Payment mode">
              <div className="flex flex-wrap gap-1.5">
                {['NEFT', 'RTGS', 'UPI', 'IMPS'].map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`rounded-full border px-3 py-1 text-xs
                      font-bold ${mode === m
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-200 text-sub-text'}`}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="UTR / Reference number">
              <input className="input" value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="HDFC123456789" />
            </Field>
            <Field label="Date + time of transfer">
              <input type="datetime-local" className="input"
                value={datetime}
                onChange={(e) => setDt(e.target.value)} />
            </Field>
            <Field label="Receipt URL (internal only)">
              <input className="input" value={receiptUrl}
                onChange={(e) => setReceipt(e.target.value)}
                placeholder="https://… (not shown to astrologer)" />
            </Field>
            <Field label="Narration (visible to astrologer)">
              <input className="input" value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="Sep 2026 payout" />
            </Field>
          </div>
        )}

        {kind === 'reject' && (
          <Field label="Rejection reason">
            <textarea className="input" rows={2} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="KYC not approved, bank details incorrect, etc." />
          </Field>
        )}

        {kind === 'view-receipt' && (
          payout.receiptUrl ? (
            <a href={payout.receiptUrl} target="_blank" rel="noopener
              noreferrer" className="block break-all rounded-card
              bg-bg-light p-3 text-xs text-primary hover:underline">
              {payout.receiptUrl}
            </a>
          ) : (
            <div className="rounded-card bg-bg-light p-3 text-sm
              text-sub-text">No receipt uploaded.</div>
          )
        )}

        {err && (
          <div className="mt-2 rounded-card bg-rose-50 p-2 text-xs
            text-rose-700">{err}</div>
        )}

        {kind !== 'view-receipt' && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={onClose} disabled={busy}
              className="rounded-full px-4 py-2 text-sm font-semibold
                text-sub-text hover:bg-bg-light disabled:opacity-50">
              Cancel
            </button>
            <button onClick={run} disabled={busy}
              className="rounded-full bg-primary px-4 py-2 text-sm
                font-bold text-white disabled:opacity-50">
              {busy ? 'Working…'
                : kind === 'reject' ? 'Reject'
                : kind === 'complete' ? 'Mark complete'
                : 'Move to processing'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider
        text-sub-text">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ---- Phase A: Schedule editor --------------------------------------
function ScheduleEditor() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    payoutService.getGlobalSchedule().then(setS);
  }, []);
  async function save() {
    setBusy(true); setMsg('');
    try {
      await payoutService.setGlobalSchedule(s);
      setMsg('Saved.');
    } catch (e) {
      setMsg(String((e && e.message) || e));
    } finally { setBusy(false); }
  }
  if (!s) return <div className="card">Loading schedule…</div>;
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return (
    <div className="surface p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider
        text-sub-text">Global payout schedule</h2>
      <p className="mt-0.5 text-[11px] text-sub-text">
        Applies to every astrologer unless a per-astrologer override
        is set on their profile. Current rule:
        <b className="ml-1">{payoutService.describeSchedule(s)}</b>
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Frequency">
          <select className="input" value={s.frequency}
            onChange={(e) => setS({ ...s, frequency: e.target.value })}>
            <option value="monthly">Monthly (specific day)</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="fixed">Same fixed day each month</option>
          </select>
        </Field>
        <Field label="Active">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.active !== false}
              onChange={(e) => setS({ ...s, active: e.target.checked })} />
            Auto-process on schedule
          </label>
        </Field>
        {s.frequency === 'monthly' && (
          <Field label="Day of month">
            <input type="number" min={1} max={31} className="input"
              value={s.dayOfMonth || 1}
              onChange={(e) => setS({ ...s,
                dayOfMonth: Number(e.target.value) })} />
          </Field>
        )}
        {(s.frequency === 'weekly' || s.frequency === 'biweekly') && (
          <Field label="Day of week">
            <div className="flex flex-wrap gap-1.5">
              {dows.map((d, i) => (
                <button key={d} type="button"
                  onClick={() => setS({ ...s, dayOfWeek: i })}
                  className={`rounded-full border px-3 py-1 text-xs
                    font-bold ${s.dayOfWeek === i
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 text-sub-text'}`}>
                  {d}
                </button>
              ))}
            </div>
          </Field>
        )}
        {s.frequency === 'fixed' && (
          <Field label="Anchor date (day-of-month derived)">
            <input type="date" className="input"
              value={s.anchorIso || ''}
              onChange={(e) => setS({ ...s, anchorIso: e.target.value })} />
          </Field>
        )}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button onClick={save} disabled={busy}
          className="rounded-full bg-primary px-4 py-2 text-sm
            font-bold text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Save schedule'}
        </button>
        {msg && (
          <span className="text-xs text-sub-text">{msg}</span>
        )}
      </div>
      <p className="mt-4 text-[11px] text-sub-text">
        Per-astrologer override is available from each astrologer's
        admin profile (Payout schedule section). The override wins
        for that astrologer; the global rule applies to everyone
        else.
      </p>
    </div>
  );
}
