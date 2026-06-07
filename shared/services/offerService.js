// Astrologer offers / discounts (2026-06-07 spec).
//
// One active offer per astrologer at a time, stored on
// astrologers/{uid}.offer. Shape:
//   {
//     active: true,
//     percentOff: 50,
//     scope: { live: true, call: true, chat: false, video: false },
//     startedAt: serverTimestamp,
//     expiresAt: ISO ms (number) - null means "until manually
//                                  turned off",
//     durationMinutes: 120,        // operator's choice
//     setBy: 'astrologer' | 'admin',
//     setByUid: uid,
//     allowAstroToggleOff: false,  // operator rule: "once they
//                                    activate they cannot undo it
//                                    until it turns off" - admin
//                                    can flip this true to release
//                                    the lock after a ticket.
//   }
//
// Helpers compute the discounted price for each service so every
// caller agrees on the rate. The offer auto-expires by clock
// (expiresAt) on read, so we don't need a server cron to flip the
// flag; isOfferActive() does the comparison.

import {
  doc, getDoc, updateDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export const OFFER_DURATIONS = [
  { id: '30',  label: '30 mins',  ms: 30 * 60 * 1000 },
  { id: '60',  label: '1 hour',   ms: 60 * 60 * 1000 },
  { id: '90',  label: '1.5 hours', ms: 90 * 60 * 1000 },
  { id: '120', label: '2 hours',  ms: 120 * 60 * 1000 },
  { id: '8h',  label: '8 hours',  ms: 8 * 60 * 60 * 1000 },
  { id: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: 'manual', label: 'Until I turn it off', ms: 0 },
];

export function defaultOffer() {
  return {
    active: false,
    percentOff: 50,
    scope: { live: true, call: true, chat: true, video: true },
    durationMinutes: 120,
    expiresAt: 0,
    setBy: null,
    setByUid: null,
    allowAstroToggleOff: false,
  };
}

// Pure helper - is the supplied offer record currently active?
// Returns false when the record is missing, inactive, OR expired.
export function isOfferActive(offer) {
  if (!offer || offer.active === false) return false;
  const exp = Number(offer.expiresAt || 0);
  if (exp && exp <= Date.now()) return false;
  return true;
}

// Pure helper: compute the discounted rate for a given base + scope
// key ('live' | 'call' | 'chat' | 'video'). Returns { base, final,
// percentOff, discounted: true/false } so the UI can render a
// strikethrough trivially.
export function computeRate(base, offer, scopeKey) {
  const bn = Math.max(0, Math.round(Number(base) || 0));
  if (!isOfferActive(offer)) {
    return { base: bn, final: bn, percentOff: 0, discounted: false };
  }
  const sc = offer.scope || {};
  if (!sc[scopeKey]) {
    return { base: bn, final: bn, percentOff: 0, discounted: false };
  }
  const pct = Math.max(0, Math.min(100, Number(offer.percentOff || 0)));
  const final = Math.max(1, Math.round(bn * (1 - pct / 100)));
  return { base: bn, final, percentOff: pct, discounted: pct > 0 };
}

// Astrologer-side activation. Locks the lock-flag so the astrologer
// cannot toggle off (operator rule). `durationId` matches
// OFFER_DURATIONS ids. setBy='astrologer'.
export async function activateOffer(astroUid, {
  percentOff, scope, durationId, durationMinutes,
}) {
  if (!astroUid) throw new Error('astroUid required');
  const def = OFFER_DURATIONS.find((d) => d.id === (durationId || '120'))
    || OFFER_DURATIONS.find((d) => d.id === '120');
  const ms = def.ms;
  const expiresAt = ms > 0 ? Date.now() + ms : 0;
  const next = {
    active: true,
    percentOff: Math.max(0, Math.min(100, Number(percentOff || 50))),
    scope: { live: true, call: true, chat: true, video: true,
      ...(scope || {}) },
    durationMinutes: Math.round(ms / 60000),
    durationId: def.id,
    expiresAt,
    startedAt: serverTimestamp(),
    setBy: 'astrologer',
    setByUid: astroUid,
    allowAstroToggleOff: false,
  };
  await updateDoc(doc(db, 'astrologers', astroUid), { offer: next });
  return next;
}

// Admin override - activate / change / disable an offer on behalf of
// the astrologer. setBy='admin'. By default we allow the astrologer
// to toggle off when the admin set it (admin acts on behalf, so the
// astro can reverse). Caller can pass allowAstroToggleOff=false to
// keep the lock.
export async function adminSetOffer(astroUid, fields, adminUid) {
  if (!astroUid) throw new Error('astroUid required');
  const def = OFFER_DURATIONS.find(
    (d) => d.id === (fields.durationId || '120'))
    || OFFER_DURATIONS.find((d) => d.id === '120');
  const ms = def.ms;
  const expiresAt = fields.active === false ? 0
    : (ms > 0 ? Date.now() + ms : 0);
  const next = {
    active: fields.active !== false,
    percentOff: Math.max(0, Math.min(100,
      Number(fields.percentOff || 0))),
    scope: { live: true, call: true, chat: true, video: true,
      ...(fields.scope || {}) },
    durationMinutes: Math.round(ms / 60000),
    durationId: def.id,
    expiresAt,
    startedAt: serverTimestamp(),
    setBy: 'admin',
    setByUid: adminUid || '',
    allowAstroToggleOff: fields.allowAstroToggleOff !== false,
    adminNote: String(fields.note || ''),
  };
  await updateDoc(doc(db, 'astrologers', astroUid), { offer: next });
  return next;
}

// Admin-only kill switch (no expiresAt change - just inactive).
export async function adminDisableOffer(astroUid, adminUid, reason) {
  await updateDoc(doc(db, 'astrologers', astroUid), {
    offer: {
      active: false,
      disabledAt: serverTimestamp(),
      disabledBy: adminUid || '',
      adminNote: String(reason || ''),
    },
  });
}

// Astrologer trying to toggle their own offer off. Only succeeds when
// allowAstroToggleOff is true (set by admin after a support ticket).
export async function astroToggleOff(astroUid) {
  const ref = doc(db, 'astrologers', astroUid);
  const s = await getDoc(ref);
  const off = (s.data() || {}).offer || {};
  if (!off.allowAstroToggleOff) {
    const e = new Error('Offer can only be disabled by admin. '
      + 'Raise a support ticket and the admin will release it.');
    e.code = 'locked';
    throw e;
  }
  await updateDoc(ref, { offer: { ...off, active: false,
    disabledAt: serverTimestamp(), disabledBy: 'astrologer' } });
}

export function listenAstroOffer(astroUid, callback) {
  return onSnapshot(doc(db, 'astrologers', astroUid),
    (s) => callback(((s.data() || {}).offer) || null),
    () => callback(null));
}
