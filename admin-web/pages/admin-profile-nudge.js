import { useEffect, useState, useMemo } from 'react';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';
import { adminService, profileNudgeService } from '@astro/shared';

// /admin-profile-nudge - operator controls for the customer-side
// "Complete your profile" popup (2026-06-07 spec).
//
// Top section: global toggle.
//   - enabled boolean
//   - fields (multi-select): which profile fields trigger the popup
//   - intervalHours: re-ask cadence (0 = every app open)
//
// Bottom section: per-user push. Search a customer by name / email /
// phone / code, see which fields they have/are missing, tick the
// fields to nudge them about, optional message, click Push - the
// customer sees the popup the next time they open the app + receives
// a push notification.

const ALL_FIELDS = [
  ['phone',  'Mobile number'],
  ['gender', 'Gender'],
  ['dob',    'Date of birth'],
  ['tob',    'Time of birth'],
  ['pob',    'Place of birth'],
  ['name',   'Full name'],
  ['email',  'Email address'],
];

function hasValue(p, k) {
  if (!p) return false;
  const v = p[k];
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

export default function AdminProfileNudge() {
  const { user: admin, loading } = useRequireAdmin();

  // Global config
  const [cfg, setCfg] = useState(null);
  const [savingCfg, setSavingCfg] = useState(false);

  // Per-user push
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null);
  const [pickedFields, setPickedFields] = useState([]);
  const [pushMsg, setPushMsg] = useState('');
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    if (loading) return;
    profileNudgeService.getGlobalConfig().then(setCfg);
  }, [loading]);
  useEffect(() => {
    if (loading) return;
    adminService.getAllUsers().then((list) => setUsers(list || []));
  }, [loading]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users.slice(0, 30);
    return users.filter((u) => [u.name, u.email, u.phone, u.userCode]
      .some((v) => String(v || '').toLowerCase().includes(term)))
      .slice(0, 30);
  }, [users, search]);

  function toggleConfigField(k) {
    if (!cfg) return;
    const set = new Set(cfg.fields || []);
    if (set.has(k)) set.delete(k); else set.add(k);
    setCfg({ ...cfg, fields: Array.from(set) });
  }
  async function saveCfg() {
    if (!cfg) return;
    setSavingCfg(true);
    try {
      await profileNudgeService.saveGlobalConfig(cfg);
      flash('Profile nudge config saved');
    } catch (e) {
      flash(`Save failed: ${e?.message || e}`, 'error');
    } finally {
      setSavingCfg(false);
    }
  }

  function pickUser(u) {
    setPicked(u);
    // Pre-tick the fields that are MISSING on this user so the
    // operator's default action is "ask for what is missing".
    setPickedFields(ALL_FIELDS.filter((f) => !hasValue(u, f[0]))
      .map((f) => f[0]));
    setPushMsg('');
  }
  function togglePushField(k) {
    setPickedFields((cur) => cur.includes(k)
      ? cur.filter((x) => x !== k) : [...cur, k]);
  }
  async function pushNudge() {
    if (!picked) return;
    if (pickedFields.length === 0) {
      flash('Pick at least one field to ask for.', 'error'); return;
    }
    setPushing(true);
    try {
      await profileNudgeService.adminPushNudge((picked.uid || picked.id), {
        fields: pickedFields,
        adminUid: admin?.uid || '',
        message: pushMsg.trim(),
      });
      flash(`Pushed to ${picked.name || picked.email || (picked.uid || picked.id)}`);
      setPicked(null);
      setPickedFields([]);
      setPushMsg('');
    } catch (e) {
      flash(`Push failed: ${e?.message || e}`, 'error');
    } finally {
      setPushing(false);
    }
  }

  if (loading || !cfg) {
    return <Layout><div className="card">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="text-2xl font-bold text-dark-text">
        Profile completion nudge
      </h1>
      <p className="mt-1 text-sm text-sub-text">
        Ask customers to fill missing profile details with a popup on
        next app open. Toggle the global auto-popup, OR push a one-off
        request to a specific customer.
      </p>

      <section className="surface mt-4 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">
          Global auto-popup
        </h2>

        <label className="mt-3 flex items-center gap-2 text-sm
          font-semibold text-dark-text">
          <input type="checkbox" checked={!!cfg.enabled}
            onChange={(e) =>
              setCfg({ ...cfg, enabled: e.target.checked })} />
          Show the popup automatically to customers who have any of
          the selected fields missing
        </label>

        <div className="mt-4">
          <div className="text-[11px] font-bold uppercase
            tracking-wider text-sub-text">
            Which fields trigger the popup
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ALL_FIELDS.map(([code, label]) => {
              const on = (cfg.fields || []).includes(code);
              return (
                <button key={code} type="button"
                  onClick={() => toggleConfigField(code)}
                  className={`rounded-full border px-3 py-1
                    text-xs font-semibold ${on
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-300 bg-white text-sub-text'}`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 max-w-xs">
          <label className="text-[11px] font-bold uppercase
            tracking-wider text-sub-text">
            Re-ask cadence (hours)
          </label>
          <input type="number" className="input mt-1"
            min="0" max="168"
            value={cfg.intervalHours}
            onChange={(e) =>
              setCfg({ ...cfg, intervalHours: Number(e.target.value) })} />
          <p className="mt-1 text-[10px] text-sub-text">
            0 = ask every app open. 24 = once a day.
            168 = once a week.
          </p>
        </div>

        <button onClick={saveCfg} disabled={savingCfg}
          className="mt-4 rounded-full bg-primary px-4 py-2 text-xs
            font-bold text-white disabled:opacity-50">
          {savingCfg ? 'Saving…' : 'Save global config'}
        </button>
      </section>

      <section className="surface mt-4 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">
          Push request to a specific customer
        </h2>
        <p className="mt-1 text-[11px] text-sub-text">
          The customer will see the popup with EXACTLY the fields
          you tick. They cannot dismiss it as "Later" - they have to
          fill (or close the app). Use sparingly.
        </p>

        <div className="mt-3 max-w-sm">
          <input type="search" className="input"
            placeholder="Search by name, email, phone or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="mt-3 max-h-72 overflow-y-auto rounded-card
          border border-gray-200">
          {filtered.length === 0 && (
            <div className="p-4 text-sm text-sub-text">
              No customers match.
            </div>
          )}
          {filtered.map((u) => {
            const missing = ALL_FIELDS.filter(
              (f) => !hasValue(u, f[0])).map((f) => f[1]);
            const isPicked = picked && (picked.uid || picked.id) === (u.uid || u.id);
            return (
              <button key={(u.uid || u.id)}
                onClick={() => pickUser(u)}
                className={`flex w-full items-center justify-between
                  gap-2 border-b border-gray-100 px-3 py-2 text-left
                  text-xs last:border-0 ${isPicked
                    ? 'bg-primary/5'
                    : 'hover:bg-bg-light'}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold
                    text-dark-text">
                    {u.name || u.email || u.phone || u.userCode}
                  </span>
                  <span className="block truncate text-sub-text">
                    {u.userCode ? `Code ${u.userCode} · ` : ''}
                    {u.email || ''}
                    {u.phone ? ` · ${u.phone}` : ''}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5
                  text-[10px] font-bold ${missing.length
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-700'}`}>
                  {missing.length
                    ? `${missing.length} missing`
                    : 'Complete'}
                </span>
              </button>
            );
          })}
        </div>

        {picked && (
          <div className="mt-4 rounded-card bg-bg-light p-3">
            <div className="text-[11px] font-bold uppercase
              tracking-wider text-sub-text">
              Push to: {picked.name || picked.email || (picked.uid || picked.id)}
            </div>

            <div className="mt-2">
              <div className="text-[11px] font-bold text-sub-text">
                Ask for these fields
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {ALL_FIELDS.map(([code, label]) => {
                  const on = pickedFields.includes(code);
                  const userHas = hasValue(picked, code);
                  return (
                    <button key={code} type="button"
                      onClick={() => togglePushField(code)}
                      title={userHas ? 'User has this' : 'User is missing this'}
                      className={`rounded-full border px-3 py-1
                        text-xs font-semibold ${on
                          ? 'border-primary bg-primary text-white'
                          : userHas
                            ? 'border-emerald-300 bg-emerald-50 '
                              + 'text-emerald-700'
                            : 'border-amber-300 bg-amber-50 '
                              + 'text-amber-800'}`}>
                      {label}{userHas ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3">
              <label className="text-[11px] font-bold uppercase
                tracking-wider text-sub-text">
                Optional note shown above the form
              </label>
              <textarea className="input mt-1" rows={2}
                placeholder="We noticed your mobile number is missing - help us reach you with your reports."
                value={pushMsg}
                onChange={(e) => setPushMsg(e.target.value)} />
            </div>

            <div className="mt-3 flex gap-2">
              <button onClick={() => setPicked(null)} disabled={pushing}
                className="rounded-full border border-primary
                  px-4 py-2 text-xs font-bold text-primary">
                Cancel
              </button>
              <button onClick={pushNudge} disabled={pushing}
                className="rounded-full bg-primary px-4 py-2 text-xs
                  font-bold text-white disabled:opacity-50">
                {pushing ? 'Pushing…' : 'Push request'}
              </button>
            </div>
          </div>
        )}
      </section>
    </Layout>
  );
}
