// Merge the detailed astrologer profile (OLD duplicate) onto the account
// the user actually logs in with, then remove the duplicate profile docs.
// Data is copied first, so nothing is lost.
//   OLD (detailed): zBEX1fK7QrRhw5qvRPI2BH5We743  vickymartin.sing@gmail.com
//   KEEP (login)  : 9EA5pndl3DPzVNPUM0tiXmgTk2B3  vickymartinsing@gmail.com
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync(join(ROOT, 'firebase-key.json'), 'utf8'))) });
const db = admin.firestore();

const OLD = 'zBEX1fK7QrRhw5qvRPI2BH5We743';
const KEEP = '9EA5pndl3DPzVNPUM0tiXmgTk2B3';

const oldSnap = await db.collection('astrologers').doc(OLD).get();
if (!oldSnap.exists) { console.log('OLD astrologer not found'); process.exit(1); }
const old = oldSnap.data();
console.log('copying profile from OLD:', JSON.stringify(old).slice(0, 400));

// Carry over every profile field, but keep the KEEP account's identity.
const merged = { ...old };
delete merged.createdAt;            // keep KEEP's own timestamps
merged.name = 'Vicky Martin Singh';
merged.email = 'vickymartinsing@gmail.com';
await db.collection('astrologers').doc(KEEP).set(merged, { merge: true });
console.log('merged detailed profile onto KEEP (vickymartinsing@gmail.com)');

// Remove the duplicate's profile + user docs so it stops showing twice.
await db.collection('astrologers').doc(OLD).delete();
try { await db.collection('users').doc(OLD).delete(); } catch (_) {}
console.log('deleted duplicate profile docs for OLD', OLD);

// Make sure KEEP is a usable, approved astrologer.
await db.collection('astrologers').doc(KEEP).set({
  approved: true, status: old.status || 'offline',
}, { merge: true });

const k = (await db.collection('astrologers').doc(KEEP).get()).data();
console.log('\nFINAL kept astrologer:',
  JSON.stringify({ name: k.name, email: k.email, exp: k.experience,
    skills: k.skills, rating: k.rating, reviews: k.reviewsCount,
    prices: [k.priceChat, k.priceCall, k.priceVideo] }));
process.exit(0);
