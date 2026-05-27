import { useEffect, useRef, useState } from 'react';
import { db, adminService, menuService } from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';

// Wix-style edit rail that sits ON the live portal view (inside the
// "Via Admin" switcher). You see the real portal on the left and edit
// its menu here on the right; Publish writes the same live Firestore
// config the apps read, so the change is instant. (A cross-origin
// iframe's internals can't be click-edited by ANY tool - this rail is
// the working equivalent.)
const KEY = { client: 'menu_links_desktop', astrologer: 'astro_links' };

export default function PortalEditRail({ portal, onPublished }) {
  const [open, setOpen] = useState(true);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const drag = useRef(null);

  useEffect(() => {
    let alive = true;
    setItems(null);
    (async () => {
      let features = {};
      try {
        const s = await getDoc(doc(db, 'settings', 'features'));
        features = s.exists() ? s.data() : {};
      } catch (_) { features = {}; }
      const r = menuService.resolveMenus(features);
      const list = portal === 'astrologer' ? r.astro : r.menu;
      if (alive) setItems(list.map((x) => ({ ...x })));
    })();
    return () => { alive = false; };
  }, [portal]);

  if (!KEY[portal]) return null;

  const set = (i, patch) => setItems(items.map((x, j) =>
    (j === i ? { ...x, ...patch } : x)));
  const move = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    const a = items.slice();
    const [m] = a.splice(from, 1);
    a.splice(to, 0, m);
    setItems(a);
  };
  const add = () => setItems([...(items || []),
    { href: '/', label: 'New item', custom: true }]);
  const remove = (i) => setItems(items.filter((_, j) => j !== i));

  const publish = async () => {
    setBusy(true); setMsg('');
    try {
      await adminService.updateSettings('features',
        { [KEY[portal]]: items });
      setMsg('Published - live now');
      if (onPublished) onPublished();
    } catch (_) { setMsg('Could not publish'); }
    setBusy(false);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: open ? 340 : 0, zIndex: 2147483620,
      transition: 'width .2s ease', display: 'flex',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'absolute', left: -40, top: 90, width: 40,
          height: 96, border: 0, cursor: 'pointer', color: '#fff',
          borderRadius: '10px 0 0 10px', fontWeight: 700, fontSize: 12,
          background: 'linear-gradient(135deg,#B45309,#D4A12A)',
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          boxShadow: '0 6px 18px rgba(0,0,0,.3)',
        }}>
        {open ? 'Hide editor ▸' : '◂ Edit menu'}
      </button>
      {open && (
        <div style={{
          flex: 1, background: '#fff', height: '100%',
          boxShadow: '-12px 0 40px rgba(0,0,0,.25)',
          display: 'flex', flexDirection: 'column',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          <div style={{
            padding: '12px 14px', background: '#1f1147', color: '#fff',
          }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>
              Live editor - {portal === 'astrologer'
                ? 'Astrologer' : 'Client'} menu
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              Drag ⠿ reorder · rename · show/hide · add/remove ·
              Publish = instant
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {!items ? (
              <div style={{ color: '#6B7280', fontSize: 13 }}>
                Loading menu…
              </div>
            ) : items.map((it, i) => (
              <div key={`${it.href}-${i}`}
                draggable
                onDragStart={() => { drag.current = i; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { move(drag.current, i); drag.current = null; }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  border: '1px solid #e5e7eb', borderRadius: 10,
                  padding: 6, marginBottom: 6, background: '#fff',
                }}>
                <span style={{ cursor: 'grab', color: '#9CA3AF',
                  padding: '0 2px' }} title="Drag">⠿</span>
                <div style={{ flex: 1, display: 'grid', gap: 4 }}>
                  <input value={it.label || ''}
                    onChange={(e) => set(i, { label: e.target.value })}
                    placeholder="Label"
                    style={inp} />
                  <input value={it.href || ''}
                    onChange={(e) => set(i, { href: e.target.value })}
                    placeholder="/route"
                    style={{ ...inp, fontSize: 11, color: '#6B7280' }} />
                </div>
                <label style={{ fontSize: 10, color: '#374151',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 2 }}>
                  <input type="checkbox" checked={!it.hidden}
                    onChange={(e) => set(i,
                      { hidden: !e.target.checked })} />
                  show
                </label>
                <button onClick={() => remove(i)} title="Remove"
                  style={{ border: 0, background: 'none',
                    color: '#C0392B', cursor: 'pointer',
                    fontSize: 16 }}>×</button>
              </div>
            ))}
            <button onClick={add} style={{
              width: '100%', padding: 8, fontSize: 13, fontWeight: 600,
              color: '#7F2020', background: '#FBF7EE', border:
              '1px dashed #E6DEC9', borderRadius: 10, cursor: 'pointer',
            }}>+ Add menu item</button>
          </div>
          <div style={{ padding: 12, borderTop: '1px solid #eee' }}>
            {msg && (
              <div style={{ fontSize: 12, marginBottom: 6,
                color: msg.includes('Could') ? '#C0392B' : '#1B6B2F' }}>
                {msg}
              </div>
            )}
            <button onClick={publish} disabled={busy || !items}
              style={{
                width: '100%', padding: 10, border: 0, borderRadius: 10,
                fontWeight: 800, fontSize: 14, color: '#fff',
                cursor: 'pointer', opacity: busy ? 0.6 : 1,
                background: 'linear-gradient(135deg,#7F2020,#D4A12A)',
              }}>
              {busy ? 'Publishing…' : 'Publish - go live'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inp = {
  width: '100%', padding: '5px 7px', fontSize: 12,
  border: '1px solid #d1d5db', borderRadius: 7,
};
