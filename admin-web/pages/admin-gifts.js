import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000
      : ts && ts._seconds ? ts._seconds * 1000 : 0;
    if (!ms) return '-';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return '-'; }
}
function parseUa(ua) {
  if (!ua) return 'Unknown device';
  const s = String(ua);
  const os = /Windows/i.test(s) ? 'Windows'
    : /Android/i.test(s) ? 'Android'
    : /iPhone|iPad|iOS/i.test(s) ? 'iOS'
    : /Mac OS X/i.test(s) ? 'macOS'
    : /Linux/i.test(s) ? 'Linux' : 'Unknown OS';
  const br = /Edg\//i.test(s) ? 'Edge'
    : /Chrome\//i.test(s) ? 'Chrome'
    : /Firefox\//i.test(s) ? 'Firefox'
    : /Safari\//i.test(s) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

export default function AdminGifts() {
  const { loading } = useRequireAdmin();
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState(null);
  const [cards, setCards] = useState([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | unused | used
  const [openCode, setOpenCode] = useState(null);

  async function refresh() {
    try { setCards(await adminService.listGiftCards() || []); }
    catch (_) { setCards([]); }
  }
  useEffect(() => { if (!loading) refresh(); }, [loading]);

  async function create() {
    setBusy(true); setMsg(''); setLast(null);
    try {
      const r = await adminService.createGiftCard(amount);
      setLast(r);
      setMsg(`Gift card for Rs ${r.amount} created.`);
      flash(`Gift card ${r.code} created`);
      refresh();
    } catch (e) {
      setMsg(`Failed: ${e?.message || 'error'}`);
    } finally { setBusy(false); }
  }

  if (loading) return <Layout><div className="card">Loading...</div></Layout>;

  const filtered = (cards || []).filter((c) => {
    if (filter === 'used' && !c.redeemed) return false;
    if (filter === 'unused' && c.redeemed) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (c.code || '').toLowerCase().includes(s)
      || (c.redeemedByEmail || '').toLowerCase().includes(s)
      || (c.redeemedByName || '').toLowerCase().includes(s)
      || (c.redeemedBy || '').toLowerCase().includes(s)
      || String(c.amount || '').includes(s)
      || (c.redeemedIp || '').includes(s);
  });

  return (
    <Layout>
      <h1 className="mb-3 text-xl font-bold">Gift Cards</h1>

      {/* CREATE */}
      <div className="card mb-4 space-y-3">
        <label className="text-sm font-semibold">Amount (Rs)</label>
        <input className="input" type="number" min={1} value={amount}
          onChange={(e) => setAmount(e.target.value === '' ? ''
            : Number(e.target.value))} />
        <button onClick={create} disabled={busy || !(amount > 0)}
          className="btn-primary w-full">
          {busy ? 'Generating...' : 'Generate gift card'}
        </button>
        {msg && (
          <div className="rounded-card bg-success/10 p-3 text-success">
            {msg}
          </div>
        )}
        {last && (
          <div className="rounded-card border-2 border-dashed
            border-primary p-4 text-center">
            <div className="text-xs text-sub-text">Share this code</div>
            <div className="mt-1 text-2xl font-bold tracking-widest">
              {last.code}
            </div>
            <div className="mt-1 text-sm">Worth Rs {last.amount}</div>
          </div>
        )}
      </div>

      {/* SEARCH + FILTER */}
      <div className="card mb-3 flex flex-wrap items-center gap-2">
        <input className="input flex-1" placeholder="Search by code,
          redeemer email/name/uid, IP, or amount"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="inline-flex rounded-full bg-bg-light p-1
          text-xs font-bold">
          {['all', 'unused', 'used'].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 capitalize ${
                filter === f ? 'bg-white text-primary shadow-sm'
                : 'text-sub-text'}`}>
              {f}
            </button>
          ))}
        </div>
        <button onClick={refresh}
          className="rounded-full bg-primary px-3 py-1.5 text-xs
            font-bold text-white">Refresh</button>
      </div>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide
        text-sub-text">
        Gift cards ({filtered.length}{filtered.length !== cards.length
          ? ` of ${cards.length}` : ''})
      </h2>
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="card text-sub-text">No gift cards match.</div>
        ) : filtered.map((c) => (
          <div key={c.code} className="card">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-base font-bold tracking-widest
                  text-dark-text">
                  {c.code}
                </div>
                <div className="text-xs text-sub-text">
                  Rs {c.amount}
                  {c.redeemedAt
                    ? ` · used ${fmt(c.redeemedAt)}` : ''}
                  {c.redeemedByEmail
                    ? ` · by ${c.redeemedByEmail}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px]
                  font-bold ${c.redeemed
                    ? 'bg-danger/15 text-danger'
                    : 'bg-success/15 text-success'}`}>
                  {c.redeemed ? 'Used' : 'Active'}
                </span>
                <button onClick={() => setOpenCode(
                  openCode === c.code ? null : c.code)}
                  className="rounded-full bg-bg-light px-3 py-1.5
                    text-xs font-bold text-primary">
                  {openCode === c.code ? 'Hide' : 'View'}
                </button>
              </div>
            </div>

            {openCode === c.code && (
              <div className="mt-3 rounded-card border border-gray-200
                p-3 text-sm">
                <Row k="Code" v={c.code} mono />
                <Row k="Amount" v={`Rs ${c.amount}`} />
                <Row k="Status" v={c.redeemed ? 'Used' : 'Active'} />
                <Row k="Created" v={fmt(c.createdAt)} />
                {c.redeemed && (
                  <>
                    <div className="my-2 border-t border-gray-100" />
                    <div className="text-xs font-bold uppercase
                      tracking-wider text-sub-text">
                      Who redeemed (compliance)
                    </div>
                    <Row k="Redeemed at" v={fmt(c.redeemedAt)} />
                    <Row k="User name"
                      v={c.redeemedByName || '-'} />
                    <Row k="User email"
                      v={c.redeemedByEmail || '-'} />
                    <Row k="User UID"
                      v={c.redeemedBy || '-'} mono />
                    <Row k="IP address"
                      v={c.redeemedIp || '-'} mono />
                    <Row k="Device"
                      v={parseUa(c.redeemedUa)} />
                    {c.redeemedUa && (
                      <div className="mt-1 break-all rounded bg-bg-light
                        p-2 font-mono text-[10px] text-sub-text">
                        {c.redeemedUa}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-sub-text">
        Customers and astrologers never see this compliance information.
        It is admin-only for fraud / abuse review.
      </p>
    </Layout>
  );
}

const Row = ({ k, v, mono = false }) => (
  <div className="flex flex-wrap gap-1 py-0.5 text-sm">
    <span className="w-32 shrink-0 text-sub-text">{k}</span>
    <span className={`flex-1 ${mono ? 'font-mono text-[12px]'
      : 'font-semibold'}`}>{v}</span>
  </div>
);
