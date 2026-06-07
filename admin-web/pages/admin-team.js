import { useState } from 'react';
import { userService, TEAM_ROLES } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Team Access: grant a user the Developer / Support (or Admin) role by
// email. Admin auth passes the Firestore isAdmin() rule so writing the
// role here is allowed (the normal updateUser strips it on purpose).
const ROLES = [...TEAM_ROLES, 'astrologer', 'client'];

export default function AdminTeam() {
  const { loading } = useRequireAdmin();
  const [email, setEmail] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Layout><div className="p-6">Loading…</div></Layout>;

  const lookup = async () => {
    setBusy(true); setFound(null);
    try {
      const u = await userService.findUserByEmail(email);
      if (!u) { flash('No user with that email'); }
      setFound(u);
    } catch (e) { flash('Lookup failed'); }
    setBusy(false);
  };
  const setRole = async (role) => {
    if (!found) return;
    setBusy(true);
    try {
      await userService.adminSetUserRole(found.uid, role);
      setFound({ ...found, role });
      flash(`${found.email} is now: ${role}`);
    } catch (e) { flash('Update failed (admin only)'); }
    setBusy(false);
  };

  return (
    <Layout>
      <h1 className="text-xl font-bold">Team Access</h1>
      <p className="mt-1 text-sm text-gray-500">
        Grant a person the Developer or Support role. They sign in with
        their own account; you can also preview every portal yourself
        with the “Via Admin” switcher (bottom-right).
      </p>

      <div className="mt-4 max-w-lg rounded-2xl bg-white p-4 shadow">
        <label className="text-xs font-semibold text-gray-500">
          User email
        </label>
        <div className="mt-1 flex gap-2">
          <input value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && lookup()}
            placeholder="person@email.com"
            className="flex-1 rounded-lg border border-gray-300
              px-3 py-2 text-sm" />
          <button onClick={lookup} disabled={busy || !email.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm
              font-bold text-white disabled:opacity-50">
            Find
          </button>
        </div>

        {found && (
          <div className="mt-4 rounded-xl border border-gray-200 p-3">
            <div className="text-sm font-semibold">
              {found.name || found.email}
            </div>
            <div className="text-xs text-gray-500">{found.email}</div>
            <div className="mt-1 text-xs">
              Current role:{' '}
              <span className="font-bold">{found.role || 'client'}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <button key={r} onClick={() => setRole(r)}
                  disabled={busy || found.role === r}
                  className={`rounded-full px-3 py-1.5 text-xs
                    font-bold ${found.role === r
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-primary text-white'} disabled:opacity-60`}>
                  {found.role === r ? `✓ ${r}` : `Set ${r}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
