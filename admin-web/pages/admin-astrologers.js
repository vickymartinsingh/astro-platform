import { useEffect, useState } from 'react';
import { db, storage, adminService } from '@astro/shared';
import { collection, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-sub-text">
        {label}
      </label>
      {children}
    </div>
  );
}

const NEW = {
  name: '', email: '', password: 'admin123', experience: 5,
  skills: '', languages: 'Hindi, English',
  priceChat: 20, priceCall: 30, priceVideo: 40, bio: '',
};

export default function AdminAstrologers() {
  const { loading } = useRequireAdmin();
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState('all');
  const [form, setForm] = useState(NEW);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState(null);

  async function saveEdit() {
    await adminService.updateAstrologerProfile(edit.id, {
      name: edit.name || '',
      bio: edit.bio || '',
      skills: String(edit.skillsCsv || '').split(',')
        .map((s) => s.trim()).filter(Boolean),
      languages: String(edit.langCsv || '').split(',')
        .map((s) => s.trim()).filter(Boolean),
      experience: Number(edit.experience || 0),
      priceChat: Number(edit.priceChat || 0),
      priceCall: Number(edit.priceCall || 0),
      priceVideo: Number(edit.priceVideo || 0),
      discountPercent: Number(edit.discountPercent || 0),
      commissionPercent: Number(edit.commissionPercent || 0),
      approved: !!edit.approved,
      status: edit.status || 'offline',
    });
    setEdit(null);
    load();
  }

  async function load() {
    const snap = await getDocs(collection(db, 'astrologers'));
    setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
  useEffect(() => { if (!loading) load(); /* eslint-disable-next-line */ },
    [loading]);

  async function approve(a, val) {
    await adminService.approveAstrologer(a.id, val);
    load();
  }

  // Admin-uploaded photo is AUTO-APPROVED (set live immediately).
  async function uploadEditPhoto(file) {
    if (!file || !edit) return;
    const r = ref(storage, `profileImages/${edit.id}/admin-${Date.now()}`);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    await adminService.updateAstrologerProfile(edit.id, {
      profileImage: url, pendingProfileImage: '', imageStatus: 'approved',
    });
    setEdit({ ...edit, profileImage: url });
    load();
  }

  // Approve a photo the ASTROLOGER uploaded (pending review).
  async function approvePendingPhoto(a, ok) {
    await adminService.updateAstrologerProfile(a.id, ok
      ? { profileImage: a.pendingProfileImage, pendingProfileImage: '',
          imageStatus: 'approved' }
      : { pendingProfileImage: '', imageStatus: 'rejected' });
    load();
  }

  async function createAstro(e) {
    e.preventDefault();
    setMsg('');
    if (!form.name.trim() || !form.email.trim()) {
      setMsg('Name and email are required.'); return;
    }
    setAdding(true);
    try {
      await adminService.createAstrologer({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password || 'admin123',
        experience: form.experience,
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
        languages: form.languages.split(',').map((s) => s.trim())
          .filter(Boolean),
        priceChat: form.priceChat, priceCall: form.priceCall,
        priceVideo: form.priceVideo, bio: form.bio,
      });
      setMsg(`Created ${form.name}. Login: ${form.email} / `
        + `${form.password || 'admin123'}`);
      setForm(NEW);
      load();
    } catch (e2) {
      setMsg(e2?.code === 'auth/email-already-in-use'
        ? 'That email is already registered.'
        : (e2?.message || 'Could not create astrologer.'));
    } finally { setAdding(false); }
  }

  if (loading || rows == null) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  const shown = tab === 'pending' ? rows.filter((a) => !a.approved) : rows;

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">Astrologer Management</h1>

      {/* Add astrologer */}
      <div className="surface mb-5 p-4">
        <div className="mb-3 font-semibold">Add a new astrologer</div>
        {msg && (
          <div className="mb-3 rounded-card bg-bg-light p-3 text-sm">{msg}</div>
        )}
        <form onSubmit={createAstro}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input className="input" placeholder="Full name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Email (login)" type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <input className="input" placeholder="Experience (years)"
            type="number" value={form.experience}
            onChange={(e) =>
              setForm({ ...form, experience: e.target.value })} />
          <input className="input" placeholder="Skills (comma separated)"
            value={form.skills}
            onChange={(e) => setForm({ ...form, skills: e.target.value })} />
          <input className="input" placeholder="Languages (comma separated)"
            value={form.languages}
            onChange={(e) =>
              setForm({ ...form, languages: e.target.value })} />
          <input className="input" placeholder="Chat ₹/min" type="number"
            value={form.priceChat}
            onChange={(e) =>
              setForm({ ...form, priceChat: e.target.value })} />
          <input className="input" placeholder="Call ₹/min" type="number"
            value={form.priceCall}
            onChange={(e) =>
              setForm({ ...form, priceCall: e.target.value })} />
          <input className="input sm:col-span-2" placeholder="Short bio"
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          <button className="btn-grad sm:col-span-2" disabled={adding}>
            {adding ? 'Creating…' : 'Create astrologer'}
          </button>
        </form>
        <p className="mt-2 text-xs text-sub-text">
          Creates a real login. The astrologer signs in at the Astrologer
          portal (:3001) and goes online to receive requests.
        </p>
      </div>

      <div className="mb-3 flex gap-2">
        {['all', 'pending'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={t === tab ? 'pill pill-active' : 'pill'}>
            {t === 'pending' ? 'Pending approval' : 'All astrologers'}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="surface p-4 text-sub-text">Nothing here.</div>
      ) : (
        <div className="space-y-2">
          {shown.map((a) => (
            <div key={a.id} className="surface p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">
                    {a.name}{' '}
                    {a.approved && (
                      <span className="badge bg-bg-light text-primary">
                        Approved
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-sub-text">
                    {(a.skills || []).join(', ')} · {a.experience || 0} yrs ·
                    ★ {a.rating || 0} · {a.status || 'offline'}
                  </div>
                  <div className="truncate text-sm text-sub-text">{a.bio}</div>
                  {a.pendingProfileImage && (
                    <div className="mt-2 flex items-center gap-2 rounded-card
                                    bg-warning/10 p-2 text-sm">
                      <img src={a.pendingProfileImage} alt=""
                        className="h-10 w-10 rounded-full object-cover" />
                      <span className="text-warning">Photo pending review</span>
                      <button onClick={() => approvePendingPhoto(a, true)}
                        className="font-semibold text-success">Approve</button>
                      <button onClick={() => approvePendingPhoto(a, false)}
                        className="text-danger">Reject</button>
                    </div>
                  )}
                </div>
                <div className="shrink-0 space-x-3 text-sm">
                  <button
                    onClick={() => setEdit({
                      ...a,
                      skillsCsv: (a.skills || []).join(', '),
                      langCsv: (a.languages || []).join(', '),
                    })}
                    className="text-primary">Edit</button>
                  {a.approved ? (
                    <button onClick={() => approve(a, false)}
                      className="text-danger">Revoke</button>
                  ) : (
                    <>
                      <button onClick={() => approve(a, true)}
                        className="font-semibold text-success">
                        Approve
                      </button>
                      <button onClick={() => approve(a, false)}
                        className="text-danger">Reject</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center
                        px-4 py-6 overflow-y-auto"
          style={{ background: 'rgba(20,14,46,.5)' }}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5">
            <div className="mb-3 text-lg font-bold">Edit astrologer</div>

            <div className="mb-3 flex items-center gap-3">
              <img src={edit.profileImage || '/avatar.png'} alt=""
                className="h-14 w-14 rounded-full bg-bg-light
                           object-cover" />
              <label className="btn-ghost cursor-pointer">
                Upload photo (auto-approved)
                <input type="file" accept="image/*" hidden
                  onChange={(e) => uploadEditPhoto(e.target.files?.[0])} />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input className="input" value={edit.name || ''}
                  onChange={(e) =>
                    setEdit({ ...edit, name: e.target.value })} />
              </Field>
              <Field label="Live status">
                <select className="input" value={edit.status || 'offline'}
                  onChange={(e) =>
                    setEdit({ ...edit, status: e.target.value })}>
                  <option value="online">online</option>
                  <option value="offline">offline</option>
                  <option value="busy">busy</option>
                  <option value="idle">idle</option>
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Skills (comma separated)">
                  <input className="input" value={edit.skillsCsv || ''}
                    onChange={(e) =>
                      setEdit({ ...edit, skillsCsv: e.target.value })} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Languages (comma separated)">
                  <input className="input" value={edit.langCsv || ''}
                    onChange={(e) =>
                      setEdit({ ...edit, langCsv: e.target.value })} />
                </Field>
              </div>
              <Field label="Experience (years)">
                <input className="input" type="number"
                  value={edit.experience || 0}
                  onChange={(e) =>
                    setEdit({ ...edit, experience: e.target.value })} />
              </Field>
              <Field label="Discount %">
                <input className="input" type="number"
                  value={edit.discountPercent || 0}
                  onChange={(e) =>
                    setEdit({ ...edit, discountPercent: e.target.value })} />
              </Field>
              <Field label="Commission % (admin cut)">
                <input className="input" type="number"
                  value={edit.commissionPercent || 0}
                  onChange={(e) =>
                    setEdit({ ...edit,
                      commissionPercent: e.target.value })} />
              </Field>
              <Field label="Chat ₹/min">
                <input className="input" type="number"
                  value={edit.priceChat || 0}
                  onChange={(e) =>
                    setEdit({ ...edit, priceChat: e.target.value })} />
              </Field>
              <Field label="Call ₹/min">
                <input className="input" type="number"
                  value={edit.priceCall || 0}
                  onChange={(e) =>
                    setEdit({ ...edit, priceCall: e.target.value })} />
              </Field>
              <Field label="Video ₹/min">
                <input className="input" type="number"
                  value={edit.priceVideo || 0}
                  onChange={(e) =>
                    setEdit({ ...edit, priceVideo: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm
                                sm:col-span-2">
                <input type="checkbox" checked={!!edit.approved}
                  onChange={(e) =>
                    setEdit({ ...edit, approved: e.target.checked })} />
                Approved (visible to clients)
              </label>
              <div className="sm:col-span-2">
                <Field label="Bio">
                  <textarea className="input" rows={3} value={edit.bio || ''}
                    onChange={(e) =>
                      setEdit({ ...edit, bio: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setEdit(null)}
                className="btn-ghost flex-1">Cancel</button>
              <button onClick={saveEdit}
                className="btn-grad flex-1 justify-center">Save</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
