/* eslint-disable react/no-array-index-key */
import { useRef, useState } from 'react';
import { menuService } from '@astro/shared';

// Drag-reorder + rename + change path/directory + show/hide + add/delete
// editor for any menu. Works on the merged list by index so you can edit
// the LABEL and the HREF (directory) of EXISTING items too, not just add
// new ones. Writes [{href,label,hidden,from,custom}] to its features key.
export default function MenuEditor({ title, defaults, value, onChange }) {
  const dragIdx = useRef(null);
  const [nl, setNl] = useState('');
  const [nh, setNh] = useState('');
  const merged = menuService.mergeMenu(defaults, value);

  function commit(list) { onChange(list); }
  function updateAt(i, patch) {
    commit(merged.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  function reorder(from, to) {
    if (from == null || to == null || from === to) return;
    const a = [...merged];
    a.splice(to, 0, a.splice(from, 1)[0]);
    commit(a);
  }
  function removeAt(i) { commit(merged.filter((_, idx) => idx !== i)); }
  function normHref(h, label) {
    let href = (h || '').trim();
    if (!href) {
      href = '/' + (label || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    if (!href.startsWith('/') && !/^https?:\/\//.test(href)) {
      href = '/' + href;
    }
    return href;
  }
  function add() {
    const label = nl.trim();
    if (!label) return;
    const href = normHref(nh, label);
    if (merged.some((m) => m.href === href)) return;
    commit([...merged,
      { href, label, hidden: false, custom: true }]);
    setNl(''); setNh('');
  }

  return (
    <div className="card">
      <div className="mb-2 font-semibold">{title}</div>
      {merged.map((m, i) => (
        <div key={i} draggable
          onDragStart={() => { dragIdx.current = i; }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => reorder(dragIdx.current, i)}
          className="mb-2 flex flex-wrap items-center gap-2 rounded-card
            border border-gray-200 bg-white p-2">
          <span className="cursor-grab select-none px-1
            text-sub-text">≡</span>
          <input className="w-36 rounded border border-gray-200 px-2
            py-1 text-sm" value={m.label} placeholder="Name"
            onChange={(e) => updateAt(i, { label: e.target.value })} />
          <input className="w-44 rounded border border-gray-200 px-2
            py-1 text-sm" value={m.href} placeholder="/path or https://..."
            onChange={(e) => updateAt(i, { href: e.target.value })}
            onBlur={(e) => updateAt(i,
              { href: normHref(e.target.value, m.label) })} />
          {m.custom && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5
              text-[10px] font-semibold text-amber-700">CUSTOM</span>
          )}
          <label className="ml-auto flex items-center gap-1 text-sm">
            <input type="checkbox" checked={!m.hidden}
              onChange={(e) => updateAt(i, { hidden: !e.target.checked })} />
            Visible
          </label>
          {m.custom && (
            <button onClick={() => removeAt(i)} title="Remove"
              className="rounded-full border border-danger px-2 py-0.5
                text-xs text-danger">✕</button>
          )}
        </div>
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t
        border-gray-100 pt-2">
        <input className="w-36 rounded border border-gray-200 px-2 py-1
          text-sm" placeholder="New item name" value={nl}
          onChange={(e) => setNl(e.target.value)} />
        <input className="w-44 rounded border border-gray-200 px-2 py-1
          text-sm" placeholder="/path or https://..." value={nh}
          onChange={(e) => setNh(e.target.value)} />
        <button onClick={add}
          className="rounded-card bg-primary px-3 py-1 text-sm
            font-semibold text-white">+ Add item</button>
      </div>
    </div>
  );
}
