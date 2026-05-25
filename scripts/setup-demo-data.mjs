// Seed test coupons + gift cards so the demo can exercise the
// coupon Apply + gift card Redeem flows without touching admin UI.
//   coupon  SAVE10  -> 10% off, max ₹50, 100 uses, active
//   coupon  FLAT100 -> 100% off up to ₹100 (free credit on small recharges)
//   gift    GIFT2026 (8-char) -> ₹100, unused
import { readFileSync } from 'fs';
import admin from '../push-relay/node_modules/firebase-admin/lib/index.js';

admin.initializeApp({ credential: admin.credential.cert(
  JSON.parse(readFileSync('./firebase-key.json', 'utf8'))) });

const db = admin.firestore();

async function upsertCoupon(code, fields) {
  const snap = await db.collection('coupons')
    .where('code', '==', code).limit(1).get();
  const data = {
    code,
    active: true,
    usedCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...fields,
  };
  if (snap.empty) {
    const ref = await db.collection('coupons').add(data);
    console.log(`coupon created: ${code} (${ref.id})`);
  } else {
    await snap.docs[0].ref.set(data, { merge: true });
    console.log(`coupon updated: ${code} (${snap.docs[0].id})`);
  }
}

async function upsertGiftCard(code, fields) {
  const ref = db.collection('giftCards').doc(code);
  const data = {
    code,
    redeemedBy: null,
    redeemedAt: null,
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...fields,
  };
  await ref.set(data, { merge: true });
  console.log(`gift card upserted: ${code} -> Rs ${fields.amount}`);
}

await upsertCoupon('SAVE10', {
  discountPercent: 10, maxDiscount: 50, usageLimit: 100,
});
await upsertCoupon('FLAT100', {
  discountPercent: 100, maxDiscount: 100, usageLimit: 100,
});
await upsertGiftCard('GIFT2026', { amount: 100 });
await upsertGiftCard('TESTCARD', { amount: 250 });

console.log('\n--- DEMO DATA READY ---');
console.log('Coupons : SAVE10 (10% off, max Rs 50)');
console.log('          FLAT100 (100% bonus up to Rs 100)');
console.log('Gifts   : GIFT2026 (Rs 100)');
console.log('          TESTCARD (Rs 250)');
process.exit(0);
