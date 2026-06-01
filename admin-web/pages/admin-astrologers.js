import { useEffect, useState } from 'react';
import {
  db, storage, adminService, SKILLS, LANGUAGES,
} from '@astro/shared';
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

// Default password for fresh accounts. Astrologer is forced to change
// it on first login via the mustChangePassword flag - see astro-web
// auth gate.
const DEFAULT_PASSWORD = 'AstroSeer';

// Ten on-brand bio templates the admin can apply with one click and
// then personalise. Use {name} as a placeholder for the astrologer's
// own name; we substitute at apply-time so the template still reads
// natural while the admin tweaks the rest.
const BIO_TEMPLATES = [
  { label: 'Classical Vedic',
    body: 'Vedic astrologer with deep training in parashari astrology, '
      + 'dasha analysis and remedy prescription. I read your janma '
      + 'kundli with care and give clear, practical guidance.' },
  { label: 'Career focused',
    body: 'I specialise in career and professional guidance using Vedic '
      + 'and KP techniques. Whether you are deciding on a job change, '
      + 'business or higher studies, I read your chart and timing in '
      + 'detail.' },
  { label: 'Love & marriage',
    body: 'Marriage and relationships consultant. I read your kundli, '
      + 'guna milan and dasha cycles to time your wedding, find the '
      + 'right partner, or heal an existing relationship.' },
  { label: 'KP system specialist',
    body: 'KP (Krishnamurti Paddhati) astrologer with focus on precise '
      + 'event timing - marriage, job, foreign travel, property, '
      + 'children. Quick, point-blank predictions.' },
  { label: 'Numerology + Vedic',
    body: 'Combined numerology and Vedic astrology guidance. Birth chart, '
      + 'name analysis, lucky numbers and date-of-birth alignment, all '
      + 'in one consultation.' },
  { label: 'Tarot reader',
    body: 'Certified tarot reader with 7+ years of experience. I draw '
      + 'spreads tailored to your question and combine them with Vedic '
      + 'chart insights for a complete reading.' },
  { label: 'Vastu specialist',
    body: 'Vastu shastra consultant for homes, shops, factories and '
      + 'workplaces. I diagnose existing structures and suggest '
      + 'practical remedies without major reconstruction.' },
  { label: 'Spiritual healing',
    body: 'Spiritual healer and astro-counsellor. I combine Vedic chart '
      + 'reading with reiki, pranic healing and mantra-based remedies '
      + 'for body, mind and emotional balance.' },
  { label: 'Gemstone advisor',
    body: 'Authorised gemstone consultant. I read your chart, identify '
      + 'beneficial planets and suggest the right gemstone, mantra and '
      + 'wearing day for maximum benefit.' },
  { label: 'Friendly + accessible',
    body: 'Hi, I am {name}. I make astrology simple, friendly and '
      + 'practical - no fear, no pressure, just clear guidance. Tell me '
      + 'what is on your mind and I will read your chart with you.' },
];

