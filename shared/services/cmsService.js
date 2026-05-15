// cmsService, public reads for the Page Builder (blueprint 3.14 / 6.16).
// Pages are world-readable; all writes go through admin Cloud Functions.
import {
  doc, getDoc, collection, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase.js';

// Public page fetch by slug. `which` = 'published' (default) or 'draft'
// so the admin "View as Client" preview can show unpublished content.
export async function getPage(slug, which = 'published') {
  const snap = await getDoc(doc(db, 'pages', slug));
  if (!snap.exists()) return null;
  const p = snap.data();
  const components = which === 'draft'
    ? (p.draftVersion || p.publishedVersion || [])
    : (p.publishedVersion || []);
  return { id: snap.id, name: p.name, slug: p.slug, components };
}

export async function getAllPages() {
  const snap = await getDocs(collection(db, 'pages'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
