import { useState, useEffect, useMemo } from 'react';
import { db, adminService } from '@astro/shared';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import Layout from '../components/Layout';
import { useRequireAdmin } from '../lib/useAuth';
import { flash } from '../lib/flash';

// Text & copy editor.
//
// Every user-facing string the apps render through useContentText
// goes through settings/content.text[<key>]. This page lets admin
// search, edit, reset and add any key without touching code.
// Defaults baked into each call site remain the safety net; this
// page only writes overrides.
//
// Layout:
//   - sticky search box + group filter
//   - grouped list of keys with inline edit + "Reset to default"
//   - "Add new key" at the bottom so admin can override any string
//     even one not in the seed list
//
// SEED LIST: a curated set of common strings spread across the app
// surface. Admin can edit any seed entry to override; resetting any
// override removes that field from Firestore.
const SEED = [
  // ----- Home -----
  ['home', [
    ['home.getStarted', 'Get started',
      'Home hero CTA when logged out'],
    ['home.browseCta', 'Browse astrologers',
      'Home hero CTA when logged in'],
    ['home.starsTitle', 'Your stars today',
      'Daily horoscope tile title'],
    ['home.catTitle', 'Browse by category',
      'Category carousel title'],
    ['home.topRatedTitle', 'Top rated astrologers',
      'Top-rated row title'],
    ['home.seeAll', 'See all', 'See-all link'],
  ]],
  // ----- Wallet + payments -----
  ['wallet', [
    ['wallet.addCta', 'Add money',
      'Wallet primary CTA'],
    ['wallet.lowBalance', 'Wallet balance is low. Recharge to '
      + 'continue.', 'In-call low-balance toast'],
    ['wallet.balanceLabel', 'Wallet balance',
      'Wallet card label'],
    ['wallet.txnsTitle', 'Recent transactions',
      'Transaction list header'],
  ]],
  // ----- Astrologers list / cards -----
  ['astrologers', [
    ['astrologers.title', 'Talk to a Vedic astrologer',
      'Listing page H1'],
    ['astrologers.chatCta', 'Chat',
      'Per-card chat button'],
    ['astrologers.callCta', 'Call',
      'Per-card call button'],
    ['astrologers.videoCta', 'Video',
      'Per-card video button'],
    ['astrologers.onlineLabel', 'Online now',
      'Online badge'],
    ['astrologers.offlineLabel', 'Offline',
      'Offline badge'],
  ]],
  // ----- Session flow -----
  ['sessions', [
    ['sessions.ringingLabel', 'Ringing...',
      'Outgoing call screen'],
    ['sessions.connectingLabel', 'Connecting...',
      'Mid-connect text'],
    ['sessions.endCta', 'End call',
      'Hang-up button label'],
    ['sessions.missedTitle', 'We are sorry',
      'Missed/rejected modal title'],
    ['sessions.missedBody', 'The astrologer did not respond in '
      + 'time. You have not been charged.',
      'Missed/rejected modal body'],
  ]],
  // ----- Order placed (Discover) -----
  ['orderPlaced', [
    ['modals.orderPlaced.pendingLabel', 'PROCESSING YOUR ORDER',
      'Header label while order is being placed'],
    ['modals.orderPlaced.pendingTitle', 'Placing your {title}...',
      'Pending header title (use {title})'],
    ['modals.orderPlaced.placedLabel', 'ORDER PLACED',
      'Header label once order is in'],
    ['modals.orderPlaced.placedTitle', 'Thank you, your {title} is '
      + 'on its way', 'Placed header title'],
    ['modals.orderPlaced.waitlistedLabel', 'YOU ARE ON THE WAITLIST',
      'Header label for coming-soon items'],
    ['modals.orderPlaced.primaryCta', 'Open My Orders',
      'Success modal primary CTA'],
    ['modals.orderPlaced.closeCta', 'Close',
      'Success modal secondary CTA'],
  ]],
  // ----- My Orders -----
  ['orders', [
    ['orders.title', 'My Orders',
      'Page H1'],
    ['orders.subtitle', 'Every PDF report you bought. Preview right '
      + 'here, email it to yourself, or download.',
      'Subhead'],
    ['orders.emptyTitle', 'No orders yet.',
      'Empty-state title'],
    ['orders.downloadCta', 'Download',
      'Per-order download button'],
    ['orders.emailCta', 'Send to email',
      'Per-order email button'],
  ]],
  // ----- Discover (library) -----
  ['discover', [
    ['discover.title', 'Discover',
      'Library hero title'],
    ['discover.subtitle', 'Every Vedic reading we offer in one '
      + 'place. Tap any tile to see what is inside, the price, '
      + 'and to download a personal report.',
      'Hero subtitle'],
    ['discover.searchPlaceholder', '🔍 Search readings (palmistry, '
      + 'numerology...)', 'Search input placeholder'],
    ['discover.comingSoonBadge', 'Coming soon',
      'Chip text on tile + modal'],
    ['discover.includedBadge', 'In Free Kundli',
      'Chip text on tile'],
  ]],
  // ----- Auth -----
  ['auth', [
    ['auth.signIn', 'Sign in',
      'Sign-in primary CTA'],
    ['auth.signUp', 'Create account',
      'Sign-up primary CTA'],
    ['auth.forgotPassword', 'Forgot password?',
      'Forgot-password link'],
    ['auth.otpHint', 'Enter the 6-digit code we sent to your phone.',
      'OTP screen hint'],
  ]],
  // ----- Bottom nav -----
  ['nav', [
    ['nav.home', 'Home', 'Bottom tab'],
    ['nav.chat', 'Chat', 'Bottom tab'],
    ['nav.live', 'Live', 'Bottom tab'],
    ['nav.tarot', 'Tarot', 'Bottom tab'],
    ['nav.profile', 'Profile', 'Bottom tab'],
  ]],
];

