// Deduplicates user accounts that share the same phone or email.
// SAFETY FIRST: before deleting any account, checks for transactions,
// sessions, and kundli orders. Any account with activity is NEVER
// deleted — it is promoted to primary if it has the most activity.
//
// Run dry-run first:
//   node scripts/dedup-users.mjs
// Then apply:
//   node scripts/dedup-users.mjs --apply

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync('D:/Projects/Astro/firebase-key.json', 'utf8'))
  ),
});
const db = admin.firestore();
const auth = admin.auth();
const APPLY = process.argv.includes('--apply');

console.log(`Mode: ${APPLY ? 'APPLY (real deletes)' : 'DRY-RUN'}\n`);

// ── 1. Load all users ────────────────────────────────────────────────
const snap = await db.collection('users').limit(5000).get();
const all = snap.docs.map((d) => ({ uid: d.id, ref: d.ref, ...d.data() }));
console.log(`Total Firestore user docs: ${all.length}`);

// ── 2. Activity check — transactions + sessions + orders ─────────────
async function activityScore(uid) {
  const [txns, sess, orders] = await Promise.all([
    db.collection('transactions').where('userId', '==', uid).limit(1).get(),
    db.collection('sessions').where('userId', '==', uid).limit(1).get(),
    db.collection('users').doc(uid).collection('orders').limit(1).get(),
  ]);
  return txns.size + sess.size + orders.size;
}

// ── 3. Group by phone then email ─────────────────────────────────────
function groupBy(field) {
  const map = {};
  all.forEach((u) => {
    const key = String(u[field] || '').trim().toLowerCase();
    if (!key) return;
    map[key] = map[key] || [];
    map[key].push(u);
  });
  return Object.values(map).filter((g) => g.length > 1);
}

const seen = new Set();
const groups = [];
[...groupBy('phone'), ...groupBy('email')].forEach((g) => {
  const key = g.map((u) => u.uid).sort().join(',');
  if (seen.has(key)) return;
  seen.add(key);
  groups.push(g);
});

if (groups.length === 0) {
  console.log('No duplicate groups found. Nothing to do.');
  process.exit(0);
}

let totalDeleted = 0;
let totalSkipped = 0;

// ── 4. Process each group ─────────────────────────────────────────────
for (const group of groups) {
  console.log(`\n--- Checking group: ${group[0].name || '(unnamed)'} | phone=${group[0].phone || '-'} | email=${group[0].email || '-'}`);

  // Score each account
  const scored = await Promise.all(
    group.map(async (u) => {
      const score = await activityScore(u.uid);
      const wallet = Number(u.wallet || 0);
      return { ...u, score, wallet };
    })
  );

  // Primary = highest activity score, then highest wallet, then oldest
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.wallet !== a.wallet) return b.wallet - a.wallet;
    const ta = a.createdAt?.toMillis?.() || (a.createdAt?.seconds || 0) * 1000;
    const tb = b.createdAt?.toMillis?.() || (b.createdAt?.seconds || 0) * 1000;
    return ta - tb; // older first
  });

  const primary = scored[0];
  const dupes = scored.slice(1);

  console.log(`  KEEP  uid=${primary.uid} wallet=₹${primary.wallet} activity=${primary.score} created=${primary.createdAt?.toDate?.()?.toISOString?.()?.slice(0,16) || '-'}`);

  for (const dupe of dupes) {
    if (dupe.score > 0) {
      // Has transactions/sessions/orders — NEVER delete
      console.log(`  SKIP  uid=${dupe.uid} wallet=₹${dupe.wallet} activity=${dupe.score} — HAS ACTIVITY, will not delete`);
      totalSkipped++;
      continue;
    }

    console.log(`  DELETE uid=${dupe.uid} wallet=₹${dupe.wallet} activity=0 created=${dupe.createdAt?.toDate?.()?.toISOString?.()?.slice(0,16) || '-'}`);

    if (APPLY) {
      // Delete Firestore user doc
      try {
        await dupe.ref.delete();
        console.log(`    Firestore doc deleted.`);
      } catch (e) {
        console.error(`    Firestore delete failed: ${e.message}`);
      }

      // Delete Firebase Auth record (silently skip if not found)
      try {
        await auth.deleteUser(dupe.uid);
        console.log(`    Auth record deleted.`);
      } catch (e) {
        console.log(`    Auth delete skipped (${e.code || e.message})`);
      }

      totalDeleted++;
    }
  }
}

console.log(`\n=== Summary ===`);
console.log(`Groups processed: ${groups.length}`);
console.log(`Skipped (have activity): ${totalSkipped}`);
if (APPLY) {
  console.log(`Deleted: ${totalDeleted}`);
  console.log('Done.');
} else {
  const toDelete = scored => scored.filter(u => u.score === 0).length;
  console.log('DRY-RUN complete. Re-run with --apply to delete the zero-activity duplicates.');
}
process.exit(0);
