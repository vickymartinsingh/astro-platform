// Read-only sanity check of the demo customer's state on production.
// Confirms the demo user, wallet balance, coupons, gift cards, and a
// few sample astrologers exist so the user can run UI flows against
// the live site without surprises.
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const db = admin.firestore();

const demoUid = 'UvO1au1PaFfgLWnw6n38PpgXHGB2';
const u = await db.collection('users').doc(demoUid).get();
const ud = u.data() || {};
console.log('demo user:', ud.email, '| wallet:', ud.wallet, '| name:', ud.name,
  '| emailVerified:', ud.emailVerified);

const coupons = await db.collection('coupons').limit(10).get();
console.log('coupons:');
coupons.docs.forEach(d => {
  const c = d.data();
  console.log('   ', d.id, '|', c.code, '|', c.active, '|', c.discountType,
    c.discountValue, c.maxDiscount);
});

const cards = await db.collection('giftCards').limit(10).get();
console.log('gift cards:');
cards.docs.forEach(d => {
  const c = d.data();
  console.log('   ', d.id, '|', c.code, '|', c.amount, '| used:', c.used);
});

const astrologers = await db.collection('astrologers').limit(5).get();
console.log('astrologers (first 5):');
astrologers.docs.forEach(d => {
  const a = d.data();
  console.log('   ', d.id.slice(0,8), '|', a.name, '| online:', a.isOnline,
    '| status:', a.status, '| rate/min:', a.ratePerMin || a.chatRate);
});

const txn = await db.collection('users').doc(demoUid).collection('transactions')
  .orderBy('createdAt', 'desc').limit(5).get();
console.log('recent txns:');
txn.docs.forEach(d => {
  const t = d.data();
  console.log('   ', t.reason, t.amount, t.referenceId || '', t.note || '');
});

process.exit(0);
