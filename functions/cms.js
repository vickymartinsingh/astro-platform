// CMS / Page Builder, blueprint Modules 15-17. pages/* is write:false for
// clients (blueprint 12.3); all mutations go through these admin callables
// (Admin SDK) with an audit-logged draft → publish → rollback flow.
const functions = require('firebase-functions');
const { db, FieldValue } = require('./lib/admin');
const { requireAdmin } = require('./lib/utils');

async function auditLog(adminId, action, target, after) {
  await db.collection('logs').add({
    adminId, action, target, before: null, after: after || null,
    timestamp: FieldValue.serverTimestamp(),
  });
}

// Upsert a page's DRAFT only. Going live requires an explicit publish.
exports.adminSavePage = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { id, name, slug, draft } = data || {};
  if (!slug) {
    throw new functions.https.HttpsError('invalid-argument', 'slug required');
  }
  const ref = id
    ? db.collection('pages').doc(id)
    : db.collection('pages').doc(slug);
  await ref.set({
    name: name || slug,
    slug,
    draftVersion: Array.isArray(draft) ? draft : [],
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await auditLog(adminId, 'saved_page_draft', slug);
  return { success: true, id: ref.id };
});

// Publish: draft → published. The previous published version is pushed onto
// a capped history array so any prior version can be restored (Module 16).
exports.adminPublishPage = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { id } = data || {};
  const ref = db.collection('pages').doc(id);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'page not found');
    }
    const p = snap.data();
    const history = Array.isArray(p.history) ? p.history : [];
    if (p.publishedVersion) {
      history.unshift({
        components: p.publishedVersion,
        publishedAt: p.lastPublishedAt || null,
      });
    }
    t.update(ref, {
      publishedVersion: p.draftVersion || [],
      history: history.slice(0, 10),
      lastPublishedAt: FieldValue.serverTimestamp(),
    });
  });
  await auditLog(adminId, 'published_page', id);
  return { success: true };
});

// Restore a past published version (Module 16/17 rollback).
exports.adminRollbackPage = functions.https.onCall(async (data, context) => {
  const adminId = await requireAdmin(context);
  const { id, index } = data || {};
  const ref = db.collection('pages').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'page not found');
  }
  const h = (snap.data().history || [])[index];
  if (!h) {
    throw new functions.https.HttpsError('not-found', 'version not found');
  }
  await ref.update({
    publishedVersion: h.components,
    draftVersion: h.components,
    lastPublishedAt: FieldValue.serverTimestamp(),
  });
  await auditLog(adminId, 'rolled_back_page', id, { index });
  return { success: true };
});