const NEW = {
  name: '', email: '', password: DEFAULT_PASSWORD,
  gender: 'male', experience: 5,
  skills: [], languages: ['Hindi', 'English'],
  priceChat: 20, priceCall: 30, priceVideo: 40, priceLive: 30,
  bio: '',
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
      gender: edit.gender || 'other',
      bio: edit.bio || '',
      skills: String(edit.skillsCsv || '').split(',')
        .map((s) => s.trim()).filter(Boolean),
      languages: String(edit.langCsv || '').split(',')
        .map((s) => s.trim()).filter(Boolean),
      experience: Number(edit.experience || 0),
      priceChat: Number(edit.priceChat || 0),
      priceCall: Number(edit.priceCall || 0),
      priceVideo: Number(edit.priceVideo || 0),
      priceLive: Number(edit.priceLive || 0),
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
    // Approving also clears any prior rejection. Unapproving on its
    // own (val=false) keeps them in the pending bucket; rejection is
    // a separate destructive action - see reject() below.
    await adminService.updateAstrologerProfile(a.id, {
      approved: !!val,
      ...(val ? { rejected: false, rejectedAt: null, rejectedReason: '' }
        : {}),
    });
    load();
  }

  async function reject(a) {
    const reason = window.prompt(
      `Reject astrologer "${a.name}"? Optional reason for the record:`,
      '');
    if (reason === null) return;            // admin cancelled
    await adminService.updateAstrologerProfile(a.id, {
      approved: false,
      rejected: true,
      rejectedAt: new Date().toISOString(),
      rejectedReason: String(reason || '').slice(0, 500),
    });
    load();
  }

  async function del(a) {
    if (!window.confirm(
      `Permanently delete astrologer "${a.name}"?\n\n`
      + 'This removes their public profile and account. '
      + 'Use this to clean up duplicates. This cannot be undone.')) return;
    await adminService.deleteAstrologer(a.id);
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
        password: form.password || DEFAULT_PASSWORD,
        // Force the astrologer to change their password + verify
        // their email on first login. The flag lives on the
        // astrologer doc; astro-web checks it before unlocking
        // the dashboard (see follow-up commit).
        mustChangePassword: true,
        needsEmailVerification: true,
        experience: Number(form.experience) || 0,
        skills: Array.isArray(form.skills) ? form.skills : [],
        languages: Array.isArray(form.languages) ? form.languages : [],
        priceChat: Number(form.priceChat) || 0,
        priceCall: Number(form.priceCall) || 0,
        priceVideo: Number(form.priceVideo) || 0,
        priceLive: Number(form.priceLive) || 0,
        bio: form.bio || '',
        gender: form.gender || 'other',
      });
      setMsg(`Created ${form.name}. Temporary login: ${form.email} / `
        + `${form.password || DEFAULT_PASSWORD}. The astrologer will be `
        + 'asked to change the password and verify their email on first '
        + 'login.');
      setForm(NEW);
      load();
    } catch (e2) {
      setMsg(e2?.code === 'auth/email-already-in-use'
        ? 'That email is already registered.'
        : (e2?.message || 'Could not create astrologer.'));
    } finally { setAdding(false); }
  }

  // Toggle a skill / language in the multi-select chip grids.
  function togglePick(field, value) {
    const list = Array.isArray(form[field]) ? form[field] : [];
    const next = list.includes(value)
      ? list.filter((x) => x !== value)
      : [...list, value];
    setForm({ ...form, [field]: next });
  }
  function applyBioTemplate(body) {
    const filled = body.split('{name}').join(form.name.trim() || 'me');
    setForm({ ...form, bio: filled });
  }

  if (loading || rows == null) {
    return <Layout><div className="surface p-4">Loading…</div></Layout>;
  }

  // Filter buckets:
  //   all      -> every astrologer except rejected
  //   pending  -> not yet approved AND not rejected
  //   rejected -> explicitly rejected
  const shown = tab === 'pending'
    ? rows.filter((a) => !a.approved && !a.rejected)
    : tab === 'rejected'
      ? rows.filter((a) => a.rejected)
      : rows.filter((a) => !a.rejected);

  return (
    <Layout>
      <h1 className="mb-3 text-2xl font-bold">Astrologer Management</h1>

      {/* Add astrologer */}
      <div className="surface mb-5 p-4">
        <div className="mb-3 font-semibold">Add a new astrologer</div>
        {msg && (
          <div className="mb-3 rounded-card bg-bg-light p-3 text-sm">{msg}</div>
        )}
        <form onSubmit={createAstro} className="space-y-3">
          {/* Identity */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Full name">
              <input className="input" placeholder="e.g. Pandit Anil Sharma"
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email (login)">
              <input className="input" placeholder="name@astroseer.in"
                type="email" value={form.email}
                onChange={(e) =>
                  setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label={`Temporary password (default ${DEFAULT_PASSWORD})`}>
              <input className="input" value={form.password}
                onChange={(e) =>
                  setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Gender">
              <select className="input" value={form.gender}
                onChange={(e) =>
                  setForm({ ...form, gender: e.target.value })}>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>

          {/* Experience + prices: each input shows its label so they
              are immediately editable (no more "guess the placeholder"). */}
          <Field label="Experience (years)">
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => setForm({ ...form,
                  experience: Math.max(0, Number(form.experience) - 1) })}
                className="rounded-full bg-bg-light px-3 py-1 text-sm
                  font-bold">−</button>
              <input type="number" min={0} max={70}
                className="input flex-1 text-center"
                value={form.experience}
                onChange={(e) =>
                  setForm({ ...form, experience: e.target.value })} />
              <button type="button"
                onClick={() => setForm({ ...form,
                  experience: Number(form.experience) + 1 })}
                className="rounded-full bg-bg-light px-3 py-1 text-sm
                  font-bold">+</button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['priceChat', 'Chat ₹/min'],
              ['priceCall', 'Call ₹/min'],
              ['priceVideo', 'Video ₹/min'],
              ['priceLive', 'Live ₹/min'],
            ].map(([k, label]) => (
              <Field key={k} label={label}>
                <input className="input text-right" type="number" min={0}
                  value={form[k]}
                  onChange={(e) =>
                    setForm({ ...form, [k]: e.target.value })} />
              </Field>
            ))}
          </div>

          {/* Skills - multi-select chip grid. Stored as an array on
              the astrologer doc; falls back to empty when none picked. */}
          <Field label={`Skills (${form.skills.length} selected)`}>
            <div className="flex flex-wrap gap-1.5">
              {SKILLS.map((s) => {
                const picked = form.skills.includes(s);
                return (
                  <button key={s} type="button"
                    onClick={() => togglePick('skills', s)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      picked
                        ? 'bg-primary text-white'
                        : 'border border-gray-200 bg-white text-dark-text'}`}>
                    {s}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Languages - same chip pattern. */}
          <Field label={`Languages (${form.languages.length} selected)`}>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGES.map((l) => {
                const picked = form.languages.includes(l);
                return (
                  <button key={l} type="button"
                    onClick={() => togglePick('languages', l)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      picked
                        ? 'bg-primary text-white'
                        : 'border border-gray-200 bg-white text-dark-text'}`}>
                    {l}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Bio with top-10 template picker. Clicking a template
              fills the textarea; admin tweaks from there. */}
          <Field label="Short bio">
            <div className="mb-1.5 flex flex-wrap gap-1">
              {BIO_TEMPLATES.map((t) => (
                <button key={t.label} type="button"
                  onClick={() => applyBioTemplate(t.body)}
                  className="rounded-full border border-gray-200 bg-white
                    px-2.5 py-1 text-[11px] font-semibold text-dark-text
                    hover:border-primary">
                  {t.label}
                </button>
              ))}
            </div>
            <textarea className="input min-h-[80px]"
              placeholder="Pick a template above or write your own"
              value={form.bio}
              onChange={(e) =>
                setForm({ ...form, bio: e.target.value })} />
          </Field>

          <button className="btn-grad w-full" disabled={adding}>
            {adding ? 'Creating…' : 'Create astrologer'}
          </button>
        </form>
        <p className="mt-2 text-xs text-sub-text">
          Creates a real login with a temporary password. The astrologer
          is asked to change the password and verify their email on
          first login at the Astrologer portal.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          ['all', 'All astrologers'],
          ['pending', 'Pending approval'],
          ['rejected', 'Rejected'],
        ].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={t === tab ? 'pill pill-active' : 'pill'}>
            {label}
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
                    {a.rejected ? (
                      <span className="badge bg-danger/15 text-danger">
                        Rejected
                      </span>
                    ) : a.approved && (
                      <span className="badge bg-bg-light text-primary">
                        Approved
                      </span>
                    )}
                  </div>
                  {a.rejected && a.rejectedReason && (
                    <div className="mt-0.5 text-xs text-danger">
                      Reason: {a.rejectedReason}
                    </div>
                  )}
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
                  {a.rejected ? (
                    <button onClick={() => approve(a, true)}
                      className="font-semibold text-success">
                      Restore + approve
                    </button>
                  ) : a.approved ? (
                    <button onClick={() => approve(a, false)}
                      className="text-danger">Revoke</button>
                  ) : (
                    <>
                      <button onClick={() => approve(a, true)}
                        className="font-semibold text-success">
                        Approve
                      </button>
                      <button onClick={() => reject(a)}
                        className="text-danger">Reject</button>
                    </>
                  )}
                  <button onClick={() => del(a)}
                    className="font-semibold text-danger">Delete</button>
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
