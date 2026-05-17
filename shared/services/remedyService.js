// Remedy system.
// - Admin owns the master CATALOG (settings/remedies.items). World
//   readable, admin writable (existing rules, no redeploy needed).
// - Each astrologer owns their OWN remedies + their OWN price, stored
//   on their astrologers/{uid}.remedies array (they can write their own
//   doc; everyone can read astrologers).
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

function rid() {
  return Math.random().toString(36).slice(2, 9)
    + Date.now().toString(36).slice(-4);
}

// ---- Admin master catalog ----
export async function getCatalog() {
  try {
    const s = await getDoc(doc(db, 'settings', 'remedies'));
    const items = s.exists() ? (s.data().items || []) : [];
    return Array.isArray(items) ? items : [];
  } catch (_) { return []; }
}

export async function saveCatalog(items) {
  await setDoc(doc(db, 'settings', 'remedies'), {
    items: Array.isArray(items) ? items : [],
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return { success: true };
}

export async function addCatalogItem(item) {
  const items = await getCatalog();
  const next = [{
    id: rid(),
    name: String(item.name || '').trim(),
    category: item.category || 'General',
    description: String(item.description || '').trim(),
    basePrice: Math.max(0, Math.round(Number(item.basePrice) || 0)),
    active: item.active !== false,
  }, ...items];
  await saveCatalog(next);
  return next;
}

export async function deleteCatalogItem(id) {
  const items = await getCatalog();
  await saveCatalog(items.filter((x) => x.id !== id));
  return true;
}

// ---- Astrologer's own remedies (their own price) ----
export async function getAstrologerRemedies(astroUid) {
  try {
    const s = await getDoc(doc(db, 'astrologers', astroUid));
    const r = s.exists() ? (s.data().remedies || []) : [];
    return Array.isArray(r) ? r : [];
  } catch (_) { return []; }
}

export async function setAstrologerRemedies(astroUid, list) {
  await updateDoc(doc(db, 'astrologers', astroUid), {
    remedies: Array.isArray(list) ? list : [],
  });
  return { success: true };
}

export async function addAstrologerRemedy(astroUid, remedy) {
  const list = await getAstrologerRemedies(astroUid);
  const next = [{
    id: rid(),
    name: String(remedy.name || '').trim(),
    description: String(remedy.description || '').trim(),
    price: Math.max(0, Math.round(Number(remedy.price) || 0)),
  }, ...list];
  await setAstrologerRemedies(astroUid, next);
  return next;
}

export async function deleteAstrologerRemedy(astroUid, id) {
  const list = await getAstrologerRemedies(astroUid);
  await setAstrologerRemedies(astroUid, list.filter((x) => x.id !== id));
  return true;
}

// Format a remedy as a chat message the astrologer sends to the client.
export function remedyMessageText(r) {
  const price = r.price != null ? r.price : r.basePrice;
  return `Recommended remedy: ${r.name}\n`
    + `${r.description || ''}\n`
    + (price ? `Price: Rs ${price}` : 'Price: as advised');
}
