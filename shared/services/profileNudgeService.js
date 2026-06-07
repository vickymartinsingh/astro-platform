// Profile-completion nudge.
//
// Goal: customers who signed up without filling phone / gender / DOB /
// birth-time / birth-place see a friendly popup the next time they open
// the app, and the popup keeps appearing on a configurable cadence
// until they fill the missing fields. Admin can also push a manual
// request at a specific user (operator: "if I see a person whose mobile
// is missing, I can simply click 'push request' and it pops up to them
// with the fields I selected").
//
// Data layout:
//   settings/profileNudge - global config
//     enabled        boolean       master toggle (default false)
//     fields         string[]      which fields to ask for if missing
//                                  default: ['phone','gender','dob']
//     intervalHours  number        re-ask cadence in hours (default 24)
//                                  0 = ask every app open
//   users/{uid}.profileNudge - per-user state (written client-side on
//                              dismiss + admin-side on push)
//     lastShownAt   ms ts          when the popup was last shown
//     dismissedAt   ms ts          when the user tapped "Later"
//     completedAt   ms ts          set when all required fields filled
//     adminPush: {                 admin manual trigger (optional)
//       requestedAt  ms ts
//       fields       string[]      override field list for this user
//       requestedBy  string        admin uid
//       message      string        optional custom note
//     }
//
// shouldShowNudge() is the single decision function called at app boot.
// It returns either { show:false } or { show:true, fields, source,
// message } where fields is the actual list to ask for.

import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export const DEFAULT_FIELDS = ['phone', 'gender', 'dob'];

const FIELD_LABEL = {
  phone:  'Mobile number',
  gender: 'Gender',
  dob:    'Date of birth',
  tob:    'Time of birth',
  pob:    'Place of birth',
  name:   'Full name',
  email:  'Email address',
};

export function fieldLabel(k) {
  return FIELD_LABEL[k] || k;
}

// True when the user record has a non-empty value for the field.
function hasValue(profile, key) {
  if (!profile) return false;
  const v = profile[key];
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  return true;
}

// Returns the subset of `fields` that are missing on the profile.
export function missingFields(profile, fields) {
  const list = Array.isArray(fields) && fields.length
    ? fields : DEFAULT_FIELDS;
  return list.filter((k) => !hasValue(profile, k));
}

export async function getGlobalConfig() {
  try {
    const s = await getDoc(doc(db, 'settings', 'profileNudge'));
    if (!s.exists()) return { enabled: false, fields: DEFAULT_FIELDS,
      intervalHours: 24 };
    const d = s.data() || {};
    return {
      enabled: !!d.enabled,
      fields: Array.isArray(d.fields) && d.fields.length
        ? d.fields : DEFAULT_FIELDS,
      intervalHours: Number.isFinite(d.intervalHours)
        ? Number(d.intervalHours) : 24,
    };
  } catch (_) {
    return { enabled: false, fields: DEFAULT_FIELDS, intervalHours: 24 };
  }
}

export async function saveGlobalConfig(patch) {
  await setDoc(doc(db, 'settings', 'profileNudge'), {
    enabled: !!patch.enabled,
    fields: Array.isArray(patch.fields) && patch.fields.length
      ? patch.fields : DEFAULT_FIELDS,
    intervalHours: Number.isFinite(Number(patch.intervalHours))
      ? Number(patch.intervalHours) : 24,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Single decision: should we show the popup right now for THIS user?
//
// Priority:
//   1) Admin pushed a request for this user that hasn't been satisfied
//      yet -> ALWAYS show (source: 'admin').
//   2) Global toggle is on AND user has missing fields AND the
//      interval has elapsed since the last show -> show
//      (source: 'auto').
//   3) Otherwise -> don't show.
export async function shouldShowNudge(uid, profile) {
  if (!uid || !profile) return { show: false };
  const cfg = await getGlobalConfig();
  const state = (profile.profileNudge || {});
  const adminPush = state.adminPush || null;
  // Admin push has highest priority. We honour the operator's chosen
  // fields. Show until those specific fields are filled.
  if (adminPush && adminPush.requestedAt) {
    const askFor = Array.isArray(adminPush.fields) && adminPush.fields.length
      ? adminPush.fields : cfg.fields;
    const missing = missingFields(profile, askFor);
    if (missing.length > 0) {
      return { show: true, fields: missing, source: 'admin',
        message: adminPush.message || '' };
    }
    // All fields filled - admin push satisfied. We deliberately do
    // NOT clear adminPush here (admin can decide to re-push later);
    // we let the auto-cadence logic below take over.
  }
  if (!cfg.enabled) return { show: false };
  const missing = missingFields(profile, cfg.fields);
  if (missing.length === 0) return { show: false };
  // Throttle by interval. lastShownAt + intervalHours is the soonest
  // we'd re-prompt. interval=0 means show every app open.
  const last = Number(state.lastShownAt || 0);
  const intervalMs = Math.max(0, Number(cfg.intervalHours) || 0)
    * 60 * 60 * 1000;
  if (intervalMs > 0 && last && (Date.now() - last) < intervalMs) {
    return { show: false };
  }
  return { show: true, fields: missing, source: 'auto', message: '' };
}

export async function markNudgeShown(uid) {
  if (!uid) return;
  await setDoc(doc(db, 'users', uid),
    { profileNudge: { lastShownAt: Date.now() } },
    { merge: true });
}

export async function markNudgeDismissed(uid) {
  if (!uid) return;
  await setDoc(doc(db, 'users', uid),
    { profileNudge: {
      lastShownAt: Date.now(),
      dismissedAt: Date.now(),
    } },
    { merge: true });
}

// Called once after the user fills missing fields successfully. Clears
// the admin push so the operator can manually push again if needed.
export async function markNudgeCompleted(uid) {
  if (!uid) return;
  await setDoc(doc(db, 'users', uid),
    { profileNudge: {
      completedAt: Date.now(),
      adminPush: null,
    } },
    { merge: true });
}

// Admin pushes a request to a specific user. Writes the adminPush
// block; the customer's app picks it up on next foreground via the
// useAuth user-doc snapshot.
export async function adminPushNudge(targetUid, opts) {
  if (!targetUid) throw new Error('targetUid required');
  const fields = Array.isArray(opts && opts.fields) && opts.fields.length
    ? opts.fields : DEFAULT_FIELDS;
  await setDoc(doc(db, 'users', targetUid),
    { profileNudge: {
      adminPush: {
        requestedAt: Date.now(),
        fields,
        requestedBy: (opts && opts.adminUid) || '',
        message: (opts && opts.message) || '',
      },
    } },
    { merge: true });
}

export function listenGlobalConfig(cb) {
  return onSnapshot(doc(db, 'settings', 'profileNudge'), (s) => {
    const d = s.exists() ? s.data() : {};
    cb({
      enabled: !!d.enabled,
      fields: Array.isArray(d.fields) && d.fields.length
        ? d.fields : DEFAULT_FIELDS,
      intervalHours: Number.isFinite(d.intervalHours)
        ? Number(d.intervalHours) : 24,
    });
  }, () => cb({ enabled: false, fields: DEFAULT_FIELDS,
    intervalHours: 24 }));
}
