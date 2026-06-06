// Recover a user's wallet balance by summing all their transaction
// rows. Used when the wallet field drifts away from the truth (e.g.
// a buggy reset, a missed credit, an accidental wipe). Optional
// --apply flag actually writes the recovered value; without it the
// script just prints the diff.
//
// Run:
//   node scripts/recover-wallet.mjs --uid <UID>
//   node scripts/recover-wallet.mjs --uid <UID> --apply
//   node scripts/recover-wallet.mjs --email <email> --apply
//   node scripts/recover-wallet.mjs --all-mismatched   (audit every user)
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] || true) : def;
}
function flag(name) { return process.argv.includes(`--${name}`); }

const KEY = 'D:/Projects/Astro/firebase-key.json';
admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync(KEY, 'utf8'))),
});
const db = admin.firestore();

async function resolveUid({ uid, email }) {
  if (uid) return String(uid);
  if (email) {
    const snap = await db.collection('users')
      .where('email', '==', String(email).trim().toLowerCase())
      .limit(1).get();
    if (snap.empty) throw new Error('no user found for that email');
    return snap.docs[0].id;
  }
  return null;
}

async function computeCorrectWallet(uid) {
  // Sum every transactions row for this user. Each transaction has a
  // signed amount: positive for credit (added to wallet), negative
  // for debit (already-negative amount), OR a type field saying
  // "credit" / "debit" with a positive amount that we sign in code.
  const snap = await db.collection('transactions')
    .where('userId', '==', uid)
    .get();
  let total = 0;
  const breakdown = { credits: 0, debits: 0, count: snap.size };
  snap.docs.forEach((d) => {
    const t = d.data() || {};
    const amt = Number(t.amount || 0);
    if (t.type === 'debit' || amt < 0) {
      // store positive 299 with type=debit OR negative -299: same effect
      const signed = amt < 0 ? amt : -Math.abs(amt);
      total += signed;
      breakdown.debits += -signed;
    } else {
      const signed = Math.abs(amt);
      total += signed;
      breakdown.credits += signed;
    }
  });
  return { total, breakdown };
}

async function recover({ uid, apply }) {
  const u = await db.collection('users').doc(uid).get();
  if (!u.exists) throw new Error(`user ${uid} not found`);
  const data = u.data();
  const currentWallet = Number(data.wallet || 0);
  const { total, breakdown } = await computeCorrectWallet(uid);
  const recovered = Math.max(0, total);
  const diff = recovered - currentWallet;
  console.log(`\nUser: ${data.name || ''} <${data.email || ''}>`);
  console.log(`  uid               : ${uid}`);
  console.log(`  current wallet    : Rs ${currentWallet}`);
  console.log(`  transactions      : ${breakdown.count}`
    + ` (credits Rs ${breakdown.credits}, debits Rs ${breakdown.debits})`);
  console.log(`  recovered wallet  : Rs ${recovered}`);
  console.log(`  diff              : ${diff >= 0 ? '+' : ''}Rs ${diff}`);
  if (!diff) {
    console.log('  -> already correct, nothing to do');
    return { uid, currentWallet, recovered, diff };
  }
  if (apply) {
    // Atomic update + log a reconciliation row so the audit trail
    // shows when + by how much we adjusted.
    await db.runTransaction(async (tx) => {
      const ref = db.collection('users').doc(uid);
      const cur = await tx.get(ref);
      tx.update(ref, {
        wallet: recovered,
        walletRecoveredAt:
          admin.firestore.FieldValue.serverTimestamp(),
        walletRecoveredFrom: cur.data().wallet || 0,
      });
      const txRef = db.collection('transactions').doc();
      tx.set(txRef, {
        userId: uid,
        amount: diff,
        type: diff >= 0 ? 'credit' : 'debit',
        reason: 'Wallet reconciliation (recover-wallet script)',
        referenceId: 'wallet_recovery',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('users').doc(uid)
        .collection('walletAudit').doc(), {
        before: currentWallet, delta: diff, after: recovered,
        reason: 'Wallet reconciliation script',
        source: 'recover-wallet.mjs',
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    console.log('  -> APPLIED');
  } else {
    console.log('  -> dry run (use --apply to write)');
  }
  return { uid, currentWallet, recovered, diff };
}

async function auditAll(apply) {
  const snap = await db.collection('users').get();
  console.log(`Scanning ${snap.size} users for wallet mismatches...`);
  const mismatches = [];
  for (const d of snap.docs) {
    const r = await recover({ uid: d.id, apply });
    if (r.diff) mismatches.push(r);
  }
  console.log(`\n${mismatches.length} mismatches found`
    + (apply ? ', all reconciled' : ' (dry run)'));
}

(async () => {
  if (flag('all-mismatched')) {
    return auditAll(flag('apply'));
  }
  const uid = await resolveUid({
    uid: arg('uid'), email: arg('email'),
  });
  if (!uid) {
    console.error('Pass --uid <UID> or --email <email>');
    process.exit(1);
  }
  await recover({ uid, apply: flag('apply') });
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
