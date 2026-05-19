import { useState } from 'react';
import { useRouter } from 'next/router';
import { isAdminUser } from '@astro/shared';
import { useAuth } from '../lib/useAuth';
import {
  PORTALS, IFRAME_PORTALS, usePortal, getPortalUrls, setPortalUrls,
} from '../lib/portal';
import PortalEditRail from './PortalEditRail';

// Always-on floating control that lets an admin VIEW the whole product
// as any portal (developer / support / client / astrologer) without
// logging into each one. For client/astrologer it embeds the live site
// full-screen; the only admin chrome left is this switcher, so you
// always know you're viewing it "via Admin".
export default function PortalSwitcher() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [portal, setPortal] = usePortal();
  const [open, setOpen] = useState(false);
  const [editUrls, setEditUrls] = useState(false);
  const [urls, setUrls] = useState(getPortalUrls());
  const [frameKey, setFrameKey] = useState(0);

  // Only the owner/admin gets the cross-portal switcher.
  if (!isAdminUser(profile, user && user.email)) return null;

  const isFrame = IFRAME_PORTALS.includes(portal);
  const frameUrl = isFrame ? urls[portal] : '';
  const cur = PORTALS.find((p) => p.id === portal) || PORTALS[0];

  const choose = (id) => {
    setPortal(id);
    setOpen(false);
    setEditUrls(false);
  };
  const saveUrls = () => {
    setPortalUrls(urls);
    setEditUrls(false);
  };

  return (
    <>
      {/* Full-screen live portal embed (client / astrologer). */}
      {isFrame && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2147483600,
          background: '#0F0A23',
        }}>
          {frameUrl ? (
            <iframe
              key={`${portal}-${frameUrl}-${frameKey}`}
              src={frameUrl}
              title={cur.label}
              style={{ width: '100%', height: '100%', border: 0 }}
              allow="camera; microphone; clipboard-read; clipboard-write;
                geolocation; autoplay" />
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

      {/* The switcher itself - above everything, incl. the iframe. */}
      <div style={{
        position: 'fixed', right: 14,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
        zIndex: 2147483630, fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        {open && (
          <div style={{
            marginBottom: 8, width: 248,
            background: '#fff', color: '#1A1A2E',
            borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,.35)',
            overflow: 'hidden', border: '1px solid #e5e7eb',
          }}>
            <div style={{
              padding: '10px 14px', fontSize: 12, fontWeight: 700,
              background: '#1f1147', color: '#fff',
            }}>
              Viewing via Admin — pick a portal
            </div>
            {PORTALS.map((p) => (
              <button key={p.id} onClick={() => choose(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '11px 14px', border: 0,
                  borderTop: '1px solid #f1f1f4', cursor: 'pointer',
                  background: p.id === portal ? '#EEF1FB' : '#fff',
                  fontWeight: p.id === portal ? 700 : 500,
                  fontSize: 14, textAlign: 'left',
                }}>
                <span style={{ fontSize: 16 }}>{p.icon}</span>
                <span style={{ flex: 1 }}>{p.label}</span>
                {p.id === portal && (
                  <span style={{ color: '#6C2BD9', fontSize: 12 }}>●</span>
                )}
              </button>
            ))}
            <button
              onClick={() => {
                setPortal('admin');
                setOpen(false);
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
                  border: 0, background: 'none', color: '#6C2BD9',
                  fontSize: 12, cursor: 'pointer', padding: 0,
                }}>Edit portal URLs</button>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  <input value={urls.client}
                    onChange={(e) => setUrls(
                      { ...urls, client: e.target.value })}
                    placeholder="Client URL"
                    style={inp} />
                  <input value={urls.astrologer}
                    onChange={(e) => setUrls(
                      { ...urls, astrologer: e.target.value })}
                    placeholder="Astrologer URL"
                    style={inp} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={saveUrls} style={btnP}>Save</button>
                    {isFrame && frameUrl && (
                      <a href={frameUrl} target="_blank"
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
        <button onClick={() => setOpen(!open)} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderRadius: 999, border: 0,
          cursor: 'pointer', color: '#fff', fontWeight: 700,
          fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          background: portal === 'admin'
            ? 'linear-gradient(135deg,#6C2BD9,#8B5CF6)'
            : 'linear-gradient(135deg,#B45309,#D4A12A)',
        }}>
          <span style={{ fontSize: 15 }}>{cur.icon}</span>
          <span>Via Admin · {cur.label}</span>
          <span style={{ opacity: 0.8 }}>{open ? '▾' : '▴'}</span>
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
  color: '#fff', background: '#6C2BD9', border: 0, borderRadius: 8,
  cursor: 'pointer',
};
const btnS = {
  flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 700,
  color: '#6C2BD9', background: '#EEF1FB', border: 0, borderRadius: 8,
  cursor: 'pointer',
};
