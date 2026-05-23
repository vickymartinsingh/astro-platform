import { useEffect, useRef, useState } from 'react';
import {
  db, isAdminUser, adminService, menuService, themeService,
} from '@astro/shared';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../lib/useAuth';

// IN-PORTAL live editor. Runs INSIDE the real Client app (same origin),
// so an admin opening the portal (directly or via the admin switch)
// gets a Wix-style editor right on the live site - drag/reorder/rename/
// add/hide menu, edit home text, theme and branding. Publish writes the
// same settings docs the app already subscribes to, so the change is
// instant, in place, no reload. Admin-only (Firestore rules also
// enforce admin on write).
const MENU_KEY = 'menu_links_desktop';
const PORTAL = 'client';

export default function AdminLiveEditor() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('menu');
  const [features, setFeatures] = useState(null);
  const [content, setContent] = useState(null);
  const [theme, setTheme] = useState(null);
  const [config, setConfig] = useState(null);
  const [msg, setMsg] = useState('');
  const [editMode, setEditMode] = useState(false);
  const drag = useRef(null);

  const isAdmin = isAdminUser(profile, user && user.email);

  // Editor is ONLY shown when the admin clicked "Switch" in the admin
  // portal (which opens this site with ?adminedit=1). A direct login on
  // this portal - even by an admin account - never reveals the editor.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('adminedit') === '1') {
        window.sessionStorage.setItem('adminEditMode', '1');
        // Clean the URL so the flag isn't visible / shareable.
        url.searchParams.delete('adminedit');
        const clean = url.pathname + (url.search ? url.search : '')
          + url.hash;
        window.history.replaceState({}, '', clean);
      }
      setEditMode(window.sessionStorage.getItem('adminEditMode') === '1');
    } catch (_) { /* ignore */ }
  }, []);

  const exitEdit = () => {
    try { window.sessionStorage.removeItem('adminEditMode'); } catch (_) {}
    setEditMode(false);
    setOpen(false);
  };

  // While the side rail is open, push the body's right edge inwards so
  // the page content shifts left and never overlaps with the rail.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const body = document.body;
    if (open) {
      const w = Math.min(360, Math.round(window.innerWidth * 0.92));
      body.style.transition = 'padding-right .15s ease';
      body.style.paddingRight = `${w}px`;
    } else {
      body.style.paddingRight = '';
    }
    return () => { body.style.paddingRight = ''; };
  }, [open]);

  useEffect(() => {
    if (!isAdmin || !editMode || !open) return;
    const load = async (n, set) => {
      try {
        const s = await getDoc(doc(db, 'settings', n));
        set(s.exists() ? s.data() : {});
      } catch (_) { set({}); }
    };
    if (!features) load('features', setFeatures);
    if (!content) load('content', setContent);
    if (!theme) load('theme', setTheme);
    if (!config) load('config', setConfig);
  }, [isAdmin, editMode, open]);

  // BOTH gates required: admin account AND came via the admin switch.
  if (!isAdmin || !editMode) return null;

  const toast = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };
  const save = async (n, patch, label) => {
    try {
      await adminService.updateSettings(n, patch);
      toast(`${label} published - live`);
    } catch (_) { toast('Could not publish (admin only)'); }
  };

  const menu = features
    ? (PORTAL === 'client'
      ? menuService.resolveMenus(features).menu
      : menuService.resolveMenus(features).astro)
    : null;
  const items = features && (Array.isArray(features[MENU_KEY])
    && features[MENU_KEY].length ? features[MENU_KEY] : menu);
  const setItems = (arr) => setFeatures({ ...features, [MENU_KEY]: arr });
  const mSet = (i, p) => setItems(items.map((x, j) =>
    (j === i ? { ...x, ...p } : x)));
  const mMove = (f, t) => {
    if (t < 0 || t >= items.length || f === t) return;
    const a = items.slice(); const [m] = a.splice(f, 1);
    a.splice(t, 0, m); setItems(a);
  };

  const themeKeys = Object.keys((themeService.THEMES) || {});

  return (
    <>
      <button onClick={() => setOpen(!open)} title="Edit this portal"
        style={{
          position: 'fixed', left: 14,
          bottom: 'calc(env(safe-area-inset-bottom,0px) + 14px)',
          zIndex: 2147483600, display: 'flex', alignItems: 'center',
          gap: 8, padding: '10px 16px', borderRadius: 999, border: 0,
          cursor: 'pointer', color: '#fff', fontWeight: 800,
          fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          fontFamily: 'Inter, system-ui, sans-serif',
          background: 'linear-gradient(135deg,#6C2BD9,#8B5CF6)',
        }}>
        ✏️ {open ? 'Close editor' : 'Edit this portal'}
      </button>

      {open && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 360,
          maxWidth: '92vw', zIndex: 2147483600, background: '#fff',
          boxShadow: '-12px 0 40px rgba(0,0,0,.3)', display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          <div style={{ background: '#1f1147', color: '#fff',
            padding: '12px 14px', display: 'flex',
            alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800 }}>
                Live editor - Client portal
              </div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>
                Edits publish instantly to the live app.
              </div>
            </div>
            <button onClick={exitEdit} title="End admin edit session"
              style={{ border: 0, background: 'rgba(255,255,255,0.15)',
                color: '#fff', fontSize: 11, padding: '4px 8px',
                borderRadius: 6, cursor: 'pointer' }}>
              Exit
            </button>
          </div>
          <div style={{ display: 'flex', borderBottom: '1px solid #eee' }}>
            {['menu', 'text', 'theme', 'brand'].map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, padding: '10px 4px', border: 0, cursor: 'pointer',
                fontSize: 12, fontWeight: 700, textTransform: 'capitalize',
                background: tab === t ? '#EEF1FB' : '#fff',
                color: tab === t ? '#6C2BD9' : '#374151',
              }}>{t}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {!features ? <div style={{ color: '#6B7280',
              fontSize: 13 }}>Loading…</div> : (
              <>
                {tab === 'menu' && (
                  <>
                    {items.map((it, i) => (
                      <div key={`${it.href}-${i}`} draggable
                        onDragStart={() => { drag.current = i; }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => { mMove(drag.current, i);
                          drag.current = null; }}
                        style={row}>
                        <span style={{ cursor: 'grab',
                          color: '#9CA3AF' }}>⠿</span>
                        <div style={{ flex: 1, display: 'grid',
                          gap: 4 }}>
                          <input value={it.label || ''} style={inp}
                            onChange={(e) => mSet(i,
                              { label: e.target.value })}
                            placeholder="Label" />
                          <input value={it.href || ''}
                            style={{ ...inp, fontSize: 11,
                              color: '#6B7280' }}
                            onChange={(e) => mSet(i,
                              { href: e.target.value })}
                            placeholder="/route" />
                        </div>
                        <label style={lbl}>
                          <input type="checkbox" checked={!it.hidden}
                            onChange={(e) => mSet(i,
                              { hidden: !e.target.checked })} />show
                        </label>
                        <button onClick={() => setItems(
                          items.filter((_, j) => j !== i))}
                          style={del}>×</button>
                      </div>
                    ))}
                    <button onClick={() => setItems([...items,
                      { href: '/', label: 'New item', custom: true }])}
                      style={addBtn}>+ Add menu item</button>
                    <button onClick={() => save('features',
                      { [MENU_KEY]: items }, 'Menu')}
                      style={pub}>Publish menu - go live</button>
                  </>
                )}

                {tab === 'text' && content && (
                  <>
                    {[
                      ['homeHeroTitle', 'Hero title'],
                      ['homeHeroSubtitle', 'Hero subtitle'],
                      ['homeCtaPrimary', 'Primary button'],
                      ['homeCtaSecondary', 'Secondary button'],
                    ].map(([k, l]) => (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <div style={cap}>{l}</div>
                        <input value={content[k] || ''} style={inp}
                          onChange={(e) => setContent({ ...content,
                            [k]: e.target.value })} />
                      </div>
                    ))}
                    <button onClick={() => save('content', content,
                      'Text')} style={pub}>Publish text - go live</button>
                  </>
                )}

                {tab === 'theme' && theme && (
                  <>
                    <div style={cap}>Theme preset</div>
                    <select value={theme.active || 'classic'} style={inp}
                      onChange={(e) => setTheme({ ...theme,
                        active: e.target.value })}>
                      {themeKeys.map((k) => (
                        <option key={k} value={k}>{k}</option>))}
                    </select>
                    <button onClick={() => save('theme',
                      { active: theme.active || 'classic' }, 'Theme')}
                      style={pub}>Publish theme - go live</button>
                  </>
                )}

                {tab === 'brand' && config && (
                  <>
                    <div style={cap}>Platform name</div>
                    <input value={config.platformName || ''} style={inp}
                      onChange={(e) => setConfig({ ...config,
                        platformName: e.target.value })} />
                    <div style={{ ...cap, marginTop: 8 }}>Logo URL</div>
                    <input value={config.logo || ''} style={inp}
                      onChange={(e) => setConfig({ ...config,
                        logo: e.target.value })} />
                    <button onClick={() => save('config',
                      { platformName: config.platformName || '',
                        logo: config.logo || '' }, 'Branding')}
                      style={pub}>Publish branding - go live</button>
                  </>
                )}
              </>
            )}
          </div>
          {msg && (
            <div style={{ padding: '8px 14px', fontSize: 12,
              fontWeight: 700, color: msg.includes('Could')
                ? '#C0392B' : '#1B6B2F',
              borderTop: '1px solid #eee' }}>{msg}</div>
          )}
        </div>
      )}
    </>
  );
}

const row = {
  display: 'flex', alignItems: 'center', gap: 6,
  border: '1px solid #e5e7eb', borderRadius: 10, padding: 6,
  marginBottom: 6,
};
const inp = {
  width: '100%', padding: '6px 8px', fontSize: 12,
  border: '1px solid #d1d5db', borderRadius: 7,
};
const cap = { fontSize: 11, fontWeight: 700, color: '#374151',
  marginBottom: 3 };
const lbl = { fontSize: 10, color: '#374151', display: 'flex',
  flexDirection: 'column', alignItems: 'center', gap: 2 };
const del = { border: 0, background: 'none', color: '#C0392B',
  cursor: 'pointer', fontSize: 16 };
const addBtn = {
  width: '100%', padding: 8, fontSize: 13, fontWeight: 600,
  color: '#6C2BD9', background: '#EEF1FB', border: '1px dashed #c7c9f3',
  borderRadius: 10, cursor: 'pointer', marginBottom: 10,
};
const pub = {
  width: '100%', padding: 10, border: 0, borderRadius: 10,
  fontWeight: 800, fontSize: 14, color: '#fff', cursor: 'pointer',
  marginTop: 6, background: 'linear-gradient(135deg,#6C2BD9,#8B5CF6)',
};
