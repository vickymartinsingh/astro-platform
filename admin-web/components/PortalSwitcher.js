import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { isAdminUser } from '@astro/shared';
import { useAuth } from '../lib/useAuth';
import {
  PORTALS, IFRAME_PORTALS, usePortal, getPortalUrls, setPortalUrls,
} from '../lib/portal';
import PortalEditRail from './PortalEditRail';

// Floating portal switcher — small icon-only chip by default, expands
// to a panel on click, AND is draggable anywhere on the screen. The
// position is persisted in localStorage so it stays where you put it
// across page loads.
const POS_KEY = 'admin_portal_switcher_pos';

function loadPos() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p.x === 'number' && typeof p.y === 'number') return p;
  } catch (_) {}
  return null;
}
function savePos(p) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); }
  catch (_) {}
}

export default function PortalSwitcher() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [portal, setPortal] = usePortal();
  const [open, setOpen] = useState(false);
  const [editUrls, setEditUrls] = useState(false);
  const [urls, setUrls] = useState(getPortalUrls());
  const [frameKey, setFrameKey] = useState(0);
  // Position: defaults to bottom-right; loaded from localStorage so the
  // admin's last placement sticks.
  const [pos, setPos] = useState(null);
  const dragRef = useRef({ down: false, sx: 0, sy: 0, ox: 0, oy: 0,
    moved: false });

  useEffect(() => {
    // Default: bottom-right with 14px safe-area inset. We resolve to
    // an absolute x/y so dragging works from anywhere.
    const saved = loadPos();
    if (saved) { setPos(saved); return; }
    if (typeof window !== 'undefined') {
      setPos({
        x: Math.max(14, window.innerWidth - 64),
        y: Math.max(14, window.innerHeight - 64),
      });
    }
  }, []);

  // Drag handlers — used on the small chip handle, NOT the panel body
  // (so clicks on portal options still register).
  function onDown(e) {
    const point = e.touches ? e.touches[0] : e;
    dragRef.current = {
      down: true, sx: point.clientX, sy: point.clientY,
      ox: pos.x, oy: pos.y, moved: false,
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }
  function onMove(e) {
    if (!dragRef.current.down) return;
    if (e.preventDefault && e.cancelable) {
      try { e.preventDefault(); } catch (_) {}
    }
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - dragRef.current.sx;
    const dy = point.clientY - dragRef.current.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
    }
    const w = window.innerWidth; const h = window.innerHeight;
    const nx = Math.min(Math.max(8, dragRef.current.ox + dx), w - 56);
    const ny = Math.min(Math.max(8, dragRef.current.oy + dy), h - 56);
    setPos({ x: nx, y: ny });
  }
  function onUp() {
    const wasDrag = dragRef.current.moved;
    dragRef.current.down = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchend', onUp);
    if (wasDrag) {
      savePos(pos);
    } else {
      // True click: toggle the panel.
      setOpen((o) => !o);
    }
  }

  if (!isAdminUser(profile, user && user.email)) return null;
  if (!pos) return null;

  const isFrame = IFRAME_PORTALS.includes(portal);
  const frameUrl = isFrame ? urls[portal] : '';
  const cur = PORTALS.find((p) => p.id === portal) || PORTALS[0];

  const choose = (id) => {
    setPortal(id);
    setOpen(false);
    setEditUrls(false);
    try {
      if (id === 'hr') router.push('/admin-hr-dashboard');
      else if (id === 'developer') router.push('/admin-builder');
      else if (id === 'support') router.push('/admin-support');
      else if (id === 'admin') router.push('/admin-dashboard');
    } catch (_) {}
  };
  const saveUrls = () => { setPortalUrls(urls); setEditUrls(false); };
  const withAdminEdit = (u) => {
    if (!u) return u;
    try {
      const x = new URL(u);
      x.searchParams.set('adminedit', '1');
      return x.toString();
    } catch (_) {
      return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'adminedit=1';
    }
  };

  // Decide whether the open panel goes ABOVE or BELOW the chip, based
  // on which half of the viewport the chip lives in. Same for left
  // vs right alignment.
  const panelAbove = typeof window !== 'undefined'
    && pos.y > window.innerHeight / 2;
  const panelLeft = typeof window !== 'undefined'
    && pos.x > window.innerWidth / 2;
  const panelStyle = {
    position: 'absolute',
    [panelAbove ? 'bottom' : 'top']: 48,
    [panelLeft ? 'right' : 'left']: 0,
    width: 248,
    background: '#fff', color: '#1A1A2E',
    borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,.35)',
    overflow: 'hidden', border: '1px solid #e5e7eb',
  };

  return (
    <>
      {isFrame && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2147483600,
          background: '#0F0A23',
        }}>
          {frameUrl ? (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 12px', background: '#1f1147',
                color: '#fff', fontSize: 12,
              }}>
                <span style={{ flex: 1 }}>
                  Preview only - Google login &amp; payments don’t run
                  inside an embed. Use the real site to sign in.
                </span>
                <a href={withAdminEdit(frameUrl)} target="_blank"
                  rel="noreferrer"
                  style={{
                    background: 'linear-gradient(135deg,#B45309,#D4A12A)',
                    color: '#fff', padding: '5px 12px', borderRadius: 999,
                    fontWeight: 700, textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}>⧉ Open real site</a>
              </div>
              <iframe
                key={`${portal}-${frameUrl}-${frameKey}`}
                src={frameUrl} title={cur.label}
                style={{ width: '100%', height: 'calc(100% - 33px)',
                  border: 0 }}
                allow="camera; microphone; clipboard-read;
                  clipboard-write; geolocation; autoplay" />
            </>
          ) : (
            <div style={{ color: '#fff', padding: 24, fontSize: 14 }}>
              No URL set for the {cur.label} portal. Open the switcher →
              “Edit portal URLs”.
            </div>
          )}
        </div>
      )}
      {isFrame && (
        <PortalEditRail portal={portal}
          onPublished={() => setFrameKey((k) => k + 1)} />
      )}

      <div style={{
        position: 'fixed', left: pos.x, top: pos.y,
        zIndex: 2147483630, fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        {open && (
          <div style={panelStyle}>
            <div style={{
              padding: '10px 14px', fontSize: 12, fontWeight: 700,
              background: '#7F2020', color: '#fff',
            }}>
              Viewing via Admin · pick a portal
            </div>
            {PORTALS.map((p) => (
              <button key={p.id} onClick={() => choose(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '11px 14px', border: 0,
                  borderTop: '1px solid #f1f1f4', cursor: 'pointer',
                  background: p.id === portal ? '#FBF1F1' : '#fff',
                  fontWeight: p.id === portal ? 700 : 500,
                  fontSize: 14, textAlign: 'left',
                }}>
                <span style={{ fontSize: 16 }}>{p.icon}</span>
                <span style={{ flex: 1 }}>{p.label}</span>
                {p.id === portal && (
                  <span style={{ color: '#7F2020', fontSize: 12 }}>●</span>
                )}
              </button>
            ))}
            <button
              onClick={() => {
                setPortal('admin'); setOpen(false);
                router.push('/admin-dev2');
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '11px 14px', border: 0,
                borderTop: '1px solid #f1f1f4', cursor: 'pointer',
                background: '#0F0A23', color: '#fff',
                fontWeight: 700, fontSize: 14, textAlign: 'left',
              }}>
              <span style={{ fontSize: 16 }}>🧩</span>
              <span style={{ flex: 1 }}>Edit / build (no-code)</span>
              <span style={{ opacity: 0.7, fontSize: 12 }}>→</span>
            </button>
            <div style={{
              padding: '8px 14px', borderTop: '1px solid #f1f1f4',
            }}>
              {!editUrls ? (
                <button onClick={() => setEditUrls(true)} style={{
                  border: 0, background: 'none', color: '#7F2020',
                  fontSize: 12, cursor: 'pointer', padding: 0,
                }}>Edit portal URLs</button>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  <input value={urls.client}
                    onChange={(e) => setUrls(
                      { ...urls, client: e.target.value })}
                    placeholder="Client URL" style={inp} />
                  <input value={urls.astrologer}
                    onChange={(e) => setUrls(
                      { ...urls, astrologer: e.target.value })}
                    placeholder="Astrologer URL" style={inp} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={saveUrls} style={btnP}>Save</button>
                    {isFrame && frameUrl && (
                      <a href={withAdminEdit(frameUrl)} target="_blank"
                        rel="noreferrer" style={{
                          ...btnS, textDecoration: 'none',
                          textAlign: 'center',
                        }}>Open tab</a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tiny draggable chip — icon-only, 40px round. Click to expand,
            hold + drag to move. Tooltip on hover. */}
        <button
          onMouseDown={onDown}
          onTouchStart={onDown}
          title={`Via Admin · ${cur.label} · drag to move`}
          style={{
            width: 40, height: 40, borderRadius: 999, border: 0,
            cursor: 'grab', color: '#fff', fontWeight: 700,
            fontSize: 18, lineHeight: 1,
            boxShadow: '0 6px 18px rgba(0,0,0,.32)',
            background: portal === 'admin'
              ? 'linear-gradient(135deg,#7F2020,#A52A2A)'
              : 'linear-gradient(135deg,#B45309,#D4A12A)',
            display: 'flex', alignItems: 'center',
            justifyContent: 'center', touchAction: 'none',
            userSelect: 'none',
          }}>
          {cur.icon}
        </button>
      </div>
    </>
  );
}

const inp = {
  width: '100%', padding: '6px 8px', fontSize: 12,
  border: '1px solid #d1d5db', borderRadius: 8,
};
const btnP = {
  flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 700,
  color: '#fff', background: '#7F2020', border: 0, borderRadius: 8,
  cursor: 'pointer',
};
const btnS = {
  flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 700,
  color: '#7F2020', background: '#FBF1F1', border: 0, borderRadius: 8,
  cursor: 'pointer',
};