const SEED_FLAT = SEED.flatMap(([group, items]) =>
  items.map(([key, def, hint]) => ({ key, def, hint, group })));

export default function AdminContentText() {
  const { loading } = useRequireAdmin();
  const [text, setText] = useState(null);  // raw settings/content.text
  const [q, setQ] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [edits, setEdits] = useState({});  // pending edits per key
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  useEffect(() => {
    if (loading) return undefined;
    const unsub = onSnapshot(doc(db, 'settings', 'content'), (s) => {
      const d = s.exists() ? s.data() : {};
      setText((d && typeof d.text === 'object') ? d.text : {});
    }, () => setText({}));
    return () => unsub();
  }, [loading]);

  // Build the full list = seed merged with any extra Firestore keys
  // not in seed (so admin sees every override, including ones added
  // outside of this page).
  const rows = useMemo(() => {
    if (text == null) return [];
    const seen = new Set();
    const out = SEED_FLAT.map((s) => {
      seen.add(s.key);
      return { ...s, override: text[s.key] || '' };
    });
    for (const k of Object.keys(text)) {
      if (!seen.has(k)) {
        out.push({ key: k, def: '', hint: 'custom override',
          group: k.split('.')[0] || 'misc', override: text[k] || '' });
      }
    }
    return out;
  }, [text]);

  const groups = useMemo(() => {
    const g = new Set(['all']);
    rows.forEach((r) => g.add(r.group));
    return Array.from(g);
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (groupFilter !== 'all' && r.group !== groupFilter) return false;
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return r.key.toLowerCase().includes(needle)
      || (r.def || '').toLowerCase().includes(needle)
      || (r.override || '').toLowerCase().includes(needle)
      || (r.hint || '').toLowerCase().includes(needle);
  });

  function pendingValue(r) {
    return edits[r.key] != null ? edits[r.key] : r.override;
  }
  function setEdit(key, v) {
    setEdits((c) => ({ ...c, [key]: v }));
  }
  async function save(r) {
    const next = (edits[r.key] != null ? edits[r.key] : r.override)
      .trim();
    setBusy(true);
    try {
      const cur = text || {};
      const patch = { text: { ...cur } };
      if (next === '') delete patch.text[r.key];
      else patch.text[r.key] = next;
      await setDoc(doc(db, 'settings', 'content'), patch,
        { merge: true });
      setEdits((c) => { const n = { ...c }; delete n[r.key]; return n; });
      flash(`Saved "${r.key}".`, 'success');
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    } finally { setBusy(false); }
  }
  async function resetKey(r) {
    setBusy(true);
    try {
      const cur = text || {};
      const patch = { text: { ...cur } };
      delete patch.text[r.key];
      await setDoc(doc(db, 'settings', 'content'), patch,
        { merge: true });
      setEdits((c) => { const n = { ...c }; delete n[r.key]; return n; });
      flash(`Reset "${r.key}" to default.`, 'success');
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    } finally { setBusy(false); }
  }
  async function addNew() {
    const k = newKey.trim();
    if (!k) { flash('Enter a key.', 'error'); return; }
    if (!newVal.trim()) { flash('Enter a value.', 'error'); return; }
    setBusy(true);
    try {
      const cur = text || {};
      await setDoc(doc(db, 'settings', 'content'),
        { text: { ...cur, [k]: newVal.trim() } }, { merge: true });
      setNewKey(''); setNewVal('');
      flash(`Added "${k}".`, 'success');
    } catch (e) {
      flash(String((e && e.message) || e), 'error');
    } finally { setBusy(false); }
  }

  if (loading || text == null) {
    return <Layout><div className="card">Loading...</div></Layout>;
  }

  const overriddenCount = Object.keys(text).length;
  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-end justify-between
        gap-3">
        <div>
          <h1 className="text-2xl font-bold">Text & copy editor</h1>
          <p className="mt-1 text-sm text-sub-text">
            Every user-facing string is editable here. Overrides land
            live in <code>settings/content.text</code>; any field
            left blank falls back to the in-code default.
          </p>
        </div>
        <div className="rounded-full bg-bg-light px-3 py-1.5
          text-xs font-bold text-sub-text">
          {overriddenCount} override{overriddenCount === 1 ? '' : 's'}
          {' active · '}{SEED_FLAT.length} seed key
          {SEED_FLAT.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Filter bar */}
      <div className="surface mb-4 flex flex-wrap items-center
        gap-2 p-3">
        <input className="input flex-1 min-w-[200px]"
          placeholder="Search key, default text or current override"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="rounded-md border border-gray-200
          bg-white px-2 py-2 text-sm" value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g === 'all' ? 'All groups' : g}
            </option>
          ))}
        </select>
        <span className="text-xs text-sub-text">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="card text-sub-text">
            No keys match that filter.
          </div>
        ) : (
          filtered.map((r) => {
            const cur = pendingValue(r);
            const isDirty = edits[r.key] != null
              && edits[r.key] !== r.override;
            const overridden = r.override && r.override.length > 0;
            return (
              <div key={r.key} className="surface p-3">
                <div className="flex items-start justify-between
                  gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-bg-light
                        px-2 py-0.5 text-[10px] font-bold uppercase
                        tracking-wider text-sub-text">{r.group}</span>
                      <span className="truncate font-mono text-xs
                        font-bold">{r.key}</span>
                      {overridden && (
                        <span className="rounded-full bg-amber-100
                          px-2 py-0.5 text-[10px] font-bold
                          text-amber-700">Override</span>
                      )}
                    </div>
                    {r.hint && (
                      <div className="mt-0.5 text-[11px]
                        text-sub-text">{r.hint}</div>
                    )}
                    {r.def && (
                      <div className="mt-1 text-[11px] text-sub-text">
                        <span className="font-semibold">Default:</span>
                        {' '}<span className="italic">{r.def}</span>
                      </div>
                    )}
                  </div>
                  {overridden && (
                    <button onClick={() => resetKey(r)} disabled={busy}
                      className="rounded-full bg-bg-light px-3 py-1
                        text-[11px] font-bold text-sub-text
                        hover:bg-gray-200">
                      Reset to default
                    </button>
                  )}
                </div>
                <textarea rows={Math.min(4,
                  Math.max(1, Math.ceil((cur || '').length / 80)))}
                  value={cur}
                  onChange={(e) => setEdit(r.key, e.target.value)}
                  placeholder={r.def || 'Enter override text...'}
                  className="input mt-2 w-full font-mono text-[12px]"
                  style={{ resize: 'vertical' }} />
                {isDirty && (
                  <div className="mt-2 flex justify-end">
                    <button onClick={() => save(r)} disabled={busy}
                      className="rounded-full bg-primary px-4 py-1.5
                        text-xs font-bold text-white
                        disabled:opacity-50">
                      Save change
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add new key */}
      <div className="surface mt-6 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider
          text-sub-text">Add a new key</h2>
        <p className="mt-1 text-[12px] text-sub-text">
          If you spot a string in the app that does not appear above,
          add it by typing the same key the developer used in code
          (e.g. <code>nav.home</code>). The app reads it through{' '}
          <code>useContentText</code> the next time that screen
          renders.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <input className="input" placeholder="e.g. modals.foo.title"
            value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <input className="input"
            placeholder="Override text"
            value={newVal} onChange={(e) => setNewVal(e.target.value)} />
          <button onClick={addNew} disabled={busy}
            className="rounded-full bg-primary px-4 py-2 text-xs
              font-bold text-white disabled:opacity-50">
            Add
          </button>
        </div>
      </div>
    </Layout>
  );
}
