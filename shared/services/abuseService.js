// Customer reports an astrologer. Stored in the `disputes` collection
// (signed-in create per existing rules - no rules redeploy) with
// type 'astrologer_report', so the admin Disputes screen lists them.
// Admins are push-notified on submit. Reasons are framed for a fair,
// compliant marketplace.
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { sendPushToUser } from './pushService.js';

export const REPORT_REASONS = [
  'Asked to contact or pay outside the app',
  'Rude, abusive or disrespectful behaviour',
  'Misleading or false predictions / fake promises',
  'Fraud or scam',
  'Inappropriate or offensive content',
  'Spam or harassment',
  'Shared or misused my personal information',
  'Other',
];

export async function reportAstrologer(p = {}) {
  const ref = await addDoc(collection(db, 'disputes'), {
    type: 'astrologer_report',
    astroId: p.astroId || '',
    astroName: p.astroName || '',
    userId: p.byUid || '',
    name: (p.name || '').trim(),
    email: (p.email || '').trim(),
    phone: (p.phone || '').trim(),
    dob: p.dob || '',
    reason: p.reason || '',
    description: String(p.description || '').slice(0, 3000),
    status: 'open',
    createdAt: serverTimestamp(),
  });
  // Best-effort admin alert (relay 'admins' target).
  try {
    sendPushToUser({
      target: 'admins',
      title: 'New astrologer report',
      body: `${(p.name || 'A user')} reported `
        + `${(p.astroName || 'an astrologer')}: ${p.reason || ''}`,
      data: { type: 'report', route: '/admin-disputes' },
    });
  } catch (_) { /* ignore */ }
  return ref.id;
}
