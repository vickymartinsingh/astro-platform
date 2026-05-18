/* eslint-disable react/no-array-index-key */
import { useRef, useState } from 'react';

// The mobile bottom tab bar editor. Self-contained: reorder (drag),
// rename, show/hide, add/remove custom tabs. Operates on settings/
// features via feat/setFeat. Kept in sync with the client BottomNav.
const TAB_DEFS = [
  ['home', 'Home'], ['chat', 'Chat'], ['live', 'Live'],
  ['tarot', 'Tarot'], ['call', 'Call'], ['profile', 'Profile'],
];
const NAV_DEFAULT_HIDDEN = { call: true };

export default function BottomNavEditor({ feat, setFeat }) {
  const dragKey = useRef(null);
  const [navNew, setNavNew] = useState({ label: '', href: '' });

  const customByKey = Object.fromEntries(
    (Array.isArray(feat.nav_custom) ? feat.nav_custom : [])
      .filter((c) => c && c.key).map((c) => [c.key, c]));
  const keys = [...TAB_DEFS.map(([k]) => k),
    ...Object.keys(customByKey)];
  const saved = Array.isArray(feat.nav_order)
    ? feat.nav_order.filter((k) => keys.includes(k)) : [];
  const order = [...saved, ...keys.filter((k) => !saved.includes(k))];

  function reorder(from, to) {
    if (from === to) return;
    const a = [...order];
    const i = a.indexOf(from); const j = a.indexOf(to);
    a.splice(j, 0, a.splice(i, 1)[0]);
    setFeat({ ...feat, nav_order: a });
  }
  function addNavItem() {
    const label = navNew.label.trim();
    let href = navNew.href.trim();
    if (!label) return;
    if (!href) {
      href = '/' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }
    if (!href.startsWith('/') && !/^https?:\/\//.test(href)) {
      href = '/' + href;
    }
    const taken = new Set([...TAB_DEFS.map(([k]) => k),
      ...(feat.nav_custom || []).map((c) => c.key)]);
    const base = 'c_' + (label.toLowerCase()
      .replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'tab');
    let key = base; let n = 1;
    while (taken.has(key)) { key = base + n; n += 1; }
    const custom = [...(Array.isArray(feat.nav_custom)
      ? feat.nav_custom : []), { key, label, href }];
    setFeat({ ...feat, nav_custom: custom,
      nav_order: [...order, key] });
    setNavNew({ label: '', href: '' });
  }
  function removeNavItem(key) {
    const f = { ...feat,
      nav_custom: (feat.nav_custom || []).filter((c) => c.key !== key),
      nav_order: order.filter((k) => k !== key) };
    delete f[`nav_${key}`];
    delete f[`nav_hidden_${key}`];
    setFeat(f);
  }

  return (
    <div className="card">
      <div className="mb-2 font-semibold">
        Bottom tab bar (mobile) - drag to reorder
      </div>
      {order.map((k) => {
        const cu = customByKey[k];
        const label = cu ? cu.label
          : ((TAB_DEFS.find(([x]) => x === k) || [])[1] || k);
        const hv = feat[`nav_hidden_${k}`];
        const hidden = hv === undefined
          ? !!NAV_DEFAULT_HIDDEN[k] : !!hv;
        return (
          <div key={k} draggable
            onDragStart={() => { dragKey.current = k; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => reorder(dragKey.current, k)}
            className="mb-2 flex flex-wrap items-center gap-2
              rounded-card border border-gray-200 bg-white p-2">
            <span className="cursor-grab select-none px-1
              text-sub-text">≡</span>
            <input className="w-28 rounded border border-gray-200 px-2
              py-1 text-sm" value={feat[`nav_${k}`] || label}
              onChange={(e) => setFeat({ ...feat,
                [`nav_${k}`]: e.target.value })} />
            <span className="truncate text-xs text-sub-text">
              ({cu ? cu.href : k})
            </span>
            {cu && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5
                text-[10px] font-semibold text-amber-700">CUSTOM</span>
            )}
            <label className="ml-auto flex items-center gap-1 text-sm">
              <input type="checkbox" checked={!hidden}
                onChange={(e) => setFeat({ ...feat,
                  [`nav_hidden_${k}`]: !e.target.checked })} />
              Visible
            </label>
            {cu && (
              <button onClick={() => removeNavItem(k)} title="Remove"
                className="rounded-full border border-danger px-2
                  py-0.5 text-xs text-danger">✕</button>
            )}
          </div>
        );
      })}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t
        border-gray-100 pt-2">
        <input className="w-28 rounded border border-gray-200 px-2 py-1
          text-sm" placeholder="New tab label" value={navNew.label}
          onChange={(e) => setNavNew({
            ...navNew, label: e.target.value })} />
        <input className="w-40 rounded border border-gray-200 px-2 py-1
          text-sm" placeholder="/path or https://..." value={navNew.href}
          onChange={(e) => setNavNew({
            ...navNew, href: e.target.value })} />
        <button onClick={addNavItem}
          className="rounded-card bg-primary px-3 py-1 text-sm
            font-semibold text-white">+ Add tab</button>
      </div>
    </div>
  );
}
