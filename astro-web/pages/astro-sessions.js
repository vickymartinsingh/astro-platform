import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { sessionService, userService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAstrologer } from '../lib/useAuth';

const { REFUND_REASONS, sessionRefNo } = sessionService;

const STATUS_TABS = ['All', 'Active', 'Ended', 'Missed', 'Cancelled'];

const TYPE_ICONS = {
  chat: '💬',
  call: '📞',
  video: '🎥',
};

function StatusChip({ status }) {
  const map = {
    active:    'bg-emerald-100 text-emerald-800',
    ended:     'bg-gray-100 text-gray-700',
    missed:    'bg-amber-100 text-amber-800',
    cancelled: 'bg-rose-100 text-rose-700',
    requesting:'bg-blue-100 text-blue-700',
  };
  const cls = map[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`badge capitalize ${cls}`}>{status}</span>
  );
}

function RefundChip({ s }) {
  const rr = s.refundRequest;
  if (!rr) return null;
  if (rr.status === 'processed') {
    return (
      <span className="badge bg-emerald-100 text-emerald-700">Refunded</span>
    );
  }
  if (rr.status === 'pending') {
    return (
      <span className="badge bg-amber-100 text-amber-700">Refund pending</span>
    );
  }
  return null;
}

function SkeletonCard() {
  return (
    <div className="surface p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="skeleton h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <div className="skeleton h-4 w-32 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
        </div>
        <div className="skeleton h-6 w-16 rounded-full" />
      </div>
      <div className="flex gap-6">
        <div className="skeleton h-3 w-14 rounded" />
        <div className="skeleton h-3 w-14 rounded" />
        <div className="skeleton h-3 w-14 rounded" />
      </div>
      <div className="flex gap-2">
        <div className="skeleton h-8 w-20 rounded-full" />
        <div className="skeleton h-8 w-20 rounded-full" />
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export default function AstroSessions() {
  const router = useRouter();
  const { user, loading } = useRequireAstrologer();
  const [rows, setRows] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('All');

  // Refund modal state
  const [rfSession, setRfSession] = useState(null);
  const [rfReason, setRfReason] = useState(REFUND_REASONS[0]);
  const [rfNote, setRfNote] = useState('');
  const [rfBusy, setRfBusy] = useState(false);

  // Toast banner
  const [toast, setToast] = useState(null);

  async function load() {
    const list = await sessionService.getAstrologerSessions(user.uid);
    const withNames = await Promise.all(
      list.map(async (s) => ({
        ...s,
        client: (await userService.getUser(s.userId))?.name,
      })),
    );
    setRows(withNames);
  }

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function submitRefund() {
    if (!rfSession) return;
    setRfBusy(true);
    try {
      const reason =
        rfReason === 'Other' && rfNote.trim()
          ? `Other: ${rfNote.trim()}`
          : rfReason;
      const r = await sessionService.instantRefund(rfSession.id, reason);
      setRfSession(null);
      setRfNote('');
      setRfReason(REFUND_REASONS[0]);
      await load();
      const msg = r.ok
        ? r.already
          ? 'This session was already refunded.'
          : `Refund processed instantly. Rs.${r.refunded} credited to the customer wallet. Admin has been notified for records.`
        : 'Refund queued - admin will process within a few minutes.';
      setToast({ kind: 'ok', msg });
      setTimeout(() => setToast(null), 6000);
    } catch (e) {
      setToast({
        kind: 'err',
        msg: `Could not submit the refund: ${e.message || 'error'}`,
      });
    }
    setRfBusy(false);
  }

  const cutoff = Date.now() - 7 * 7 * 864e5;

  const filtered = useMemo(() => {
    if (!rows) return [];
    let list = showAll
      ? rows
      : rows.filter(
          (s) =>
            s.createdAt?.toDate &&
            s.createdAt.toDate().getTime() >= cutoff,
        );
    if (activeTab !== 'All') {
      list = list.filter(
        (s) => s.status?.toLowerCase() === activeTab.toLowerCase(),
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) => (s.client || '').toLowerCase().includes(q));
    }
    return list;
  }, [rows, showAll, activeTab, search, cutoff]);

  const totalEarned = useMemo(
    () => (rows || []).reduce((sum, s) => sum + (s.astrologerEarning || 0), 0),
    [rows],
  );

  if (loading || rows == null) {
    return (
      <Layout>
        <div className="mx-auto max-w-2xl space-y-4 p-4">
          <div className="skeleton h-8 w-48 rounded" />
          <div className="skeleton h-10 w-full rounded-card" />
          <div className="skeleton h-10 w-full rounded-card" />
          <SkeletonList />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-4">

        {/* Header */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-dark-text">My Sessions</h1>
            <p className="mt-0.5 text-sm text-sub-text">
              {rows.length} session{rows.length !== 1 ? 's' : ''} total
              {' '}&middot;{' '}
              <span className="font-semibold text-success">
                Rs.{totalEarned} earned
              </span>
            </p>
          </div>
          {!showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="btn-ghost px-4 py-2 text-sm"
            >
              Show full history
            </button>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={`mb-4 flex items-start justify-between rounded-card p-3
              text-sm shadow-sm ${
                toast.kind === 'err'
                  ? 'border border-rose-200 bg-rose-50 text-rose-800'
                  : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
          >
            <span className="pr-2">{toast.msg}</span>
            <button
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              className="shrink-0 text-current/60 hover:text-current"
            >
              &times;
            </button>
          </div>
        )}

        {/* Search box */}
        <div className="relative mb-3">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sub-text">
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <circle
                cx="9"
                cy="9"
                r="6.5"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M14 14L18 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            type="search"
            className="input pl-9"
            placeholder="Search by client name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Status filter tabs */}
        <div
          className="mb-4 flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Filter by status"
        >
          {STATUS_TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab)}
                className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold
                  transition-colors focus:outline-none focus-visible:ring-2
                  focus-visible:ring-primary ${
                    isActive
                      ? 'border-transparent text-white'
                      : 'border-gray-200 bg-white text-sub-text hover:border-primary hover:text-primary'
                  }`}
                style={
                  isActive
                    ? { backgroundColor: '#7F2020' }
                    : {}
                }
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* Session list */}
        {filtered.length === 0 ? (
          <div className="surface flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="text-4xl" aria-hidden="true">
              {search ? '🔍' : '📭'}
            </span>
            <p className="font-semibold text-dark-text">
              {search
                ? `No sessions matching "${search}"`
                : activeTab !== 'All'
                ? `No ${activeTab.toLowerCase()} sessions`
                : 'No sessions yet'}
            </p>
            <p className="max-w-xs text-sm text-sub-text">
              {search
                ? 'Try a different name or clear the search.'
                : activeTab !== 'All'
                ? 'Switch to "All" to see your full history.'
                : 'Your completed consultations will appear here once clients book with you.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((s) => {
              const rr = s.refundRequest;
              const inProgress =
                s.status === 'requesting' || s.status === 'active';
              const canRefund =
                !inProgress && (!rr || rr.status !== 'processed');
              const durationMins = Math.round((s.duration || 0) / 60);
              const typeIcon = TYPE_ICONS[s.type] || '🔮';

              return (
                <div
                  key={s.id}
                  className="surface p-4"
                  role="article"
                  aria-label={`Session with ${s.client || 'client'}`}
                >
                  {/* Card header row */}
                  <div className="flex items-start gap-3">
                    {/* Type icon circle */}
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center
                        rounded-full text-lg"
                      style={{ background: '#FBF7EE', border: '1px solid #e5d9c8' }}
                      aria-hidden="true"
                    >
                      {typeIcon}
                    </div>

                    {/* Name + ref */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-dark-text">
                        {s.client || 'Unknown client'}
                      </p>
                      <p className="font-mono text-xs text-sub-text">
                        #{sessionRefNo(s)} &middot;{' '}
                        <span className="capitalize">{s.type}</span>
                      </p>
                    </div>

                    {/* Status chip */}
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusChip status={s.status} />
                      <RefundChip s={s} />
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    <span className="text-sub-text">
                      <span className="font-medium text-dark-text">
                        {durationMins}m
                      </span>
                      {' '}duration
                    </span>
                    <span className="text-sub-text">
                      Gross{' '}
                      <span className="font-medium text-dark-text">
                        Rs.{s.cost || 0}
                      </span>
                    </span>
                    <span className="text-sub-text">
                      Earned{' '}
                      <span className="font-semibold text-success">
                        Rs.{s.astrologerEarning || 0}
                      </span>
                    </span>
                  </div>

                  {/* Actions row */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => router.push(`/astro-chat/${s.id}`)}
                      className="rounded-full border px-4 py-1.5 text-sm font-semibold
                        text-primary transition-colors hover:bg-primary hover:text-white"
                      style={{ borderColor: '#7F2020' }}
                    >
                      View chat
                    </button>
                    {canRefund && (
                      <button
                        onClick={() => {
                          setRfSession(s);
                          setRfReason(REFUND_REASONS[0]);
                          setRfNote('');
                        }}
                        className="rounded-full bg-danger px-4 py-1.5 text-sm
                          font-bold text-white transition-opacity hover:opacity-90"
                      >
                        Refund
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Desktop table (hidden on small screens) */}
        {filtered.length > 0 && (
          <div className="mt-4 hidden overflow-x-auto md:block">
            <div className="surface p-2">
              <table className="w-full text-sm">
                <thead className="text-left text-sub-text">
                  <tr>
                    <th className="p-2">Client</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Dur</th>
                    <th className="p-2">Gross</th>
                    <th className="p-2">Earned</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Ref</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const rr = s.refundRequest;
                    const inProgress =
                      s.status === 'requesting' || s.status === 'active';
                    const canRefund =
                      !inProgress && (!rr || rr.status !== 'processed');
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="p-2">{s.client || '-'}</td>
                        <td className="p-2 capitalize">{s.type}</td>
                        <td className="p-2">
                          {Math.round((s.duration || 0) / 60)}m
                        </td>
                        <td className="p-2">Rs.{s.cost || 0}</td>
                        <td className="p-2 font-semibold text-success">
                          Rs.{s.astrologerEarning || 0}
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusChip status={s.status} />
                            <RefundChip s={s} />
                          </div>
                        </td>
                        <td className="p-2 font-mono text-xs text-sub-text">
                          #{sessionRefNo(s)}
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() =>
                                router.push(`/astro-chat/${s.id}`)
                              }
                              className="font-semibold text-primary hover:underline"
                            >
                              View chat
                            </button>
                            {canRefund && (
                              <button
                                onClick={() => {
                                  setRfSession(s);
                                  setRfReason(REFUND_REASONS[0]);
                                  setRfNote('');
                                }}
                                className="rounded-full bg-danger px-3 py-1
                                  text-xs font-bold text-white"
                              >
                                Refund
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* Refund modal - all logic preserved */}
      {rfSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
          bg-black/50 p-4">
          <div className="w-full max-w-md rounded-card bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-dark-text">
              Refund this consultation?
            </h2>
            <p className="mt-1 text-xs text-sub-text">
              {rfSession.client || 'Customer'} &middot; {rfSession.type}{' '}
              &middot; {Math.round((rfSession.duration || 0) / 60)}m &middot;
              {' '}Rs.{rfSession.cost || 0} &middot; #{sessionRefNo(rfSession)}
            </p>
            <p className="mt-2 text-xs text-sub-text">
              The full amount (Rs.{rfSession.cost || 0}) is credited back to
              the customer&apos;s wallet. Admin is notified for internal review.
            </p>
            <label className="mt-3 block text-sm font-semibold">
              Reason
              <select
                className="input mt-1"
                value={rfReason}
                onChange={(e) => setRfReason(e.target.value)}
              >
                {REFUND_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            {rfReason === 'Other' && (
              <textarea
                rows={2}
                className="input mt-2"
                placeholder="Describe the reason (optional)"
                value={rfNote}
                onChange={(e) => setRfNote(e.target.value)}
              />
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setRfSession(null)}
                className="btn-ghost flex-1"
                disabled={rfBusy}
              >
                Cancel
              </button>
              <button
                onClick={submitRefund}
                disabled={rfBusy}
                className="flex-1 rounded-full bg-danger px-4 py-2
                  font-bold text-white disabled:opacity-60"
              >
                {rfBusy ? 'Submitting...' : 'Confirm refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
