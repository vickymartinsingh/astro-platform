import { useEffect, useState } from 'react';
import { adminService } from '@astro/shared';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

export default function AdminUsers() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null); // user being edited
  const [gift, setGift] = useState(null); // user receiving a gift
  const [giftAmt, setGiftAmt] = useState(100);
  const [giftMsg, setGiftMsg] = useState('Welcome gift');
  const [msg, setMsg] = useState('');

  async function sendGift() {
    const amt = Number(giftAmt);
    if (!(amt > 0)) { setMsg('Enter a valid amount.'); return; }
    await adminService.adjustWallet(gift.uid, amt,
      giftMsg.trim() || 'welcome_gift');
    setMsg(`Gifted ₹${amt} to ${gift.name}.`);
    flash(`₹${amt} gifted to ${gift.name}`);
    setGift(null);
    load();
  }

  async function load() {
    setRows(await adminService.getAllUsers({ search: search || undefined }));
  }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  async function block(u) {
    await adminService.blockUser(u.uid, !u.isBlocked);
    load();
  }
  async function del(u) {
    if (!window.confirm(
      `Permanently delete user "${u.name || u.email || u.uid}"?\n\n`
      + 'This removes their account and data. This cannot be undone.')) {
      return;
    }
    await adminService.deleteUser(u.uid);
    load();
  }
  async function adjust(u) {
    const amt = Number(prompt(`Adjust wallet for ${u.name} (₹, +/-):`));
    if (!amt) return;
    await adminService.adjustWallet(u.uid, amt, 'admin_adjust');
    load();
  }
  async function saveEdit() {
    setMsg('');
    // 1) Profile (name / phone / status) - this ALWAYS saves and never
    //    blocks on the optional login-email/password change.
    try {
      await adminService.updateUserProfile(edit.uid, {
        name: edit.name || '', phone: edit.phone || '',
        status: edit.status || 'active',
      });
    } catch (e) {
      setMsg('Save failed: ' + (e?.message || 'error'));
      return;
    }
    // Roles (admin / astrologer / support / client).
    try {
      if (Array.isArray(edit.roles) && edit.roles.length) {
        await adminService.setUserRoles(edit.uid, edit.roles);
      }
    } catch (e) {
      window.alert('Profile saved. Roles NOT changed: '
        + (e?.message || 'error'));
    }
    // 2) Login email / password (Firebase Auth) - only when actually
    //    changed, valid, and the relay is configured. Failure here does
    //    NOT discard the profile save; we just warn and still close.
    const newEmail = (edit.email || '').trim();
    const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail);
    const wantEmail = newEmail && newEmail !== (edit._origEmail || '');
    const wantPwd = !!(edit.newPassword && edit.newPassword.length >= 6);
    if (wantEmail || wantPwd) {
      if (wantEmail && !validEmail) {
        window.alert('Profile saved. Login email NOT changed: '
          + `"${newEmail}" is not a valid email address.`);
      } else {
        try {
          await adminService.adminUpdateAuthUser(edit.uid, {
            ...(wantEmail ? { email: newEmail } : {}),
            ...(wantPwd ? { password: edit.newPassword } : {}),
          });
        } catch (e) {
          window.alert('Profile saved. Login email/password NOT changed: '
            + (e?.message || 'service unavailable')
            + '\n\n(Email/password change needs the relay + '
            + 'NEXT_PUBLIC_PUSH_ENDPOINT set on this Vercel project.)');
        }
      }
    }
    setEdit(null);
    load();
    flash('User saved');
  }

  if (loading || rows == null) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">User Management</h1>
      {msg && (
        <div className="surface mb-3 bg-success/10 p-3 text-sm
                        text-success">{msg}</div>
      )}
      <div className="surface mb-3 flex gap-2 p-3">
        <input className="input flex-1"
          placeholder="Search name / email / code" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button onClick={load} className="btn-grad">Search</button>
      </div>

      <div className="surface overflow-x-auto p-2">
        <table className="w-full text-sm">
          <thead className="text-left text-sub-text">
            <tr>
              <th className="p-2">Name</th><th className="p-2">Email</th>
              <th className="p-2">Role</th><th className="p-2">Wallet</th>
              <th className="p-2">Status</th><th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.uid} className="border-t">
                <td className="p-2">{u.name}</td>
                <td className="p-2">{u.email}</td>
                <td className="p-2 capitalize">
                  {u.role}{u.isAstrologer ? ' +astro' : ''}
                </td>
                <td className="p-2">₹{u.wallet || 0}</td>
                <td className="p-2">
                  {u.isBlocked ? 'Suspended' : 'Active'}
                </td>
                <td className="space-x-3 p-2">
                  <button onClick={() => setEdit({
                    ...u, _origEmail: u.email || '', newPassword: '',
                    roles: Array.isArray(u.roles) && u.roles.length
                      ? u.roles
                      : [u.role || 'client',
                        ...(u.isAstrologer ? ['astrologer'] : [])] })}
                    className="text-primary">Edit</button>
                  <button onClick={() => {
                    setGift(u); setGiftAmt(100);
                    setGiftMsg('Welcome gift');
                  }} className="font-semibold text-success">Gift ₹</button>
                  <button onClick={() => block(u)} className="text-danger">
                    {u.isBlocked ? 'Unblock' : 'Block'}
                  </button>
                  <button onClick={() => adjust(u)}
                    className="text-primary">Wallet±</button>
                  <button onClick={() => del(u)}
                    className="font-semibold text-danger">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        px-4" style={{ background: 'rgba(20,14,46,.5)' }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <div className="mb-3 text-lg font-bold">Edit user</div>
            <div className="space-y-2">
              <input className="input" placeholder="Name" value={edit.name || ''}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              <input className="input" placeholder="Phone"
                value={edit.phone || ''}
                onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              <label className="block text-xs font-medium text-sub-text">
                Login email (changes the sign-in email)
              </label>
              <input className="input" type="email" placeholder="Email"
                value={edit.email || ''}
                onChange={(e) =>
                  setEdit({ ...edit, email: e.target.value })} />
              <label className="block text-xs font-medium text-sub-text">
                New password (optional, min 6 chars - leave blank to keep)
              </label>
              <input className="input" type="text"
                placeholder="New password (optional)"
                value={edit.newPassword || ''}
                onChange={(e) =>
                  setEdit({ ...edit, newPassword: e.target.value })} />
              <select className="input" value={edit.status || 'active'}
                onChange={(e) =>
                  setEdit({ ...edit, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
              <div className="rounded-card border border-gray-200 p-3">
                <div className="mb-1 text-xs font-semibold text-sub-text">
                  Access roles (assign one or more)
                </div>
                <div className="flex flex-wrap gap-3">
                  {['client', 'astrologer', 'admin', 'support'].map((r) => {
                    const on = (edit.roles || []).includes(r);
                    return (
                      <label key={r}
                        className="flex items-center gap-1.5 text-sm
                                   capitalize">
                        <input type="checkbox" checked={on}
                          onChange={(e) => {
                            const set = new Set(edit.roles || []);
                            if (e.target.checked) set.add(r);
                            else set.delete(r);
                            setEdit({ ...edit, roles: [...set] });
                          }} />
                        {r}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            {msg && <div className="mt-2 text-sm text-danger">{msg}</div>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setEdit(null)}
                className="btn-ghost flex-1">Cancel</button>
              <button onClick={saveEdit}
                className="btn-grad flex-1 justify-center">Save</button>
            </div>
          </div>
        </div>
      )}

      {gift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        px-4" style={{ background: 'rgba(20,14,46,.5)' }}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5">
            <div className="text-lg font-bold">Give a wallet gift</div>
            <p className="mb-3 text-sm text-sub-text">
              To <b>{gift.name}</b> ({gift.email}). Credited instantly and
              shown in their transactions.
            </p>
            <label className="text-sm text-sub-text">Amount (₹)</label>
            <input className="input mb-2 mt-1" type="number" min={1}
              value={giftAmt}
              onChange={(e) => setGiftAmt(e.target.value)} />
            <div className="mb-2 flex gap-2">
              {[50, 100, 200, 500].map((v) => (
                <button key={v} onClick={() => setGiftAmt(v)}
                  className="pill">₹{v}</button>
              ))}
            </div>
            <label className="text-sm text-sub-text">Note / reason</label>
            <input className="input mt-1" value={giftMsg}
              onChange={(e) => setGiftMsg(e.target.value)} />
            <div className="mt-4 flex gap-2">
              <button onClick={() => setGift(null)}
                className="btn-ghost flex-1">Cancel</button>
              <button onClick={sendGift}
                className="btn-grad flex-1 justify-center">
                Send gift
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
