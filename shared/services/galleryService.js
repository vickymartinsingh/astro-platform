// Astrologer gallery moderation (2026-06-07 spec).
//
// Data model lives on astrologers/{id}:
//   gallery: string[]                 - APPROVED urls; the only
//                                       array the customer profile
//                                       sheet reads.
//   galleryQueue: [                   - pending + rejected items
//     { url, status: 'pending' | 'rejected',
//       uploadedAt: ISO-ms,
//       rejectedReason, rejectedBy, rejectedAt }
//   ]
//
// Why a single doc instead of a subcollection: simpler queries +
// arrayUnion is atomic. Combined cap of 5 across gallery + pending
// matches the operator rule "upto 5 photos".

import {
  doc, getDoc, updateDoc, runTransaction, onSnapshot,
  collection, getDocs, query, where, limit,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export const MAX_GALLERY = 5;

// Astrologer submits a new url for review. Throws when the combined
// count of approved + pending already hits MAX_GALLERY.
export async function submitForReview(astroId, url) {
  if (!astroId || !url) throw new Error('astroId + url required');
  await runTransaction(db, async (t) => {
    const ref = doc(db, 'astrologers', astroId);
    const s = await t.get(ref);
    const d = s.data() || {};
    const approved = Array.isArray(d.gallery) ? d.gallery : [];
    const queue = Array.isArray(d.galleryQueue) ? d.galleryQueue : [];
    const pending = queue.filter((q) => q.status === 'pending').length;
    if (approved.length + pending >= MAX_GALLERY) {
      throw new Error(`Max ${MAX_GALLERY} photos. Wait for review or `
        + 'remove one.');
    }
    const next = [...queue, {
      url, status: 'pending',
      uploadedAt: Date.now(),
    }];
    t.update(ref, { galleryQueue: next });
  });
}

export function listenAstroGallery(astroId, callback) {
  if (!astroId) { callback({}); return () => {}; }
  return onSnapshot(doc(db, 'astrologers', astroId),
    (s) => {
      const d = s.data() || {};
      callback({
        approved: Array.isArray(d.gallery) ? d.gallery : [],
        queue: Array.isArray(d.galleryQueue) ? d.galleryQueue : [],
      });
    }, () => callback({ approved: [], queue: [] }));
}

// Astrologer removes a pending url (rejected items also removable).
export async function removePending(astroId, url) {
  const ref = doc(db, 'astrologers', astroId);
  await runTransaction(db, async (t) => {
    const s = await t.get(ref);
    const queue = (s.data() || {}).galleryQueue || [];
    t.update(ref, {
      galleryQueue: queue.filter((q) => q.url !== url),
    });
  });
}

// Admin actions ------------------------------------------------------

// Approve: move url from galleryQueue (pending) to gallery (approved).
export async function approve(astroId, url, adminUid) {
  const ref = doc(db, 'astrologers', astroId);
  await runTransaction(db, async (t) => {
    const s = await t.get(ref);
    const d = s.data() || {};
    const approved = Array.isArray(d.gallery) ? d.gallery : [];
    const queue = Array.isArray(d.galleryQueue) ? d.galleryQueue : [];
    if (approved.includes(url)) return; // idempotent
    if (approved.length >= MAX_GALLERY) {
      throw new Error(`Astrologer already has ${MAX_GALLERY} approved `
        + 'photos. Remove one before approving more.');
    }
    t.update(ref, {
      gallery: [...approved, url],
      galleryQueue: queue.filter((q) => q.url !== url),
      galleryLastReviewedAt: Date.now(),
      galleryLastReviewedBy: adminUid || '',
    });
  });
}

export async function reject(astroId, url, reason, adminUid) {
  const ref = doc(db, 'astrologers', astroId);
  await runTransaction(db, async (t) => {
    const s = await t.get(ref);
    const queue = (s.data() || {}).galleryQueue || [];
    const next = queue.map((q) => q.url === url
      ? { ...q, status: 'rejected',
        rejectedReason: String(reason || ''),
        rejectedBy: adminUid || '',
        rejectedAt: Date.now() }
      : q);
    t.update(ref, {
      galleryQueue: next,
      galleryLastReviewedAt: Date.now(),
      galleryLastReviewedBy: adminUid || '',
    });
  });
}

// Admin removes an APPROVED url (e.g. complaint, content policy).
export async function unapprove(astroId, url, reason, adminUid) {
  const ref = doc(db, 'astrologers', astroId);
  await runTransaction(db, async (t) => {
    const s = await t.get(ref);
    const d = s.data() || {};
    const approved = Array.isArray(d.gallery) ? d.gallery : [];
    const queue = Array.isArray(d.galleryQueue) ? d.galleryQueue : [];
    t.update(ref, {
      gallery: approved.filter((u) => u !== url),
      galleryQueue: [...queue, {
        url, status: 'rejected',
        rejectedReason: String(reason || ''),
        rejectedBy: adminUid || '',
        rejectedAt: Date.now(),
        wasApproved: true,
      }],
      galleryLastReviewedAt: Date.now(),
      galleryLastReviewedBy: adminUid || '',
    });
  });
}

// Admin queue view: every astrologer with at least one pending photo.
export async function listAllPending() {
  // Spark plan - no Cloud Function. We collection-scan with a small
  // limit; admin queue rarely exceeds a couple hundred entries.
  const snap = await getDocs(query(collection(db, 'astrologers'),
    where('galleryQueue', '!=', null), limit(500)));
  const out = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const queue = Array.isArray(data.galleryQueue)
      ? data.galleryQueue : [];
    const pending = queue.filter((q) => q.status === 'pending');
    if (pending.length === 0) return;
    pending.forEach((q) => out.push({
      astroId: d.id,
      astroName: data.name || '',
      astroPhoto: data.photo || '',
      url: q.url,
      uploadedAt: q.uploadedAt || 0,
    }));
  });
  return out.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
}
