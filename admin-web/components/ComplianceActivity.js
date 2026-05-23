import { useEffect, useState } from 'react';
import { auditService } from '@astro/shared';

// Admin-only compliance + activity panel. Shows the user's last sign-in
// device, IP, and the audit log of their recent events (signup, login,
// logout, gift card redeem, etc). Customers and astrologers never see
// this; it sits only on admin profile pages for fraud review.
function fmt(ts) {
  try {
    const ms = ts && ts.toMillis ? ts.toMillis()
      : ts && ts.seconds ? ts.seconds * 1000 : 0;
    if (!ms) return '-';
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch (_) { return '-'; }
}
function parseUa(ua) {
  if (!ua) return 'Unknown';
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

export default function ComplianceActivity({ uid, profile }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    if (!uid) return;
    auditService.getAuditByUser(uid, 100).then(setEvents)
      .catch(() => setEvents([]));
  }, [uid]);

  const lastIp = profile && (profile.lastSignInIp
    || profile.lastIp || '');
  const lastUa = profile && (profile.lastSignInUa
    || profile.lastUa || '');
  const lastAt = profile && (profile.lastSignInAt
    || profile.lastSeen || profile.updatedAt);

  return (
    <div className="surface mt-4 border border-amber-200 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide
          text-amber-700">Compliance · device &amp; activity</h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5
          text-[10px] font-bold text-amber-800">Admin only</span>
      </div>
      <p className="mt-1 text-[11px] text-sub-text">
        Customer / astrologer never sees this. Kept for fraud, abuse
        and compliance review.
      </p>

      {/* Last sign-in snapshot */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Snap label="Last sign-in" value={fmt(lastAt)} />
        <Snap label="Last IP"
          value={lastIp || '-'} mono />
        <Snap label="Last device" value={parseUa(lastUa)} />
      </div>
      {lastUa && (
        <div className="mt-2 break-all rounded bg-bg-light p-2 font-mono
          text-[10px] text-sub-text">{lastUa}</div>
      )}

      {/* Activity log */}
      <div className="mt-4 text-xs font-bold uppercase tracking-wide
        text-sub-text">Activity log ({events ? events.length : 0})</div>
      <div className="mt-2 overflow-x-auto rounded-card border
        border-gray-200">
        <table className="w-full text-[12px]">
          <thead className="bg-bg-light text-left text-sub-text">
            <tr>
              <th className="px-2 py-1.5">When</th>
              <th className="px-2 py-1.5">Type</th>
              <th className="px-2 py-1.5">App</th>
              <th className="px-2 py-1.5">IP</th>
              <th className="px-2 py-1.5">Device</th>
              <th className="px-2 py-1.5">Detail</th>
            </tr>
          </thead>
          <tbody>
            {!events && (
              <tr><td className="p-3 text-center text-sub-text"
                colSpan={6}>Loading…</td></tr>
            )}
            {events && events.length === 0 && (
              <tr><td className="p-3 text-center text-sub-text"
                colSpan={6}>
                No activity recorded yet. Login / signup / gift redemption
                events will appear here.
              </td></tr>
            )}
            {events && events.map((e) => (
              <tr key={e.id} className="border-t border-gray-100
                align-top">
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {fmt(e.createdAt)}
                </td>
                <td className="px-2 py-1.5 font-semibold capitalize">
                  {e.type}
                </td>
                <td className="px-2 py-1.5 capitalize">{e.app || '-'}</td>
                <td className="px-2 py-1.5 font-mono">
                  {e.ip || '-'}
                </td>
                <td className="px-2 py-1.5">{parseUa(e.ua)}</td>
                <td className="px-2 py-1.5 text-sub-text">
                  {(e.meta && (e.meta.method || e.meta.email))
                    || (e.meta && Object.keys(e.meta).slice(0, 2)
                      .map((k) => `${k}: ${String(e.meta[k])
                        .slice(0, 40)}`).join(' · '))
                    || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Snap = ({ label, value, mono = false }) => (
  <div className="rounded-card bg-bg-light p-2">
    <div className="text-[10px] font-bold uppercase tracking-wider
      text-sub-text">{label}</div>
    <div className={`mt-0.5 text-sm ${mono ? 'font-mono' : 'font-semibold'
    } text-dark-text break-all`}>{value}</div>
  </div>
);
